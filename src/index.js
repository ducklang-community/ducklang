const fs = require('fs')
const nearley = require('nearley')
const { SourceNode } = require('source-map')
const grammar = require('../dist/grammar.js')

let methodName
let scopes = []
let assignKeyword = 'const'

const scopesContains = name => scopes.flat(Infinity).find(({ value }) => value === name.value)

const scopesType = name =>
    scopes[scopes.length - 1].find(({ value }) => value === name.value)
        ? 'recent'
        : 'not recent'

const pushScope = name => {
    if (typeof name === 'array') {
        name.forEach(identifier => pushScope(identifier))
    } else {
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
    if (typeof name === 'array') {
        throw new Error(`Cannot popScope on an array`)
        
    } else {
        const scope = scopes[scopes.length - 1]
        const position = scope.indexOf(name)
        if (position < 0) {
            throw new Error(`Could not find variable to pop scope from: name "${name.value}" at line ${name.line}, column ${name.col}`)
        }
        scopes.push(scopes.pop().slice(0, position))
    }
}

const withScope = (scope, thunk) => {
    scopes.push(scope)
    const result = thunk()
    scopes.pop()
    return result
}

const join = (array, separator = ', ') =>
    array
        .map(item => [separator, item])
        .flat()
        .slice(1)

const traceLog = message => {
    if (options.showParseTrace) {
        console.log(message)
    }
}

const symbols = {}
const symbol = (name, slug = true) => {
    if (slug) {
        name = name.replace(/[^a-zA-Z0-9_]/g, '_')
    }
    symbols[name] = name in symbols ? symbols[name] + 1 : 0
    return '_$' + name + (symbols[name] || '')
}

const sourceNode = (ref, code) => new SourceNode(ref.line, ref.col - 1, fileName, code || ref.value)

const jsComment = ({ line, annotation, literal }) =>
    line
        ? sourceNode(line, `// ${line.value}\n`)
        : literal.value.includes('\n')
        ? sourceNode(annotation, `/*\n${annotation.value}: ${literal.value}\n*/\n`)
        : sourceNode(annotation, `// ${annotation.value}: ${literal.value}\n`)

const jsComments = comments => (comments ? comments.map(comment => jsComment(comment)) : [])

const jsInputs = items => join(items.map(({ entry: { name } }) => sourceNode(name)))

const jsLocator = locator => {
    if (false && locator.type === 'identifier') {
        return sourceNode(locator, "'" + locator.value + "'")
    }
    return sourceNode(locator)
}

const jsLocation = (location, definition = false) => {
    const { name } = location
    if (!definition && name.value !== 'this' && !scopesContains(name)) {
        throw new Error(
            `Attempt to use name "${name.value}" in line ${name.line}, column ${name.col}, but it is undefined`
        )
    }

    const contextType = scopesType(name)
    const nameNode = sourceNode(name, (contextType === 'not recent' ? 'this.' : '') + name.value)

    if (location.locators && location.locators.length > 1) {
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
    return [nameNode, location.locators ? ['.get(', jsLocator(location.locators[0]), ')'] : '']
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
        join(definitions
            .filter(({ type }) => type === 'dataDefinition')
            .map(({ location, expression }) => [
                jsLocator(location.name),
                ": ",
                expression ? jsExpression(expression) : jsLocation(location),
            ])),
        ' }'
    ]
}

// Why: text is not considered simple for this purpose because of the formatting required
const simple = expression =>
    ['locate', 'literal', 'quote'].includes(expression.type)

const simpleTypes = {
    literal: 'text',
    quote: 'text',
    text: 'text',
    digitNumber: 'number',
    decimalNumber: 'number',
    hexNumber: 'number'
}

// Issue: I originally intended:
// with { self:result:input } to be like:
//   x = { result: { self:result:input } } with { self: x }
//
// But I think that would be inconsistent with the usual meaning of self:result:input.
// So I think it's best in that case to treat it like an anonymous expression.
// Nb. with { ...{ input }: self:result } already gives the other obvious semantics,
// so there seems little point in copying that behaviour

const jsArgument = (b, i, inputs) => {
    // Issue: should support assignExpandData too
    if (b.type === 'dataDefinition') {
        return b
    } else {
        if (b.type === 'locate') {
            return { type: 'dataDefinition', location: b.location }
        } else {
            const type = simpleTypes[b.type] !== undefined ? simpleTypes[b.type] : 'value'
            const previousOfType = inputs.slice(0, i).filter(x => simpleTypes[x.type] === type).length
            const name = type + (previousOfType > 0 ? previousOfType : '')
            return {
                type: 'dataDefinition',
                location: { type: 'location', name: { type: 'identifier', line: b.line, col: b.col, value: name } },
                expression: b
            }
        }
    }
}

const jsMethodExecution = expression => {
    const { method, of, receiver, arguments, otherwise } = expression
    const methodSymbol = sourceNode(method, method.value + (of ? 'Of' : ''))
    const receiverValue = sourceNode(receiver, symbol('receiver'))
    // Issue: arguments should be passed via a $Data instance.
    // This may require the method execution be wrapped within an anonymous function evaluation
    const methodCall = receiver => ['.', methodSymbol, '.$value(', receiver, arguments ? [', ', jsData(arguments.map(jsArgument))] : '', ')']

    const receiverExpression = jsExpression(receiver)

    return otherwise || !simple(receiver)
        ? [
                '(() => { ',
                'const ', receiverValue, ' = ',
                receiverExpression,
                '; ',
                'return ',
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
                : [receiverValue, methodCall(receiverValue)],
                ' })()'
            ]
        : [
            otherwise
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
        ]
}

const expressionOperators = {
    exponentiation: 'raised',
    multiplication: 'times',
    division: 'into',
    addition: 'plus',
    subtraction: 'minus'
}

const operatorMethod = (operator, a, b) =>
    jsExpression({
        type: 'methodExecution',
        method: {
            line: operator.line,
            col: operator.col,
            value: expressionOperators[operator]
        },
        receiver: a,
        arguments: [b]
    })

const jsExpression = expression => {
    traceLog(JSON.stringify(expression))
    switch (expression.type) {
        case 'location':
            return jsLocation(expression)
        case 'locate':
            return jsExpression(expression.location)
        case 'digitNumber':
            return ['$number(', sourceNode(expression), ')']
        case 'decimalNumber':
            return sourceNode(expression)
        case 'text':
            return sourceNode(expression, expression.value.replace(/'/g, '`').replace(/(?<!(\\\\)*\\){/g, '${'))
        case 'literal':
            return sourceNode(expression, expression.value.replace(/`/g, "'").replace())
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
            return operatorMethod(expression.type, expression.a, expression.b)

        case 'methodExecution':
            return jsMethodExecution(expression)
        default:
            console.error(`Unknown expression type ${expression.type}`)
            return sourceNode(expression)
    }
}

const jsDoes = statement => {
    const operators = {
        result: 'return',
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
    const { name, itemizing, expression, extent, statements } = statement
    const source = symbol('source')
    const sourceExtent = symbol('sourceExtent')
    const sourceOffset = symbol('sourceOffset')
    const itemsExtent = symbol('extent')
    const n = symbol('n')
    const items = symbol(methodName + 'Items')
    const extentSymbol = symbol(methodName + 'Extent')

    const memorizeThrough = itemizing && itemizing.value === 'through'
    const oneByOne = itemizing && itemizing.value === 'of'

    const extentCalculation = () => extent
        ? ['Math.min(', jsExpression(extent), ', ', statement.do ? [source, '.extentOf()'] : ['this.', sourceExtent, '()'], ')']
        : ''

    const itemPrelude = (exit = 'return') => [
        indent, '        const ',
        sourceNode(name),
        ' = ',
        !statement.do ? 'this.' : '',
        sourceOffset,
        '(',
        n,
        ')\n',
        // Why: This is only *really* needed for one-by-one itemization.
        // But the other alternative is to duplicate the loop with exactly the same code minus this check
        // to make the usual case not have this line. Nb. one-by-one can also be limited by its source's extent.
        indent, '        if (',
        sourceNode(name),
        ' === undefined) { ',
        exit,
        ' }\n'
    ]

    const memory = symbol('memory')
    const i = symbol('i')

    const codePrelude = [
        indent, 'const ',
        source,
        ' = (',
        jsExpression(expression),
        ').itemsOf()\n',
        // Issue: I'm not certain which is better, taking reference of source.offsetOf or invoking the method directly.
        //        Would normally assume the former, but maybe V8 can inline method calls more easily?
        //        It would be nice to know from benchmarking of real code
        indent, 'const ',
        sourceOffset,
        ' = ',
        source,
        '.$value',
        '\n',
        !statement.do ? [indent, 'const ', sourceExtent, ' = ', source, '.extentOf', '\n'] : ''
    ]

    const loopCode = body => [
        indent, '        const ',
        itemsExtent,
        ' = ',
        statement.do
            ? [extent ? extentCalculation() : [source, '.extentOf()']]
            : ['this.', extent ? extentSymbol : sourceExtent, '()'],
        '\n',
        indent, '        for (let ',
        n,
        ' = 0; ',
        n,
        ' < ',
        itemsExtent,
        '; ++',
        n,
        ') {\n',
        body,
        indent, '        }\n'
    ]

    if (statement.do) {
        pushScope(name)
    } else {
        scopes.push([name])
    }

    const code = statement.do
        ? [codePrelude, loopCode([itemPrelude('break'), statements.map(jsStatement)])]
        : [
              memorizeThrough ? [indent, 'const ', memory, ' = []\n'] : '',
              oneByOne ? ['let ', i, ' = 0\n'] : '',
              codePrelude,


            extent
            ? [
                indent, 'function ',
                extentSymbol,
                '() { return ',
                extentCalculation(),
                ' }\n'
            ]
            : [],
            indent, 'return Object.setPrototypeOf({\n',
            indent,
              '    itemsOf: ',
              'function () { return this },\n',
              indent,
              '    dataOf:  function () {\n',
              indent, '        const data = new $Data()\n',
              loopCode([
                  indent, '            const z = ',
                  'this.$value(',
                  n,
                  ')\n',
                  indent, '            if (z === undefined) { break }\n',
                  indent, '            data.set(',
                  n,
                  ', z)\n'
              ]),
              indent, '        return data\n',
              indent, '    },\n',
              // Why: having offsetOf be a separate method while leaving the "items" object as
              // a plain function is intended to allow extensibility for user code to define itemizations
              // easily in Ducklang code, while also keeping conformity with the automatic "itemizable"
              // nature of every method defined in Ducklang, which should help the interpreter to compile
              // monomorphic code in the usual case.
              indent, '    $value:  function ',
              items,
              '(',
              n,
              ') {\n',
              oneByOne
                  ? [indent, '        if (', n, '!== this.', i, ') { return } else { ++this.', i, ' }\n', itemPrelude(), statements.map(jsStatement)]
                  : memorizeThrough
                  ? [
                    indent, '        let i = this.',
                    memory,
                    '.length\n',
                    indent, '        if (i > ',
                        n,
                        ') { return this.',
                        memory,
                        '[',
                        n,
                        '] }\n',
                        indent, '        for (; i < ',
                        n,
                        '; ++i) { if (this.$value(i) === undefined) { return } }\n',
                        indent, '        return this.',
                        memory,
                        '[',
                        n,
                        '] = ',
                        '(',
                        'function () {\n',
                        itemPrelude(),
                        statements.map(jsStatement),
                        indent, '    })()\n'
                    ]
                  : [itemPrelude(), statements.map(jsStatement)],
              indent, '    },\n',
              indent, '    kindOf:   ',
              !oneByOne && !memorizeThrough
                  ? [source, '.kindOf']
                  : [
                        'function () { return ',
                        oneByOne ? "'one-by-one'" : ['this.', source, ".kindOf() === 'one-by-one' ? 'one-by-one' : 'sequence'"],
                        ' }'
                    ],
                ',\n',
              extent
                  ? [

                        indent, '    extentOf: ',
                        extentSymbol
                    ]
                  : [indent, '    extentOf: ', sourceExtent],
              '\n',
              indent, '}, Object.setPrototypeOf({\n',
              scopesContains({ value: 'self' }) ? [indent, '    ', 'self,\n'] : '',
              indent, '    ', source, ',\n',
              indent, '    ', sourceOffset,
              !statement.do ? [',\n', indent, '    ', sourceExtent] : '',
              !statement.do && extent ? [',\n', indent, '    ', extentSymbol] : '',
              memorizeThrough ? [',\n', indent, '    ', memory] : '',
              oneByOne ? [',\n', indent, '    ', i] : '',
              '\n', indent, '}, null))\n'
          ]

    if (statement.do) {
        popScope(name)
    } else {
        scopes.pop()
    }

    return code
}

const jsCase = ({ comments, definition: { is, has, as, statements } }, source) => {
    if (has && has.type === 'identifier') {
        pushScope(has)
    }
    assignKeyword = 'var'
    code = [
        jsComments(comments),
        '   case ',
        has ? [source, '.has(', jsLocator(has), ')'] : ['(', jsExpression(is), ').valueOf()'],
        ':\n',
        has && (has.type === 'identifier' || as)
            ? ['var ', sourceNode(as ? as : has), ' = ', source, '.get(', jsLocator(has), ')\n']
            : '',
        // Issue: all nested statements should use 'var', not 'const'
        statements.map(jsStatement),
        '       break\n'
    ]
    assignKeyword = 'const'
    return code
}

const jsWhen = statement => {
    const { expression, cases, otherwise } = statement
    const z = symbol('z')
    const has = cases.some(({ definition: { has } }) => has)
    return [
        // Why: valueOf is used to allow objects to implement different comparison semantics than strict reference check
        // For example objects may decide to implement this using JSON.stringify, if field ordering is required
        has ? ['const ', z, ' = (', jsExpression(expression), ').valueOf()\n'] : '',
        'switch (',
        has ? z : ['(', jsExpression(expression), ').valueOf()'],
        ') {\n',
        cases.map(caseStatement => jsCase(caseStatement, has && z)),
        otherwise ? [jsComments(otherwise.comments), '   default:\n', otherwise.definition.map(jsStatement)] : '',
        '}\n'
    ]
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
            sourceNode(location.name),
            ' = ',
            (location.locators || []).reduceRight(
                (acc, cur) => ['new $Data().set(', jsLocator(cur), ', ', acc, ')'],
                jsExpression(expression)
            ),
            '\n'
        ]
        pushScope(location.name)
        return code
    }

    const contextType = scopesType(location.name)
    const nameNode = sourceNode(location.name, (contextType === 'not recent' ? 'this.' : '') + location.name.value)

    if (location.locators) {

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
                    '.set === undefined ? ',
                    allButLast[i].symbol,
                    '.set(',
                    jsLocator(locator),
                    ', new $Data()) : ',
                    z,
                    ';\n'
                ]
            }),

            allButLast.slice(-1)[0].symbol,
            '.set(',
            jsLocator(location.locators.slice(-1)[0]),
            ', ',
            jsExpression(expression),
            ')\n'
        ]
    }
    throw new Error(`It is not possible to re-assign name ${location.name.value}`)
}

