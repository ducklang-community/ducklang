const fs = require('fs')
const nearley = require('nearley')
const { SourceNode } = require('source-map')
const grammar = require('../dist/grammar.js')

let methodName

const join = (array, space = ' ') =>
    array
        .map(item => [',' + space, item])
        .flat()
        .slice(1)

const traceLog = message => {
    if (options['show-parse-trace']) {
        console.log(message)
    }
}

const symbols = {}
const symbol = name => {
    name = name.replace(/[^a-zA-Z0-9_]/g, '_')
    symbols[name] = name in symbols ? symbols[name] + 1 : 0
    return name + '$' + (symbols[name] || '')
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

const jsLocation = location => [
    sourceNode(location.name),
    location.locators ? ' /* Issue: locators not implemented */ ' : ''
]

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

const dataSymbolSingleton = symbol('data')

const jsData = definitions => {
    return [
        '(function () { const ',
        dataSymbolSingleton,
        ' = new $Map(); ',
        // Issue: should also support assignExpandData here
        definitions
            .filter(({ type }) => type === 'dataDefinition')
            .map(({ location, expression }) => [
                dataSymbolSingleton,
                ".set('",
                jsLocation(location),
                "', ",
                expression ? jsExpression(expression) : jsLocation(location),
                '); '
            ]),
        'return ',
        dataSymbolSingleton,
        ' })()'
    ]
}

// Why: text is not considered simple for this purpose because of the formatting required
const simple = expression =>
    ['locate', 'digitNumber', 'decimalNumber', 'hexNumber', 'literal', 'quote'].includes(expression.type)

const simpleTypes = {
    literal: 'text',
    quote: 'text',
    text: 'text',
    digitNumber: 'number',
    decimalNumber: 'number',
    hexNumber: 'number'
}

const jsArgument = (b, i, inputs) => {
    // Issue: should support assignExpandData too
    if (b.type === 'dataDefinition') {
        return b
    } else {
        if (b.type === 'locate') {
            return { type: 'dataDefinition', location: b.location }
        } else {
            const type = simpleTypes[b.type] !== undefined ? simpleTypes[b.type] : 'expression'
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
    // Issue: arguments should be passed via a $Map instance.
    // This may require the method execution be wrapped within an anonymous function evaluation
    const methodCall = ['.', methodSymbol, '(', arguments ? jsData(arguments.map(jsArgument)) : '', ')']
    return otherwise
        ? !simple(receiver)
            ? [
                  '(() => { ',
                  `const ${receiverValue} = `,
                  jsExpression(receiver),
                  '; ',
                  'return ',
                  receiverValue,
                  '.',
                  methodSymbol,
                  ' !== undefined ? ',
                  receiverValue,
                  methodCall,
                  ' : ',
                  jsExpression(otherwise),
                  ' })()'
              ]
            : [
                  '(',
                  jsExpression(receiver),
                  ').',
                  methodSymbol,
                  ' !== undefined ? (',
                  jsExpression(receiver),
                  ')',
                  methodCall,
                  ' : ',
                  jsExpression(otherwise)
              ]
        : ['(', jsExpression(receiver), ')', methodCall]
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
        // Issue: arguments is expected to be a Data structure
        // In this case we're passing any expression.
        // A solution might be to take eg. 2 -> { number: 2 }
        // where we just give a generic label number/text/list/data on the expression,
        // or if its type is unknown then "value"
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
            return sourceNode(expression)
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

const containsAwaited = statements => {
    // Issue: need to implement containsAwaited
    return false
}

const jsFor = statement => {
    const { awaited, name, itemizing, expression, extent, statements } = statement
    const source = simple(expression) ? jsExpression(expression) : symbol('source')
    const sourceExtent = symbol('sourceExtent')
    const sourceOffset = symbol('sourceOffset')
    const itemsExtent = symbol('extent')
    const n = symbol('n')
    const z = symbol('z')
    const items = symbol(methodName + 'Items')
    const item = symbol(methodName + 'Item')

    const memorizeThrough = itemizing && itemizing.value === 'through'
    const oneByOne = itemizing && itemizing.value === 'of'

    const extentSymbol = symbol(methodName + 'Extent')

    const extentCalculation = extent
        ? ['Math.min(', jsExpression(extent), ', ', statement.do ? [source, '.extentOf'] : [sourceExtent, '()'], ')']
        : ''

    const itemPrelude = (exit = 'return') => [
        '   const ',
        sourceNode(name),
        ' = ',
        awaited ? 'await ' : '',
        sourceOffset,
        '(',
        n,
        ')\n',
        // Why: This is only *really* needed for one-by-one itemization.
        // But the other alternative is to duplicate the loop with exactly the same code minus this check
        // to make the usual case not have this line. Nb. one-by-one can also be limited by its source's extent.
        '   if (',
        sourceNode(name),
        ' === undefined) { ',
        exit,
        ' }\n'
    ]

    const memory = symbol('memory')
    const i = symbol('i')

    const codePrelude = [
        !simple(expression) ? ['const ', source, ' = ', jsExpression(expression), '\n'] : '',
        'const ',
        sourceOffset,
        ' = ',
        source,
        '.offsetOf',
        '\n',
        !statement.do ? ['const ', sourceExtent, ' = ', source, '.extentOf', '\n'] : ''
    ]

    const loopCode = body => [
        'const ',
        itemsExtent,
        ' = ',
        statement.do
            ? [extent ? extentCalculation : [source, '.extentOf()']]
            : [extent ? extentSymbol : sourceExtent, '()'],
        '\n',
        'for (let ',
        n,
        ' = 0; ',
        n,
        ' < ',
        itemsExtent,
        '; ++',
        n,
        ') {\n',
        body,
        '}\n'
    ]

    const isAsync = awaited || containsAwaited(statements)

    return statement.do
        ? [codePrelude, loopCode([itemPrelude('break'), statements.map(jsStatement)])]
        : [
              memorizeThrough ? ['const ', memory, ' = []\n'] : '',
              oneByOne ? ['let ', i, ' = 0\n'] : '',
              codePrelude,

              isAsync ? 'async ' : '',
              'function ',
              items,
              '(',
              n,
              ') {\n',
              oneByOne
                  ? ['   if (', n, '!== ', i, ') { return } else { ++i }\n', itemPrelude(), statements.map(jsStatement)]
                  : memorizeThrough
                  ? [
                        '   if (',
                        memory,
                        '.length > ',
                        n,
                        ') { return ',
                        memory,
                        '[',
                        n,
                        '] }\n',
                        '   for (let ',
                        i,
                        ' = ',
                        memory,
                        '.length; ',
                        i,
                        ' < ',
                        n,
                        '; ++',
                        i,
                        ') { if (',
                        isAsync ? 'await ' : '',
                        items,
                        '(',
                        i,
                        ') === undefined) { return } }\n',
                        '   return ',
                        memory,
                        '[',
                        n,
                        '] = ',
                        isAsync ? 'await ' : '',
                        '(',
                        isAsync ? 'async ' : '',
                        'function () {\n',
                        itemPrelude(),
                        statements.map(jsStatement),
                        '   })()\n'
                    ]
                  : [itemPrelude(), statements.map(jsStatement)],
              '}\n',
              // Why: having offsetOf be a separate method while leaving the "items" object as
              // a plain function is intended to allow extensibility for user code to define itemizations
              // easily in Ducklang code, while also keeping conformity with the automatic "itemizable"
              // nature of every method defined in Ducklang, which should help the interpreter to compile
              // monomorphic code in the usual case.
              items,
              '.offsetOf',
              ' = ',
              items,
              '\n',
              items,
              '.kindOf',
              ' = ',
              !oneByOne && !memorizeThrough
                  ? [source, '.kindOf\n']
                  : [
                        'function () { return ',
                        oneByOne ? "'one-by-one'" : [source, ".kindOf() === 'one-by-one' ? 'one-by-one' : 'sequence'"],
                        ' }\n'
                    ],
              extent
                  ? [
                        'function ',
                        extentSymbol,
                        '() { return ',
                        extentCalculation,
                        ' }\n',
                        items,
                        '.extentOf',
                        ' = ',
                        extentSymbol
                    ]
                  : [items, '.extentOf', ' = ', sourceExtent],
              '\n',
              items,
              '.itemsOf',
              ' = ',
              '$self\n',
              // Why: This method intentionally does not await, that's left to be done explicitly later if required,
              // firstly to maintain consistency with dataOf() elsewhere, and secondly to not do a slower one-by-one awaiting
              items,
              '.dataOf',
              ' = function () {\n',
              '   const data = new $Map()\n',
              loopCode([
                  '       const z = ',
                  items,
                  '(',
                  n,
                  ')\n',
                  '       if (z === undefined) { break }\n',
                  '       data.set(',
                  n,
                  ', z)\n'
              ]),
              '   return data\n',
              '}\n',
              'return ',
              items,
              '\n'
          ]
}

const jsCase = ({ comments, definition: { expression, statements } }) => {
    return [
        jsComments(comments),
        '   case (',
        jsExpression(expression),
        ').valueOf():\n',
        statements.map(jsStatement),
        '       break\n'
    ]
}

const jsWhen = statement => {
    const { expression, cases, otherwise } = statement
    return [
        // Why: valueOf is used to allow objects to implement different comparison semantics than strict reference check
        // For example objects may decide to implement this using JSON.stringify, if field ordering is required
        'switch ((',
        jsExpression(expression),
        ').valueOf()) {\n',
        cases.map(jsCase),
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
                : ['const ', jsLocation(statement.location), ' = ', jsExpression(statement.expression), '\n']
        // Issue: these ones are a little trickier. Can use the parameter input matching code as a starting point
        case 'assignExpandData':
            return ['const ', symbol('assignExpandData'), ' = null /* Issue: assignExpandData not implemented */\n']
        case 'assignExpandList':
            return ['const ', symbol('assignExpandList'), ' = null /* Issue: assignExpandList implemented */\n']

        case 'assignMethodResult':
            return [
                'const ',
                sourceNode(statement.methodNaming.method),
                ' = ',
                jsExpression(statement.methodNaming),
                '\n'
            ]
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

    if (options['show-parse-tree']) {
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

        const functions = methods.map(
            ({ comments, definition: { name, of, receiver, inputs, statements, sequence } }) => {
                traceLog('\n' + JSON.stringify(name))

                methodName = name.value + (of ? 'Of' : '')

                inputs = inputs || []
                receiver &&
                    !sequence &&
                    receiver.reverse().forEach(name => {
                        inputs.unshift({
                            type: 'entry',
                            entry: {
                                type: 'input',
                                name,
                                ...(name.value === 'self' && {
                                    otherwise: {
                                        type: 'locate',
                                        location: {
                                            type: 'location',
                                            name: { line: name.line, col: name.col, value: 'this' }
                                        }
                                    }
                                })
                            }
                        })
                    })

                const deconstruct = inputs.length
                    ? [
                          {
                              name: { line: inputs.line, col: inputs.col, value: '$inputs' },
                              inputs: inputs.map(({ entry }) => entry),
                              type: 'data'
                          }
                      ]
                    : []

                const deconstructedInputs = []

                while (deconstruct.length) {
                    const { name, inputs, type } = deconstruct.shift()

                    traceLog(JSON.stringify(inputs))

                    const items = symbol('items')
                    const itemsOffset = symbol('itemsOffset')
                    const itemsExtentMethod = symbol('itemsExtentMethod')
                    const itemsExtent = symbol('itemsExtent')

                    deconstructedInputs.push([
                        type === 'list'
                            ? [
                                  'const ',
                                  items,
                                  ' = ',
                                  sourceNode(name),
                                  ' !== undefined ? ',
                                  sourceNode(name),
                                  name.type === 'quote' ? '.valueOf()' : '',
                                  '.itemsOf() : $nullItemization\n',

                                  inputs.slice(1).some(({ grouping }) => grouping)
                                      ? ['const ', itemsExtentMethod, ' = ', items, '.extentOf\n']
                                      : '',
                                  inputs.some(({ grouping }) => !grouping)
                                      ? [
                                            'const ',
                                            itemsOffset,
                                            ' = ',
                                            items,
                                            '.offsetOf\n',
                                            'const ',
                                            itemsExtent,
                                            ' = ',
                                            items,
                                            '.extentOf()\n'
                                        ]
                                      : '',

                                  inputs.map(({ grouping, name, otherwise }, i) => {
                                      const z = symbol('z')
                                      const n = symbol('n')
                                      return [
                                          grouping
                                              ? [
                                                    i === 0
                                                        ? ['const ', sourceNode(name), ' = ', items, '\n']
                                                        : [
                                                              'function ',
                                                              sourceNode(name),
                                                              '(',
                                                              n,
                                                              ') { ',
                                                              name.type === 'quote'
                                                                  ? [
                                                                        'const item = ',
                                                                        itemsOffset,
                                                                        '(',
                                                                        n,
                                                                        ' + ',
                                                                        String(i),
                                                                        '); return item !== undefined ? item.valueOf() : item'
                                                                    ]
                                                                  : [
                                                                        'return ',
                                                                        itemsOffset,
                                                                        '(',
                                                                        n,
                                                                        ' + ',
                                                                        String(i),
                                                                        ')'
                                                                    ],
                                                              ' }\n',
                                                              sourceNode(name),
                                                              '.offsetOf',
                                                              ' = ',
                                                              sourceNode(name),
                                                              '\n',
                                                              sourceNode(name),
                                                              '.kindOf',
                                                              ' = ',
                                                              items,
                                                              '.kindOf',
                                                              '\n',
                                                              sourceNode(name),
                                                              '.extentOf',
                                                              ' = function () { return ',
                                                              itemsExtentMethod,
                                                              '() - ',
                                                              String(i),
                                                              ' }',
                                                              '\n',
                                                              sourceNode(name),
                                                              '.itemsOf',
                                                              ' = ',
                                                              '$self\n',
                                                              sourceNode(name),
                                                              '.dataOf',
                                                              ' =  function () {\n',
                                                              '   const data = new $Map()\n',
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
                                  'const ',
                                  items,
                                  ' = ',
                                  sourceNode(name),
                                  ' !== undefined ? ',
                                  sourceNode(name),
                                  name.type === 'quote' ? '.valueOf()' : '',
                                  '.dataOf() : $nullData\n',

                                  inputs.map(({ grouping, name, as, otherwise }, i) => {
                                      const z = symbol('z')
                                      const n = symbol('n')
                                      return [
                                          grouping
                                              ? [
                                                    'const ',
                                                    sourceNode(name),
                                                    ' = new $Map(',
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
                                                              'const ',
                                                              z,
                                                              ' = ',
                                                              items,
                                                              ".get('",
                                                              sourceNode(name),
                                                              "')\n",
                                                              'const ',
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
                                                              'const ',
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

                return [
                    '\n\n',
                    sourceNode(
                        name,
                        sequence
                            ? [
                                  jsComments(comments),
                                  sourceNode(name, methodName),
                                  ': ',
                                  ' (function ',
                                  sourceNode(name, methodName),
                                  ' () {\n',
                                  jsStatement(sequence),
                                  '})()'
                              ]
                            : [
                                  jsComments(comments),
                                  sourceNode(name, methodName),
                                  ': ',
                                  '$method(',
                                  containsAwaited(statements) ? 'async ' : '',
                                  'function ',
                                  sourceNode(name, methodName),
                                  '(',
                                  inputs.length ? '$inputs' : '',
                                  ') {\n',
                                  deconstructedInputs,
                                  statements.map(jsStatement),
                                  '})'
                              ]
                    )
                ]
            }
        )

        const namespaceSymbol = symbol(namespaceDeclaration.value)

        // Issue: Should use Map for the Data type, not Object

        return sourceNode(namespaceDeclaration, [
            '\n\n',
            "['",
            sourceNode(namespaceDeclaration),
            "']: ",
            dependencies
                ? [
                      'function ',
                      namespaceSymbol,
                      '(',
                      dependencies,
                      ') {\n',
                      '   return {\n\n',
                      join(functions, ''),
                      '\n\n',
                      '   }\n',
                      '}'
                  ]
                : ['{\n\n', join(functions, '\n'), '\n\n', '}']
        ])
    })

    // Issue: add the description comment to the top of the generated code,
    // if the intention is for the output to be readable
    const { code, map } = new SourceNode(1, 0, fileName, [
        '\n',
        'function $self() { return this }\n',
        "function $offset() { return 'offset' }\n",
        'function $empty() { return 0 }\n',
        'function $infinity() { return Infinity }\n',
        '\n',
        'class $Map extends Map {\n',
        '   itemsOf() {\n',
        '       const saved = []\n',
        '       const entries = this.entries()\n',
        '       function items(n) {\n',
        '           for (let i = saved.length; i < n; ++i) { if (items(i) === undefined) { return } }\n',
        '           if (saved.length === n) {\n',
        '               const entry = entries.next()\n',
        '               if (entry.done) {\n',
        '                   return\n',
        '               }\n',
        '               const map = new $Entry()\n',
        '               map.set(entry.value[0], entry.value[1])\n',
        '               saved[n] = map\n',
        '               return map\n',
        '           } else if (saved.length > n) {\n',
        '               return saved[n]\n',
        '           }\n',
        '       }\n',
        '       items.offsetOf = items\n',
        "       items.kindOf = function () { return 'sequence' }\n",
        '       items.extentOf = () => this.size()\n',
        '       items.itemsOf = $self\n',
        '       items.dataOf = () => this\n',
        '       return items\n',
        '   }\n',
        '   dataOf() { return this }\n',
        '}\n',
        '\n',
        'class $Entry extends $Map {\n',
        '   valueOf() { return this.values().next().value }\n',
        '   itemsOf() {\n',
        '       const items = (n) => {\n',
        '           if (n === 0) {\n',
        '               return this\n',
        '           }\n',
        '       }\n',
        '       items.offsetOf = items\n',
        '       items.kindOf = $offset\n',
        '       items.extentOf = function () { return 1 }\n',
        '       items.itemsOf = $self\n',
        '       items.dataOf = () => this\n',
        '       return items\n',
        '   }\n',
        '}\n',
        '\n',
        'function $methodOffsetOf(fn) { return function (self) { return fn({ self }) } }\n',
        '\n',
        'function $method(fn) {\n',
        '   fn.offsetOf = $methodOffsetOf(fn)\n',
        '   fn.kindOf = $offset\n',
        '   fn.extentOf = $infinity\n',
        '   fn.itemsOf = $self\n',
        // Why: dataOf would usually loop up to the extent building a Map of n => value,
        // but for all methods that would just be an infinite loop.
        // undefined seems a good alternative
        '   fn.dataOf = undefined\n',
        '   return fn\n',
        '}\n',
        '\n',
        'const $nullItemization = (function () {\n',
        '   function items() {}\n',
        '   items.offsetOf = items\n',
        '   items.kindOf = $offset\n',
        '   items.extentOf = $empty\n',
        '   items.itemsOf = $self\n',
        '   items.dataOf = () => $nullData\n',
        '   return items\n',
        '})()\n',
        '\n',
        'const $nullItemsOf = function () { return $nullItemization }\n',
        '\n',
        'const $nullData = (function () { const data = new $Map(); data.itemsOf = $nullItemsOf; return data })()\n',
        '\n',
        '\n',
        '\n',
        'module.exports = {\n',
        join(compiledModules, '\n\n'),
        '}\n',
        '\n'
    ]).toStringWithSourceMap()

    fs.mkdirSync(`dist/${fileName.split('/').slice(0, -1).join('/')}`, { recursive: true })
    fs.writeFileSync(`dist/${fileName.replace(/\.dg$/, '.js')}`, code)
    fs.writeFileSync(`dist/${fileName.replace(/\.dg$/, '.map')}`, JSON.stringify(map))

    // Issue: make the output prettier, eg. with right indentation and nice variable names
    // (nb. prettier isn't viable as it doesn't do source mapping. Workarounds exist but are slow)

    // Issue: set the line,col source mapping of closing tags to be something at the end of the source
} else {
    if (options['show-parse-tree']) {
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
