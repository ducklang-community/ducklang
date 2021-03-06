#!/usr/bin/env node

const { constants } = require('fs')
const { mkdir, writeFile, readFile, access } = require('fs/promises')
const { spawn } = require('child_process')
const axios = require('axios')
const { Grammar, Parser } = require('nearley')
const { SourceNode } = require('source-map')
const base26 = require('base26')
const jsonDiff = require('json-diff')

const grammar = require('../compiler/grammar.js')

// Issue: In v8 do methods affect shape?
// Are squareOf and cubeOf (unexpectedly) a different shape?

const compiler = (fileName, options) => {

let methodName
let scopes = []
let renames = new Map()
let assignKeyword = 'const'
let contextPrefix = 'this.$context.'
let statementsPrepend = []

const scopesContains = name => {
    return scopes.flat(Infinity).find(({ value }) => value === toCamelCase(name.value))
}

const scopesType = name =>
    scopes[scopes.length - 1].find(({ value }) => value === name.value) ? 'recent' : 'not recent'

const pushScope = name => {
    if (Array.isArray(name)) {
        name.forEach(identifier => pushScope(identifier))
    } else {
        name = { ...name, value: toCamelCase(name.value) }
        const predefined = scopesContains(name)
        if (predefined) {
            throw new Error(`
There are two definitions of same name, but a name can be defined only once.

First definition:  name "${predefined.value}" at line ${predefined.line}, column ${predefined.col}
Second definition: name "${name.value}" at line ${name.line}, column ${name.col}
`)
        }
        const scope = scopes[scopes.length - 1]
        scope.push(name)
    }
}

const popScope = name => {
    if (Array.isArray(name)) {
        throw new Error(`Cannot popScope on an array`)
    } else {
        const value = toCamelCase(name.value)
        const scope = scopes[scopes.length - 1]
        const position = scope.findIndex(saved => saved.value == value)
        if (position < 0) {
            throw new Error(
                `Could not find variable to pop scope from: name "${name.value}" at line ${name.line}, column ${name.col}`
            )
        }
        scopes[scopes.length - 1].splice(position, 1)
    }
}

const withScope = (scope, thunk) => {
    scopes.push(scope)
    const result = thunk()
    scopes.pop()
    return result
}

const captureStatementsPrepend = thunk => {
    statementsPrepend.push([])
    const result = thunk()
    return statementsPrepend.pop().concat(result)
}

const join = (array, separator = ', ') =>
    array
        .map(item => [separator, item])
        .flat()
        .slice(1)

const traceLog = message => {
    if (options.showParseTrace) {
        console.warn(message)
    }
}

const symbols = {}
const symbol = (name, slug = true) => {
    name = toCamelCase(name)
    if (slug) {
        name = name.replace(/[^a-zA-Z0-9_]/g, '_')
    }
    symbols[name] = name in symbols ? symbols[name] + 1 : 1
    return name + symbols[name]
}

const sourceNode = (ref, code) => new SourceNode(ref.line, ref.col - 1, fileName, code || ref.value)

const jsComment = ({ line, annotation, literal }) =>
    line
        ? sourceNode(line, `// ${line.value}\n`)
        : literal.value.includes('\n')
        ? sourceNode(annotation, `/*\n${annotation.value}: ${literal.value}\n*/\n`)
        : sourceNode(annotation, `// ${annotation.value}: ${literal.value}\n`)

const jsComments = comments => (comments ? comments.map(comment => jsComment(comment)) : [])

// Why: generates same-shape context literals for slightly better hidden class reuse within V8

const jsInputs = items =>
    join(items.map(({ definition: { name } }, i) => [sourceNode(name, base26.to(i + 1) + '$'), ': ', sourceNode(name)]))

const jsInputsArgs = items => join(items.map(({ definition: { name } }, i) => sourceNode(name)))

const jsLocator = locator => {
    if (['identifier', 'quote'].includes(locator.type)) {
        return sourceNode(locator, toCamelCase(locator.value || '') + '$')
    } else if (locator.type === 'locate') {
        return sourceNode(locator.location, toCamelCase(locator.location.value || '') + '$')
    } else if (locator.type === 'literal') {
        return sourceNode(locator.value)
    }
    throw new Error(`Unrecognized locator type: ${locator.type}`)
}

const toCamelCase = (x) => {
    x = x.value || x
    while (true) {
        const spaceAt = x.indexOf(' ')
        const dashAt = x.indexOf('-')
        const splitsAt = spaceAt < 0 ? dashAt : (dashAt < 0 ? spaceAt : Math.min(spaceAt, dashAt))
        if (splitsAt < 0) {
            break
        }
        if (splitsAt >= x.length - 1) {
            break
        }
        x = x.substr(0, splitsAt) + x[splitsAt+1].toUpperCase() + x.substr(splitsAt + 2)
    }
    return x;
}

const asCamelCase = (node) => ({ ...node, ...{ value: toCamelCase(node.value) } })

const jsLocation = (location, definition = false) => {
    const name = asCamelCase(location.name)

    if (!definition && !scopesContains(name)) {
        throw new Error(
            `Attempt to use name "${name.value}" in line ${name.line}, column ${name.col}, but it is undefined`
        )
    }

    const contextType = scopesType(name)
    const nameNode = sourceNode(
        name,
        (contextType === 'not recent' ? contextPrefix : '') + toCamelCase(renames.get(name.value) || name.value) + '$'
    )

    if (location.locators.length > 1) {
        const allButLast = [
            { symbol: nameNode },
            ...location.locators.slice(0, -1).map(locator => ({ locator, symbol: symbol(locator.value) }))
        ]
        return [
            '(function () { ',
            allButLast
                .slice(1)
                .map(({ locator, symbol }, i) => [
                    'const ',
                    symbol,
                    ' = ',
                    allButLast[i].symbol,
                    '.get(',
                    jsLocator(locator),
                    '); ',
                    'if (',
                    symbol,
                    ' === undefined) { return } '
                ]),
            'return ',
            allButLast.slice(-1)[0].symbol,
            '.get(',
            jsLocator(location.locators.slice(-1)[0]),
            ') })()'
        ]
    }
    return [nameNode, location.locators.length > 0 ? ['.get(', jsLocator(location.locators[0]), ')'] : '']
}

const dataDefinition = definition => {
    traceLog(JSON.stringify(definition))
    switch (definition.type) {
        case 'dataDefinition':
            return [
                jsLocation(definition.location),
                definition.expression ? [': ', jsExpression(definition.expression)] : ''
            ]
        case 'assignExpandData':
            return 'null /* Issue: assignExpandData not implemented */'
        default:
            console.error(`Unknown definition type ${definition.type}`)
            return sourceNode(definition)
    }
}

const jsData = definitions => {
    return [
        '{ ',
        // Issue: should also support assignExpandData here
        // Issue: need to implement location:locator reference in Data definition
        join(
            definitions
                .filter(({ type }) => type === 'dataDefinition')
                .map(({ location, expression }) => [
                    jsLocator(location.name),
                    expression ? [': ', jsExpression(expression)] : ''
                ])
        ),
        ' }'
    ]
}

// Why: text is not considered simple for this purpose because of the formatting required
const simple = expression => ['locate', 'literal', 'quote'].includes(expression.type)

// Issue: I originally intended:
// with { self:result:input } to be like:
//   x = { result: { self:result:input } } with { self: x }
//
// But I think that would be inconsistent with the usual meaning of self:result:input.
// So I think it's best in that case to treat it like an anonymous expression.
// Nb. with { ...{ input }: self:result } already gives the other obvious semantics,
// so there seems little point in copying that behaviour

const jsArgument = (b, i, inputs) => {
    traceLog('argument:\t' + JSON.stringify(b))
    switch (b.type) {
        case 'dataDefinition':
            return b
        case 'entry':
            return b.definition
        case 'expression':
            if (['locate', 'methodExecution'].includes(b.expression.type)) {
                return jsArgument(b.expression, i, inputs)
            }
            return {
                type: 'dataDefinition',
                location: {
                    type: 'location',
                    name: { type: 'identifier', value: base26.to(i + 1), line: b.line, col: b.col },
                    locators: []
                },
                expression: b
            }
        case 'locate':
            return { type: 'dataDefinition', location: b.location, expression: null }
        case 'assignMethodResult':
            return {
                type: 'dataDefinition',
                location: { type: 'location', name: asCamelCase(b.methodNaming.method), locators: [] },
                expression: b.methodNaming
            }
        ///{"type":"assignExpandData","destructuringData":
        //[{"type":"input","name":{"type":"identifier","value":"stage","text":"stage","offset":3857,"lineBreaks":0,"line":251,"col":25}}],
        //"expression":{"type":"locate","location":{"type":"location","name":{"type":"identifier","value":"variable","text":"variable","offset":3867,"lineBreaks":0,"line":251,"col":35}}}}
        case 'assignExpandData':
            console.warn('Unimplemented assignExpandData')
            // I think because 'expression' can be anything and there can be multiple locators,
        // will need to wrap the method call in a lambda and destructure into temporary variables first.
        //return b.destructuringData.map(({ name }) =>
        //jsArgument({ type: 'dataDefinition', location: { type: 'location', name }, expression: b.expression }))
        case 'digitNumber':
        case 'addition':
        case 'division':
        case 'digitNumber':
        case 'methodExecution':
            // Issue: the dynamic variable names should count from a$ upwards, not use i directly
            // Issue: the dynamic variable names should increment while they collide with an existing parameter name
            return {
                type: 'dataDefinition',
                location: {
                    type: 'location',
                    name: { type: 'identifier', value: base26.to(i + 1), line: b.line, col: b.col },
                    locators: []
                },
                expression: b
            }
        case 'literal':
            // TODO: allow conversions
            return jsArgument(b.value, i, inputs)
        case 'input':
            return {
                type: 'dataDefinition',
                location: {
                    type: 'location',
                    name: b.name,
                    locators: []
                },
                expression: {
                    type: 'location',
                    name: b.name,
                    locators: []
                }
            }
        default:
            console.error(`Unknown argument type: ${b.type}, ${b.line}:${b.col}`)
    }
}

const jsMethodExecution = expression => {
    const { method: fullMethod, of, receiver, arguments, otherwise } = expression
    const method = asCamelCase(fullMethod)
    const methodSymbol = sourceNode(method, method.value + (of ? 'Of' : '') + '$')
    const receiverValue = sourceNode(receiver, symbol('receiver'))
    // Issue: arguments should be passed via a $Data instance.
    // This may require the method execution be wrapped within an anonymous function evaluation
    const methodCall = receiver => [
        '.',
        methodSymbol,
        '.$apply(',
        receiver,
        arguments ? [', ', jsData(arguments.map(jsArgument).flat(1))] : '',
        ')'
    ]

    const receiverExpression = jsExpression(receiver)

    if (otherwise || !simple(receiver)) {
        statementsPrepend[statementsPrepend.length - 1] = statementsPrepend[statementsPrepend.length - 1].concat([
            'const ',
            receiverValue,
            ' = ',
            receiverExpression,
            '\n'
        ])
        return [
            otherwise
                ? [
                      receiverValue,
                      '.',
                      methodSymbol,
                      ' !== undefined ? ',
                      receiverValue,
                      methodCall(receiverValue),
                      ' : ',
                      jsExpression(otherwise)
                  ]
                : [receiverValue, methodCall(receiverValue)]
        ]
    } else {
        return otherwise
            ? [
                  receiverExpression,
                  '.',
                  methodSymbol,
                  ' !== undefined ? (',
                  receiverExpression,
                  ')',
                  methodCall(receiverExpression),
                  ' : ',
                  jsExpression(otherwise)
              ]
            : [receiverExpression, methodCall(receiverExpression)]
    }
}

const expressionOperators = {
    exponentiation: 'raised',
    multiplication: 'times',
    division: 'into',
    addition: 'plus',
    subtraction: 'minus'
}

const operatorMethod = (operator, a, b) => [
    jsExpression(a),
    '.',
    sourceNode({
        line: operator.line,
        col: operator.col,
        value: operator
    }),
    '.$apply(',
    jsExpression(b),
    ')'
]

const addNode = (obj, type, source) => ({ type, ...obj, line: source.line, col: source.line })

const jsExpression = expression => {
    traceLog('expression:\t' + JSON.stringify(expression))
    switch (expression.type) {
        case 'identifier':
            return jsExpression({ type: 'location', name: expression, locators: [] })
        case 'expression':
            return jsExpression(expression.expression)
        case 'literal':
            // TODO: allow conversions
            return jsExpression(expression.value)
        case 'location':
            return jsLocation(expression)
        case 'locate':
            return jsExpression(expression.location)
        case 'jsNumber':
            return sourceNode(expression)
        case 'digitNumber':
            return jsExpression({
                type: 'methodExecution',
                prefix: null,
                method: addNode({ value: 'new' }, 'identifier', expression),
                of: true,
                receiver: addNode(
                    {
                        location: addNode(
                            { name: addNode({ value: 'numbers' }, 'identifier', expression), locators: [] },
                            'location',
                            expression
                        )
                    },
                    'locate',
                    expression
                ),
                arguments: [
                    addNode(
                        {
                            location: addNode(
                                { name: addNode({ value: 'number' }, 'identifier', expression), locators: [] },
                                'location',
                                expression
                            ),
                            expression: addNode({ value: expression.value }, 'jsNumber', expression)
                        },
                        'dataDefinition',
                        expression
                    )
                ]
            })
        case 'decimalNumber':
            return sourceNode(expression)
        case 'text':
            // TODO: re-parse. naive version: expression.value.replace(/'/g, '`').replace(/(?<!(\\\\)*\\){/g, '${')
            return sourceNode(expression, "'TODO: text'")
        case 'literal':
            return sourceNode(expression, expression.value.replace(/`/g, "'").replace())
        // TODO: list type should be an object which implements 'itemsOf'
        case 'list':
            return ['[', join(expression.list.map(jsExpression)), ']']
        case 'data':
            return ['{ /* Issue: Data expressions not implemented */ }']

        // Issue: mathematics should be symbolic, which has not been implemented yet
        case 'exponentiation':
        case 'multiplication':
        case 'division':
        case 'addition':
        case 'subtraction':
            return operatorMethod(expressionOperators[expression.type], expression.a, expression.b)

        case 'methodExecution':
            return jsMethodExecution(expression)
        default:
            console.error(`Unknown expression type: ${expression.type}`)
            return sourceNode(expression)
    }
}

const jsDoes = statement => {
    const operators = {
        leadsTo: 'return',
        collect: 'return'
    }
    const { operator, expression } = statement
    if (!operator.type in operators) {
        console.error(`Unknown 'does' operator ${operator.type}`)
    }
    return [sourceNode(operator, operators[operator.type]), ' ', jsExpression(expression), '\n']
}

const jsFor = statement => {
    const indent = '                '
    const { name: fullName, itemizing, expression, extent, statements } = statement
    const name = asCamelCase(fullName)
    const source = statement.do ? symbol('source') : 'source'

    const itemsExtent = symbol('extent')
    const n = symbol('n')
    const items = symbol(methodName + 'Items')

    const memorizeThrough = itemizing && itemizing.value === 'through'
    const oneByOne = itemizing && itemizing.value === 'of'

    const nameSymbol = sourceNode(name, name.value + '$')

    const extentCalculation = (prefix = '') =>
        extent
            ? ['Math.min(', jsExpression(extent), ', ', prefix, source, '.extentOf.$apply()', ')']
            : [prefix, source, '.extentOf.$apply()']

    const itemPrelude = (exit = 'return') => [
        indent,
        '                const ',
        nameSymbol,
        ' = ',
        !statement.do ? contextPrefix : '',
        source,
        '.offsetOf.$apply(',
        n,
        ')\n',
        // Why: This is only *really* needed for one-by-one itemization.
        // But the other alternative is to duplicate the loop with exactly the same code minus this check
        // to make the usual case not have this line. Nb. one-by-one can also be limited by its source's extent.
        indent,
        '                if (',
        nameSymbol,
        ' === undefined) { ',
        exit,
        ' }\n'
    ]

    const memory = statement.do ? symbol('memory') : 'memory'
    const i = statement.do ? symbol('i') : 'i'

    const codePrelude = [indent, 'const ', source, ' = (', jsExpression(expression), ').itemsOf.$apply()\n']

    const loopCode = body => [
        indent,
        '        const ',
        itemsExtent,
        ' = ',
        statement.do ? extentCalculation() : [contextPrefix, extent ? '' : ['.', source], '.extentOf.$apply()'],
        '\n',
        indent,
        '        for (let ',
        n,
        ' = 0; ',
        n,
        ' < ',
        itemsExtent,
        '; ++',
        n,
        ') {\n',
        body,
        indent,
        '        }\n'
    ]

    if (statement.do) {
        pushScope(name)
    } else {
        scopes.push([name])
    }

    const code = statement.do
        ? [codePrelude, loopCode([itemPrelude('break'), statements.map(jsStatement)])]
        : [
              indent,
              'const $context = {\n',
              indent,
              '    ',
              source,
              ': (',
              jsExpression(expression),
              ').itemsOf.$apply()',
              scopesContains({ value: 'self' }) ? [',\n', indent, '    ', 'self$'] : '',
              memorizeThrough
                  ? [
                        ',\n',
                        indent,
                        '    ',
                        memory,
                        ': [],\n',
                        indent,
                        '    value: {\n',
                        indent,
                        // Issue: the $context should contain the reference of the source
                        '        $context: {\n',
                        indent,
                        '            ...this.$context,\n',
                        indent,
                        '            source\n',
                        indent,
                        '        },\n',
                        indent,
                        '        $method:  function (',
                        n,
                        ') {\n',
                        itemPrelude(),
                        statements.map(jsStatement),
                        indent,
                        '        }\n',
                        indent,
                        '    }'
                    ]
                  : '',
              oneByOne ? [',\n', indent, '    ', i, ': 0'] : '',
              '\n',
              indent,
              '}\n',
              indent,
              'return {\n',
              indent,
              '    $context,\n',
              indent,
              '    $apply: function ',
              items,
              '(',
              n,
              ') {\n',
              oneByOne
                  ? [
                        indent,
                        '        if (',
                        n,
                        '!== ',
                        contextPrefix,
                        i,
                        ') { return } else { ++this.',
                        i,
                        ' }\n',
                        itemPrelude(),
                        statements.map(jsStatement)
                    ]
                  : memorizeThrough
                  ? [
                        indent,
                        '        let i = ',
                        contextPrefix,
                        memory,
                        '.length\n',
                        indent,
                        '        if (i > ',
                        n,
                        ') { return ',
                        contextPrefix,
                        memory,
                        '[',
                        n,
                        '] }\n',
                        indent,
                        '        for (; i < ',
                        n,
                        '; ++i) { if (this.$apply(i) === undefined) { return } }\n',
                        indent,
                        '        return ',
                        contextPrefix,
                        memory,
                        '[',
                        n,
                        '] = ',
                        contextPrefix,
                        'value.$apply(',
                        n,
                        ')',
                        '\n'
                    ]
                  : [itemPrelude(), statements.map(jsStatement)],
              indent,
              '    },\n',
              indent,
              '    itemsOf:  {\n',
              indent,
              '        $context: null,\n',
              indent,
              '        $apply: function (self$) {\n',
              indent,
              '            return {\n',
              indent,
              '                offsetOf: {\n',
              indent,
              '                    $context: self$.$context,\n',
              indent,
              '                    $apply:   self$.$apply\n',
              indent,
              '                },\n',
              indent,
              '                extentOf: {\n',
              indent,
              '                    $context: self$.$context,\n',
              indent,
              '                    $apply:   function () { ',
              captureStatementsPrepend(() => ['return ', extentCalculation(contextPrefix)]),
              ' }',
              ',\n',
              indent,
              '                },\n',
              indent,
              '                kindOf:   {\n',
              indent,
              '                    $context: self$.$context,\n',
              indent,
              '                    $apply:   function () { return ',
              oneByOne
                  ? "'one-by-one'"
                  : [contextPrefix, source, ".kindOf.$apply() === 'one-by-one' ? 'one-by-one' : 'sequence'"],
              ' }',
              '\n',
              indent,
              '                }\n',
              indent,
              '            }\n',
              indent,
              '        }\n',
              indent,
              '    },\n',
              indent,
              '}\n'
          ]

    if (statement.do) {
        popScope(name)
    } else {
        scopes.pop()
    }

    return code
}

const jsCase = ({ comments, definition: { is, has, as, statements } }, source) => {
    if (has && (has.type === 'identifier' || as)) {
        pushScope(as ? as : has)
    }
    assignKeyword = 'var'
    code = [
        jsComments(comments),
        '   case ',
        has ? [source, '.has(', jsLocator(has), ')'] : [jsExpression(is), '.valueOf.$apply()'],
        ':\n',
        has && (has.type === 'identifier' || as)
            ? ['var ', sourceNode(as ? as : has), ' = ', source, '.get(', jsLocator(has), ')\n']
            : '',
        // Issue: all nested statements should use 'var', not 'const'
        statements.map(jsStatement),
        '       break\n'
    ]
    if (has && (has.type === 'identifier' || as)) {
        popScope(as ? as : has)
    }
    assignKeyword = 'const'
    return code
}

const jsWhen = statement => {
    const { expression, cases, otherwise } = statement
    const z = symbol('z')
    const has = cases.some(({ definition: { has } }) => has)
    return captureStatementsPrepend(() => [
        // Why: valueOf is used to allow objects to implement different comparison semantics than strict reference check
        // For example objects may decide to implement this using JSON.stringify, if field ordering is required
        isWalrusStatement(expression)
            ? walrusStatement(expression)
            : '',
        has ? ['const ', z, ' = ', jsExpression(isWalrusStatement(expression) ? walrusLocation(expression) : expression), '\n'] : '',
        'switch (',
        has ? z : [jsExpression(isWalrusStatement(expression) ? walrusLocation(expression) : expression), '.valueOf.$apply()'],
        ') {\n',
        cases.map(caseStatement => jsCase(caseStatement, has && z)),
        otherwise ? [jsComments(otherwise.comments), '   default:\n', otherwise.definition.map(jsStatement)] : '',
        '}\n'
    ])
}

const operators = {
    updateExponential: 'raise',
    updateTimes: 'multiply',
    updateDividedBy: 'divide',
    updatePlus: 'add',
    updateMinus: 'subtract'
}

const jsAssignExpandData = statement => {
    const { location, destructuringData, expression } = statement

    if (location) {
        return ['const ', jsLocation(statement.location), ' = ', jsExpression(statement.methodNaming)]
    } else {
    }
}

const jsAssignLocation = (location, expression) => {
    if (!scopesContains(location.name)) {
        const code = [
            assignKeyword,
            ' ',
            sourceNode(location.name, toCamelCase(location.name.value)),
            ' = ',
            location.locators.reduceRight(
                (acc, cur) => ['this.$context.$Data.new.$apply({ properties: { ', jsLocator(cur), ': ', acc, ' } })'],
                jsExpression(expression)
            ),
            '\n'
        ]
        pushScope(location.name)
        return code
    }

    const contextType = scopesType(location.name)
    const nameNode = sourceNode(location.name, (contextType === 'not recent' ? 'this.' : '') + location.name.value)

    if (location.locators.length > 0) {
        const allButLast = [
            { symbol: nameNode },
            ...location.locators.slice(0, -1).map(locator => ({ locator, symbol: symbol(locator.value) }))
        ]

        return [
            allButLast.slice(1).map(({ locator, symbol: nameSymbol }, i) => {
                const z = symbol(locator.value, false)
                return [
                    'const ',
                    z,
                    ' = ',
                    allButLast[i].symbol,
                    '.get(',
                    jsLocator(locator),
                    ');\n',
                    'const ',
                    nameSymbol,
                    ' = ',
                    z,
                    ' === undefined || ',
                    z,
                    '.update === undefined ? ',
                    allButLast[i].symbol,
                    '.update(',
                    jsLocator(locator),
                    ', this.$context.$Data.new.$apply({ properties: {} })) : ',
                    z,
                    ';\n'
                ]
            }),

            allButLast.slice(-1)[0].symbol,
            '.update(',
            jsLocator(location.locators.slice(-1)[0]),
            ', ',
            jsExpression(expression),
            ')\n'
        ]
    }
    throw new Error(`It is not possible to re-assign name ${location.name.value}`)
}

const isWalrusStatement = x => ['assign', 'assignMethodResult'].includes(x.type)

const walrusLocation = statement => {
    switch (statement.type) {
        case 'assign':
            return statement.location
        case 'assignMethodResult':
            return statement.methodNaming.method
        default:
            console.error(`Unknown walrus statement type ${statement.type}`)
    }
}

const walrusStatement = statement => {
    switch (statement.type) {
        case 'assign':
            // Issue: only works for location without locators
            return statement.operator && statement.operator.type in operators
                ? [
                      operatorMethod(operators[statement.operator.type], statement.location, statement.expression),
                      '\n'
                  ]
                : jsAssignLocation(statement.location, statement.expression)

        case 'assignMethodResult':
            code = [
                assignKeyword,
                ' ',
                sourceNode(statement.methodNaming.method, toCamelCase(statement.methodNaming.method.value) + '$'),
                ' = ',
                jsExpression(statement.methodNaming),
                '\n'
            ]
            pushScope(asCamelCase(statement.methodNaming.method))
            return code

        default:
            console.error(`Unknown walrus statement type ${statement.type}`)
    }
}

const jsStatement = statement => {
    traceLog('statement:\t' + JSON.stringify(statement))

    return captureStatementsPrepend(() => {

        if (isWalrusStatement(statement)) {
            return walrusStatement(statement)
        }

        switch (statement.type) {
            case 'standalone':
                return [jsComments(statement.comments), jsStatement(statement.definition)]
            case 'does':
                return jsDoes(statement)
            case 'assignOf':
                // Issue: only works for location without locators
                return statement.operator && statement.operator.type in operators
                    ? [
                          operatorMethod(operators[statement.operator.type], statement.location, statement.expression),
                          '\n'
                      ]
                    : jsAssignLocation(statement.location, statement.expression)
            // Issue: these ones are a little trickier. Can use the parameter input matching code as a starting point
            case 'assignExpandData':
                if (statement.location && !scopesContains(statement.location.name)) {
                    pushScope(statement.location.name)
                } else if (statement.destructuringData) {
                    statement.destructuringData.forEach(({ name }) => {
                        if (!scopesContains(name)) {
                            pushScope(name)
                        }
                    })
                }
                return [
                    assignKeyword,
                    ' ',
                    symbol('assignExpandData'),
                    ' = null /* Issue: assignExpandData not implemented */\n'
                ]
            case 'assignExpandList':
                if (statement.location && !scopesContains(statement.location.name)) {
                    pushScope(statement.location.name)
                }
                return [
                    assignKeyword,
                    ' ',
                    symbol('assignExpandList'),
                    ' = null /* Issue: assignExpandList implemented */\n'
                ]

            case 'methodExecution':
                return [jsMethodExecution(statement), '\n']
            case 'for':
                return jsFor(statement)
            case 'when':
                return jsWhen(statement)
            case 'expand':
                return []
            default:
                console.error(`Unknown statement type ${statement.type}`)
        }
    })
}

const jsSections = (sections) => sections.map(({ name: sectionName, context, methods }) => {
    // Issue: should all method names in this namespace be added to scope?
    // They are not actually in scope, but would prefer not to allow variables with the same name?

    scopes = [context.definition.map(({ definition: { name, as } }) => asCamelCase(as ?? name))]

    /*
    renames = new Map(
        context
            ? new Map(
                context.definition.map(({ definition: { name: { value } } }, i) => [value, base26.to(i + 1)])
            )
            : []
    )
*/

    const functions = methods.map(
        ({ comments, definition }) => {
            let { name, of, receiver, inputs, statements } = definition
            // Issue: this should use the receiver keyword and its metadata

            inputs = inputs || []

            traceLog('method:\t' + JSON.stringify(name))
            traceLog('method definition:\t' + JSON.stringify(definition))
            traceLog('')
            methodName = toCamelCase(name.value + (of ? 'Of' : '') + '$')
            scopes.push([{ line: name.line, col: name.col, value: 'self' }])

            const deform = inputs.length
                ? [
                    {
                        type: 'destructuring',
                        collectionType: 'data',
                        inputs: inputs.map(({ definition }) => definition),
                        name: { line: inputs.line, col: inputs.col, value: 'inputs' }
                    }
                ]
                : []

            const indent = '                '
            const scopeVariables = []
            const deformedInputs = []

            // Issue: RHS destructuring expressions can actually be quite convoluted and weird,
            // eg. z: { y: { x, w } } against z:y:x and z:y:w
            // May be better to disable them (for now) and let the programmer do that on the next line
            // The downside is that it could lead to more variable name repetition

            while (deform.length) {
                const { inputs, collectionType, name: fullName } = deform.shift()
                name = asCamelCase(fullName)

                scopeVariables.push(inputs.map(({ name, as }) => asCamelCase(as ? as : name)))

                traceLog('inputs:\t' + JSON.stringify(inputs))

                const items = symbol(name.value, false)
                const itemsOffset = symbol(name.value + 'Offset', false)
                const itemsExtentMethod = symbol(name.value + 'ExtentMethod', false)
                const itemsExtent = symbol(name.value + 'Extent', false)

                // Issue: if making this code reusable, switch out const for assignKeyword where needed
                deformedInputs.push([
                    collectionType === 'list'
                        ? [
                            indent,
                            'const ',
                            items,
                            ' = ',
                            sourceNode(name),
                            ' !== undefined ? ',
                            sourceNode(name),
                            name.type === 'quote' ? '.valueOf()' : '',
                            '.itemsOf() : $nullItemization\n',

                            inputs.slice(1).some(({ grouping }) => grouping)
                                ? [indent, 'const ', itemsExtentMethod, ' = ', items, '.extentOf\n']
                                : '',
                            inputs.some(({ grouping }) => !grouping)
                                ? [
                                        indent,
                                        'const ',
                                        itemsOffset,
                                        ' = ',
                                        items,
                                        '.offsetOf\n',
                                        indent,
                                        'const ',
                                        itemsExtent,
                                        ' = ',
                                        items,
                                        '.extentOf()\n'
                                    ]
                                : '',

                            inputs.map(({ grouping, name, otherwise }, i) => {
                                name = asCamelCase(name)
                                const z = symbol(name.value, false)
                                return [
                                    grouping
                                        ? [
                                                i === 0
                                                    ? [indent, 'const ', sourceNode(name), ' = ', items, '\n']
                                                    : [
                                                        indent,
                                                        'function ',
                                                        sourceNode(name),
                                                        '(n) { ',
                                                        name.type === 'quote'
                                                            ? [
                                                                    'const item = ',
                                                                    itemsOffset,
                                                                    '(n + ',
                                                                    String(i),
                                                                    '); return item !== undefined ? item.valueOf() : item'
                                                                ]
                                                            : ['return ', itemsOffset, '(n + ', String(i), ')'],
                                                        ' }\n',
                                                        indent,
                                                        sourceNode(name),
                                                        '.offsetOf',
                                                        ' = ',
                                                        sourceNode(name),
                                                        '\n',
                                                        indent,
                                                        sourceNode(name),
                                                        '.kindOf',
                                                        ' = ',
                                                        items,
                                                        '.kindOf',
                                                        '\n',
                                                        indent,
                                                        sourceNode(name),
                                                        '.extentOf',
                                                        ' = function () { return ',
                                                        itemsExtentMethod,
                                                        '() - ',
                                                        String(i),
                                                        ' }',
                                                        '\n',
                                                        indent,
                                                        sourceNode(name),
                                                        '.itemsOf',
                                                        ' = ',
                                                        'function () { return this }\n',
                                                        indent,
                                                        sourceNode(name),
                                                        '.dataOf',
                                                        ' =  function () {\n',
                                                        '   const data = this.$context.$Data.new.apply({ properties: {} })\n',
                                                        '   const extent = this.extentOf()\n',
                                                        '   for (let n = 0; n < extent; ++n) {\n',
                                                        '       const z = ',
                                                        sourceNode(name),
                                                        '(n)\n',
                                                        '       if (z === undefined) { break }\n',
                                                        '       data.set(n, z)\n',
                                                        '   }\n',
                                                        '   return data\n',
                                                        '}\n'
                                                    ]
                                            ]
                                        : [
                                                indent,
                                                'const ',
                                                otherwise || name.type === 'quote' ? z : sourceNode(name),
                                                ' = ',
                                                itemsExtent,
                                                ' > ',
                                                String(i),
                                                ' ? ',
                                                itemsOffset,
                                                '(',
                                                String(i),
                                                ') : undefined',
                                                '\n',
                                                otherwise || name.type === 'quote'
                                                    ? [
                                                        indent,
                                                        'const ',
                                                        sourceNode(name),
                                                        ' = ',
                                                        z,
                                                        ' !== undefined ? ',
                                                        z,
                                                        name.type === 'quote' ? '.valueOf()' : '',
                                                        ' : ',
                                                        otherwise ? jsExpression(otherwise) : z,
                                                        '\n'
                                                    ]
                                                    : '',
                                                '\n'
                                            ]
                                ]
                            }),
                            '\n'
                        ]
                        : [
                            indent,
                            'const ',
                            items,
                            ' = ',
                            sourceNode(name),
                            ' !== undefined ? ',
                            sourceNode(name),
                            name.type === 'quote' ? '.valueOf()' : '',
                            '.dataOf() : $nullData\n',

                            inputs.map(({ grouping, name, as, otherwise }, i) => {
                                name = asCamelCase(name)
                                as = as && asCamelCase(as)
                                const z = symbol(name.value, false)
                                return [
                                    grouping
                                        ? [
                                                indent,
                                                'const ',
                                                sourceNode(name),
                                                ' = this.$context.$Data.new.$apply({ properties: ',
                                                items,
                                                ' })\n',
                                                inputs
                                                    .slice(0, i)
                                                    .map(({ name: arg }) => [
                                                        sourceNode(name),
                                                        ".delete('",
                                                        sourceNode(arg),
                                                        "')\n"
                                                    ])
                                            ]
                                        : [
                                                otherwise || name.type === 'quote'
                                                    ? [
                                                        indent,
                                                        'const ',
                                                        z,
                                                        ' = ',
                                                        items,
                                                        ".get('",
                                                        sourceNode(name),
                                                        "')\n",
                                                        indent,
                                                        'const ',
                                                        sourceNode(asCamelCase(as ? as : name)),
                                                        ' = ',
                                                        z,
                                                        ' !== undefined ? ',
                                                        z,
                                                        name.type === 'quote' ? '.valueOf()' : '',
                                                        ' : ',
                                                        otherwise ? jsExpression(otherwise) : z,
                                                        '\n'
                                                    ]
                                                    : [
                                                        indent,
                                                        'const ',
                                                        sourceNode(asCamelCase(as ? as : name)),
                                                        ' = ',
                                                        items,
                                                        ".get('",
                                                        sourceNode(name),
                                                        "');\n"
                                                    ]
                                            ]
                                ]
                            }),
                            '\n'
                        ]
                ])

                inputs.forEach(({ name, destructuring }) => {
                    destructuring && deform.push({ ...destructuring, name })
                })
            }

            scopeVariables.forEach(variables => pushScope(variables))

            const code = [
                '\n\n',
                sourceNode(
                    name,
                    [
                            jsComments(comments),
                            '        ',
                            sourceNode(name, methodName),
                            ': {\n',
                            '            $context,\n',
                            '            $apply: function ',
                            sourceNode(name, methodName),
                            '(self$',
                            inputs.length ? ', inputs$' : '',
                            ') {\n',
                            deformedInputs,
                            statements.map(jsStatement),
                            '            },',
                            `
        itemsOf: {
            $context: null,
            $apply:  function (self$) {
                return {
                    offsetOf: {
                        $context: self$.$context,
                        $apply:   self$.$apply
                    },
                    extentOf: {
                        $context: null,
                        $apply:  function () { return Infinity }
                    },
                    kindOf:   {
                        $context: null,
                        $apply:  function () { return 'offset' }
                    }
                }
            }
        }
`,

                            // Issue: it's quite helpful to have chaining like prototypes,
                            //   so that most objects can have similarity in the top of the shape,
                            //   but there can be different code available.
                            // Could make Object.create(null)
                            // Could use normal inheritance but prepend all names with $$ to distinguish from Object.prototype's methods?
                            // Should the inheritance chain be on the top-level methods (dataOf, etc.),
                            //    or on a separate prototype-ish object?
                            // I think it might as well be the whole thing.
                            //
                            // Two basic approaches:
                            // class $2020_09_Ranges_Function extends $2020_09_Ranges_Context { }
                            // rangesContext = {...}; Object.setPrototypeOf(rangesContext, Object.create(null))
                            // rangesCountingFrom = {...}; Object.setPrototypeOf(rangesCountingFrom, rangesContext)
                            //
                            // There's a problem with the former, which is that functions from different sections will
                            // have different hidden classes due to having different formors.
                            // So really have to use literals to get the right effect.
                            '        }'
                        ]
                )
            ]

            scopes.pop()
            return code
        }
    )

    const sectionSymbol = symbol(sectionName.value)

    const dependencies = jsInputs(context.definition)

    return sourceNode(sectionName, [
        "    ['",
        sourceNode(sectionName),
        "']: ",
        dependencies
            ? [
                'function ',
                sectionSymbol,
                '($context) {\n',
                '        return {\n\n',
                join(functions, ',\n'),
                '\n\n\n\n        }',
                '\n    }'
            ]
            : ['{\n\n', join(functions, ',\n'), '\n\n\n\n    }']
    ])
})

const jsProgram = (sections, fileName) => {

    sections.forEach(({ name: sectionName, context, methods }) => {
        methods.forEach(({ comments, definition: { name, of, receiver, inputs, statements } }) => {
            // Issue: it's not possible to re-order statements with data dependency,
            // but the compiler could work this out. Can / should we try to reorder statements in a method
            //  so that dependencies don't need to be defined before their uses? eg.
            // a = [b]
            // b = 1

            inputs = inputs || []

            const names = inputs.filter(({ definition: { type } }) => type === 'input')
            const group = inputs.filter(({ definition: { type } }) => ['inputSingleton', 'inputGroup'].includes(type))

            // Issue: validate there is at most one group and it's at the end
            if (group.length > 1) {
                throw new Error('Cannot have more than one input group per method')
            }

            // Issue: groups and lists shouldn't be able to have an otherwise or an 'as' rename,
            //  as we are already already specifying a new name in their definition
            // Issue: only data-matching should allow 'otherwise', not group or list parameters?
            //  Not sure about that - I agree for group, but surely an itemization could have an 'otherwise'.
            // Issue: validate that a matching list or data container is not empty, it has at least 1 thing in it
            // Issue: check all inputs, dependencies and assignment statements to prevent name clash

            // Issue: validate to disallow 'return' directly from for-do - should use 'stop' instead.
        })
    })

    return new SourceNode(1, 0, fileName, [
    `'use strict';


//require('v8-compile-cache')


const $context = {
Number: {
    new: {
        $context: null,
        $apply:   function (self$, input) {
            const $context = input
            return {
                itemsOf: {
                    $context,
                    $apply: function () {
                        const $context = this.$context
                        return {
                            offsetOf: {
                                $context, $apply: function (self$) { return self$ }
                            },
                            extentOf: {
                                $context, $apply: function ()      { return this.$context.number$ }
                            },
                            kindOf:   {
                                $context, $apply: function ()      { return 'offset' }
                            }
                        }
                    }
                },
                valueOf: {
                    $context,
                    $apply: function () { return this.$context.number$ }
                }
            }
        }
    }
},
Data: {
    new: {
        $context: {
            Entries: {
                $context: null,
                $apply:   Object.entries
            },
            Entry: {
                $context: {
                    Values: {
                        $context: null,
                        $apply:   Object.values
                    }
                },
                $apply: function (self$) {
                    const $context = {
                        properties: { [self$[0]]: self$[1] },
                        Values: this.$context.Values
                    }
                    return {
                        valueOf: {
                            $context,
                            $apply: function (self$) {
                                const values = this.$context.Values.$apply(this.$context.properties)
                                if (values.length === 1) {
                                    return values[0]
                                } else {
                                    return self$
                                }
                            }
                        }
                    }
                }
            }
        },
        $apply: function (self$, input) {
            const $context = {
                properties: input.properties,
                Entries:    this.$context.Entries,
                Entry:      this.$context.Entry
            }
            return {
                itemsOf: {
                    $context,
                    $apply: function () {
                        const $context = {
                            memory: this.$context.Entries.$apply(this.$context.properties),
                            Entry:  this.$context.Entry
                        }
                        return {
                            offsetOf: {
                                $context,
                                $apply: function (self$) {
                                    return this.$context.Entry.$apply(this.$context.memory[self$])
                                }
                            },
                            extentOf: {
                                $context,
                                $apply: function () { return this.$context.memory.length }
                            },
                            kindOf:   {
                                $context: null,
                                $apply: function () { return 'offset' }
                            }
                        }
                    }
                },
                update: {
                    $context,
                    $apply: function (self$, input) {
                        this.$context.properties[input.property$] = input.value$
                    }
                }
            }
        }
    }
}
}



module.exports = {
\n\n\n`,
    join(jsSections(sections), ',\n'),
    '\n\n\n\n}\n\nconsole.log("Hello, World!") // FIXME: grim hack\n\n'
])
}

return jsProgram
}


const builder = (fileName, options) => {

    const build = sections => {
        return sections.map(({ context, methods }) => {
            return methods.map(({ definition }) => {
                let { name, of, receiver, inputs, statements } = definition
            })
        })
    }

    return build
}


const fetch = async(programPath) => {
    const [provider, userRepo] = programPath.split(':')
    const [user, repo] = userRepo.split('/')
    // FIXME: validate user or repo aren't ".."
    const fileName = `${repo}.program.dklng`
    const filePathPart = `${provider}/${user}/${repo}`
    const fileDir = `${__dirname}/../../sources/${filePathPart}`
    const filePath = `${fileDir}/${fileName}`

    // TODO: Redis cache?
    try {
        const data = await readFile(filePath, 'utf8')
        return { fileName, filePathPart, data }
    } catch (err) {

    }

    await mkdir(fileDir, { recursive: true })

    const sourcesProviders = {
        // FIXME: encode
        github: (user, repo) => `https://raw.githubusercontent.com/${user}/${repo}/HEAD/${fileName}`
    }

    sourceProvider = sourcesProviders[provider]
    if (sourceProvider == null) {
        throw new Error(`Unsupported sources provider ${provider}`)
    }

    const path = sourceProvider(user, repo)
    const response = await axios.get(path)

    // FIXME: ensure data is saved in utf8 form regardless of server response
    // Nb. this could change its hash checksum from the original...
    await writeFile(filePath, response.data)
    return { fileName, filePathPart, data: response.data }
}

function run(path) {
    return spawn(process.argv[0], [`${__dirname}/../outputs/${path}`], {
        detached: true,
        stdio: 'inherit'
    });
}

async function main() {
    try {

        const optionator = require('optionator')({
            prepend: 'Usage: dklng [command] [options]',
            append: 'Version 1.0.0',
            options: [
                {
                    option: 'help',
                    alias: 'h',
                    type: 'Boolean',
                    description: 'displays help'
                },
                {
                    option: 'show-parse-tree',
                    type: 'Boolean',
                    description: 'displays the parse tree'
                },
                {
                    option: 'show-parse-trace',
                    type: 'Boolean',
                    description: 'displays the parse trace as it is walked'
                },
                {
                    option: 'rebuild',
                    type: 'Boolean',
                    description: 'Causes any cached program to be ignored'
                }
            ]
        })
        
        const options = optionator.parseArgv(process.argv)
        if (options.help) {
            console.log(optionator.generateHelp())
        }
        
        if (options._.length < 1) {
            throw new Error("Please specify a command, eg. run")
        }

        switch (options._[0]) {
            case 'run':
                //
                break
            default:
                throw new Error(`Unrecognised command ${options._[0]}`)
        }

        if (options._.length < 2) {
            throw new Error("Please supply a program path, eg. github:ducklang-community/hello")
        }

        const sourceName = options._[1]
        const { fileName, filePathPart, data } = await fetch(sourceName)

        if (!options.rebuild) {
            try {
                await access(`${__dirname}/../outputs/${filePathPart}/${fileName}.js`, constants.R_OK)
                return run(`${filePathPart}/${fileName}.js`)
            } catch (err) {

            }
        }

        const parser = new Parser(Grammar.fromCompiled(grammar))

        parser.feed(data)

        if (parser.results.length === 0) {
            console.error('Expected more input')
            process.exit(1)
        } else if (parser.results.length === 1) {
            const { sections } = parser.results[0]

            if (options.showParseTree) {
                console.log(JSON.stringify(sections, null, 2))
                console.log('Good parse')
            }

            const build = builder(fileName, options)
            const metaProgram = build(sections)

            const jsProgram = compiler(fileName, options)

            // Issue: I'm keen to get the best IC performance from V8. Does it make sense to express all objects as:
            // A = (a) => ({ a: ... }); B = (a, b) => ({ a: ..., b: ... }); C = (a, b, c) => ({ a: ..., b: ..., c: ... })
            //
            // This would ensure exactly sized objects and maximum possible object shape similarity
            //
            // Issue: invoking with a Map is generally ~75% performance of plain object,
            // and ~33% of plain object with a dedicated 'self' argument (eg. function (self=this, inputs={}) )

            // Issue: add the description comment to the top of the generated code,
            // if the intention is for the output to be readable

            // Issue: better to use the term "function" instead of "method",
            //        everything be a $Function, with itemsOf parameterised
            // Issue: itemsOf sounds a bit weird for functions. Consider "itemizationOf" instead
            const { code, map } = jsProgram(sections).toStringWithSourceMap()

            await mkdir(`${__dirname}/../outputs/${filePathPart}`, { recursive: true })
            await writeFile(`${__dirname}/../outputs/${filePathPart}/${fileName}.js`, code)
            await writeFile(`${__dirname}/../outputs/${filePathPart}/${fileName}.js.map`, JSON.stringify(map))

            // Issue: make the output prettier, eg. with right indentation and nice variable names
            // (nb. prettier isn't viable as it doesn't do source mapping. Workarounds exist but are slow)

            // Issue: set the line,col source mapping of closing tags to be something at the end of the source

            return run(`${filePathPart}/${fileName}.js`)

        } else {
            if (options.showParseTree) {
                console.log(JSON.stringify(parser.results, null, 2))
            }
            for (var i = 0; i < parser.results.length - 1; i += 2) {
                console.error(jsonDiff.diffString(parser.results[i], parser.results[i + 1]))
            }

            console.error(parser.results.length + ' (ambiguous) parses')
            process.exit(1)
        }
    } catch (err) {
        console.error(err)
        process.exit(1)
    }
}

main()

/*




use software,
    category

setupHelper = function of x with y, z:
	for each foo in x, do:
		make foo with y, z

baseConcept = import software with id: 717189784315811721173404183
Base = use baseConcept with software, category
base = init new Base

components = import software with {
	Blaster:        { author: 'terry', version: '2.3.0' },
	turboConcept:   { author: 'jill',  version: '0.1.0' },
	rocketConcept:  { author: 'alex',  version: '1.0.2' },
	RocketFix:      { author: 'rick',  version: '0.0.2' },
	programConcept: { author: 'clive', version: '4.0.0' },
}
otherwise default new of category.data

BetterData = use betterDataConcept with log
extend category.data with BetterData

NicerRocketFix = rename RocketFix with
	init: 'initRocketFix'

blaster = new Blaster

Turbo = use turboConcept with log
turbo = new of Turbo

basicCategory = readOnly of category with
	names: ['data', 'number', 'literal', 'list', 'text', 'rational']

note:`Important pattern here: We create a partial applied sections,
	  which still has some free dependencies.
	  Then at 'new' time, the remaining dependencies are completed,
	  which are the "instance" variables of the object`
Rocket = use rocketConcept with log, category: basicCategory
category.rocket = new category with Rocket, NicerRocketFix
rocket = new of category.rocket with blaster, turbo, offset: 720

engageBoosters of rocket with angle: 93.4, thrust: 42
*/