const jsStatement = statement => {
    traceLog(JSON.stringify(statement))
    switch (statement.type) {
        case 'standalone':
            return [jsComments(statement.comments), jsStatement(statement.definition)]
        case 'does':
            return jsDoes(statement)
        case 'assignWith':
            // Issue: only works for location without locators
            return statement.operator && statement.operator.type in operators
                ? jsStatement({
                      type: 'methodExecution',
                      method: {
                          line: statement.operator.line,
                          col: statement.operator.col,
                          value: operators[statement.operator.type]
                      },
                      receiver: statement.location,
                      arguments: [statement.expression]
                  })
                : jsAssignLocation(statement.location, statement.expression)
        // Issue: these ones are a little trickier. Can use the parameter input matching code as a starting point
        case 'assignExpandData':
            return [
                assignKeyword,
                ' ',
                symbol('assignExpandData'),
                ' = null /* Issue: assignExpandData not implemented */\n'
            ]
        case 'assignExpandList':
            return [
                assignKeyword,
                ' ',
                symbol('assignExpandList'),
                ' = null /* Issue: assignExpandList implemented */\n'
            ]

        case 'assignMethodResult':
            code = [
                assignKeyword,
                ' ',
                sourceNode(statement.methodNaming.method),
                ' = ',
                jsExpression(statement.methodNaming),
                '\n'
            ]
            pushScope(statement.methodNaming.method)
            return code
        case 'methodExecution':
            return [jsMethodExecution(statement), '\n']
        case 'for':
            return jsFor(statement)
        case 'when':
            return jsWhen(statement)
        default:
            console.error(`Unknown statement type ${statement.type}`)
    }
}

const optionator = require('optionator')({
    prepend: 'Usage: cmd [options]',
    append: 'Version 1.0.0',
    options: [
        {
            option: 'help',
            alias: 'h',
            type: 'Boolean',
            description: 'displays help'
        },
        {
            option: 'file',
            alias: 'f',
            type: 'String',
            required: true,
            description: 'A Ducklang file to compile',
            example: 'cmd --file definitions.dg'
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
        }
    ]
})

var options = optionator.parseArgv(process.argv)
if (options.help) {
    console.log(optionator.generateHelp())
}

const fileName = options.file
const data = fs.readFileSync(fileName).toString()

const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))
parser.feed(data)

if (parser.results.length === 0) {
    console.error('Expected more input')
    process.exit(1)
} else if (parser.results.length === 1) {
    const { description, modules } = parser.results[0]

    if (options.showParseTree) {
        console.log(JSON.stringify(modules, null, 2))
        console.log('Good parse')
    }

    modules.forEach(({ namespaceDeclaration, using, methods }) => {
        methods.forEach(({ comments, definition: { name, of, receiver, inputs, statements } }) => {
            // Issue: it's not possible to re-order statements with data dependency,
            // but the compiler could work this out. Can / should we try to reorder statements in a method
            //  so that dependencies don't need to be defined before their uses? eg.
            // a = [b]
            // b = 1

            inputs = inputs || []

            const names = inputs.filter(({ entry: { type } }) => type === 'input')
            const group = inputs.filter(({ entry: { type } }) => ['inputSingleton', 'inputGroup'].includes(type))

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
        })
    })

    const compiledModules = modules.map(({ namespaceDeclaration, using, methods }) => {
        const dependencies = (using && jsInputs(using.definition)) || ''

        // Issue: should all method names in this namespace be added to scope?
        // They are not actually in scope, but would prefer not to allow variables with the same name?
        scopes = [...(using ? using.definition.map(({ entry: { name } }) => name) : [])]

        const functions = methods.map(
            ({ comments, definition: { name, of, receiver, inputs, statements, sequence } }) => {
                traceLog('\n' + JSON.stringify(name))

                methodName = '$$' + name.value + (of ? 'Of' : '')
                // Issue: this should use the receiver keyword and its metadata
                scopes.push(!sequence ? [{ line: name.line, col: name.col, value: 'self' }] : [])

                inputs = inputs || []

                const deconstruct = inputs.length
                    ? [
                          {
                              name: { line: inputs.line, col: inputs.col, value: '$inputs' },
                              inputs: inputs.map(({ entry }) => entry),
                              type: 'data'
                          }
                      ]
                    : []

                    const indent = '                '
                const scopeVariables = []
                const deconstructedInputs = []

                // Issue: RHS destructuring expressions can actually be quite convoluted and weird,
                // eg. z: { y: { x, w } } against z:y:x and z:y:w
                // May be better to disable them (for now) and let the programmer do that on the next line
                // The downside is that it could lead to more variable name repetition

                while (deconstruct.length) {
                    const { name, inputs, type } = deconstruct.shift()

                    scopeVariables.push(inputs.map(({ name, as }) => (as ? as : name)))

                    traceLog(JSON.stringify(inputs))

                    const items = symbol(name.value, false)
                    const itemsOffset = symbol(name.value + 'Offset', false)
                    const itemsExtentMethod = symbol(name.value + 'ExtentMethod', false)
                    const itemsExtent = symbol(name.value + 'Extent', false)

                    // Issue: if making this code reusable, switch out const for assignKeyword where needed
                    deconstructedInputs.push([
                        type === 'list'
                            ? [
                                  indent, 'const ',
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
                                            indent, 'const ',
                                            itemsOffset,
                                            ' = ',
                                            items,
                                            '.offsetOf\n',
                                            indent, 'const ',
                                            itemsExtent,
                                            ' = ',
                                            items,
                                            '.extentOf()\n'
                                        ]
                                      : '',

                                  inputs.map(({ grouping, name, otherwise }, i) => {
                                      const z = symbol(name.value, false)
                                      return [
                                          grouping
                                              ? [
                                                    i === 0
                                                        ? [indent, 'const ', sourceNode(name), ' = ', items, '\n']
                                                        : [
                                                              indent, 'function ',
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
                                                              '   const data = new $Data()\n',
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
                                                    indent, 'const ',
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
                                                              indent, 'const ',
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
                                  indent, 'const ',
                                  items,
                                  ' = ',
                                  sourceNode(name),
                                  ' !== undefined ? ',
                                  sourceNode(name),
                                  name.type === 'quote' ? '.valueOf()' : '',
                                  '.dataOf() : $nullData\n',

                                  inputs.map(({ grouping, name, as, otherwise }, i) => {
                                      const z = symbol(name.value, false)
                                      return [
                                          grouping
                                              ? [
                                                    indent, 'const ',
                                                    sourceNode(name),
                                                    ' = new $Data(',
                                                    items,
                                                    ')\n',
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
                                                              indent, 'const ',
                                                              z,
                                                              ' = ',
                                                              items,
                                                              ".get('",
                                                              sourceNode(name),
                                                              "')\n",
                                                              indent, 'const ',
                                                              sourceNode(as ? as : name),
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
                                                              indent, 'const ',
                                                              sourceNode(as ? as : name),
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

                    inputs.forEach(({ name, destructuringList, destructuringData }) => {
                        destructuringList && deconstruct.push({ name, inputs: destructuringList, type: 'list' })
                        destructuringData && deconstruct.push({ name, inputs: destructuringData, type: 'data' })
                    })
                }

                scopeVariables.forEach(variables => pushScope(variables))

                const code = [
                    '\n\n',
                    sourceNode(
                        name,
                        sequence
                            ? [
                                  jsComments(comments),
                                  "        ",
                                  sourceNode(name, methodName),
                                  ': (function ',
                                  sourceNode(name),
                                  ' () {\n',
                                  jsStatement(sequence),
                                  '        }).call($context)'
                            ]
                            : [
                                  jsComments(comments),
                                  "        ",
                                  sourceNode(name, methodName),
                                  ': Object.setPrototypeOf({\n',
                                  '            itemsOf:  function () { return this },\n',
                                    // Why: dataOf would usually loop up to the extent building a Map of n => value,
                                    // but for all methods that would just be an infinite loop.
                                    // undefined seems a good alternative
                                  '            dataOf:   function () { return undefined },\n',
                                  '            $value:   function ',
                                  sourceNode(name),
                                  '(self',
                                  inputs.length ? ', $inputs' : '',
                                  ') {\n',
                                  deconstructedInputs,
                                  statements.map(jsStatement),
                                  '            },\n',
                                  "            kindOf:   function () { return 'offset' },\n",
                                  '            extentOf: function () { return Infinity }\n',

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
                                  // There's a problem with the former, which is that functions from different modules will
                                  // have different hidden classes due to having different constructors.
                                  // So really have to use literals to get the right effect.
                                  '        }, $context)'
                              ]
                    )
                ]

                scopes.pop()
                return code
            }
        )

        const namespaceSymbol = symbol(namespaceDeclaration.value)

        return sourceNode(namespaceDeclaration, [
            "    ['",
            sourceNode(namespaceDeclaration),
            "']: ",
            dependencies
                ? [
                      'function ',
                      namespaceSymbol,
                      '(',
                      dependencies,
                      ') {\n',
                      '        const $context = Object.setPrototypeOf({ ', dependencies, ' }, null)\n',
                      '        return {\n\n',
                      join(functions, ',\n            '),
                      '\n\n\n\n        }',
                      '\n    }'
                  ]
                : ['{\n\n        ', join(functions, ',\n'), '\n\n\n\n    }'],
        ])
    })

    // Issue: I'm keen to get the best IC performance from V8. Does it make sense to express all objects as:
    // A = (a) => ({ a: ... }); B = (a, b) => ({ a: ..., b: ... }); C = (a, b, c) => ({ a: ..., b: ..., c: ... })
    //
    // This would ensure exactly sized objects and maximum possible object shape similarity
    //
    // Issue: invoking with a Map is generally ~75% performance of plain object,
    // and ~33% of plain object with a dedicated 'self' argument (eg. function (self=this, $inputs={}) )

    // Issue: add the description comment to the top of the generated code,
    // if the intention is for the output to be readable

    // Issue: better to use the term "function" instead of "method",
    //        everything be a $Function, with itemsOf parameterised
    // Issue: itemsOf sounds a bit weird for functions. Consider "itemizationOf" instead
    const { code, map } = new SourceNode(1, 0, fileName, [
        `
$context = null
function $self() { return this }
function $offset() { return 'offset' }
function $empty() { return 0 }

// Why: the basic types of the language are Function, Data and Number.
// The only way to specify Function type is through
// - method definition
// - itemizations and sequences
// - rest grouping

// All other objects are considered to be essentially some extension of Data.
// Or, Data may be considered an extension of some plain data-less object,
// and Number likewise.
// Generalising, these and Function can be considered to have an intrinsic $value, which may be void ('undefined')

class $Data extends Map {
    itemsOf() {
        const saved = []
        const entries = this.entries()
        function items(n) {
            if (saved.length > n) {
                return saved[n]
            }
            for (let i = saved.length; i < n; ++i) { if (items(i) === undefined) { return } }
            const { value, done } = entries.next()
            if (done) {
                return
            }
            return saved[n] = new $Entry().set(value[0], value[1])
        }
        items.offsetOf = items
        items.kindOf = function () { return 'sequence' }
        items.extentOf = () => this.size
        items.itemsOf = $self
        items.dataOf = () => this
        return items
    }
    dataOf() { return this }
    getOf(inputs) {
        const name = inputs.get('name')
        return name !== undefined ? this.get(name) : name
    }
    update(inputs) {
        for (const value of inputs.entries()) {
            this.set(value[0], value[1])
        }
    }
}

`,
        // Issue: It would be better to roll this into $Data for monomorphism
        //        Just use a "type" field to indicate how valueOf and kindOf should behave
        `
class $Entry extends $Data {
    valueOf() { return this.values().next().value }
    itemsOf() {
        const items = (n) => {
            if (n === 0) {
                return this
            }
        }
        items.offsetOf = items
        items.kindOf = $offset
        items.extentOf = function () { return 1 }
        items.itemsOf = $self
        items.dataOf = () => this
        return items
    }
}

const $nullData = new $Data()

const $nullItemization = function items() {}
$nullItemization.offsetOf = $nullItemization
$nullItemization.kindOf = $offset
$nullItemization.extentOf = $empty
$nullItemization.itemsOf = $self
$nullItemization.dataOf = () => $nullData



module.exports = {
\n\n\n`,
        join(compiledModules, ',\n'),
        '\n\n\n\n}'
    ]).toStringWithSourceMap()

    fs.mkdirSync(`dist/${fileName.split('/').slice(0, -1).join('/')}`, { recursive: true })
    fs.writeFileSync(`dist/${fileName.replace(/\.dg$/, '.js')}`, code)
    fs.writeFileSync(`dist/${fileName.replace(/\.dg$/, '.map')}`, JSON.stringify(map))

    // Issue: make the output prettier, eg. with right indentation and nice variable names
    // (nb. prettier isn't viable as it doesn't do source mapping. Workarounds exist but are slow)

    // Issue: set the line,col source mapping of closing tags to be something at the end of the source
} else {
    if (options.showParseTree) {
        console.log(JSON.stringify(parser.results, null, 2))
    }
    console.error('Ambiguous parse')
    process.exit(1)
}

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

note:`Important pattern here: We create a partial applied module,
	  which still has some free dependencies.
	  Then at 'new' time, the remaining dependencies are completed,
	  which are the "instance" variables of the object`
Rocket = use rocketConcept with log, category: basicCategory
category.rocket = new category with Rocket, NicerRocketFix
rocket = new of category.rocket with blaster, turbo, offset: 720

engageBoosters of rocket with angle: 93.4, thrust: 42
*/
