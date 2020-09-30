const fs = require('fs')
const nearley = require("nearley")
const {SourceNode} = require("source-map")
const grammar = require("../dist/grammar.js")


let methodName;


const join = (array, space=' ') => array.map(item => [','+space, item]).flat().slice(1)


const symbols = {}
const symbol = (name) => {
    name = name.replace(/[^a-zA-Z0-9_]/g, '_')
    symbols[name] = name in symbols ? (symbols[name] + 1) : 0
    return name + '$' + (symbols[name] || '')
}

const sourceNode = (ref, code) =>
    new SourceNode(ref.line, ref.col - 1, fileName, code || ref.value)

const jsComment = ({line, annotation, literal}) =>
    line
        ? sourceNode(line, `// ${line.value}\n`)
        : (literal.value.includes('\n')
        ? sourceNode(annotation, `/*\n${annotation.value}: ${literal.value}\n*/\n`)
        : sourceNode(annotation, `// ${annotation.value}: ${literal.value}\n`))


const jsComments = (comments) =>
    comments
        ? comments.map(comment => jsComment(comment))
        : []

const jsInputs = (items) =>
    join(items.map(({entry: {name}}) => sourceNode(name)))

const allInputsOptional = (inputs) =>
    inputs.every(({grouping, otherwise, destructuringList, destructuringData}) =>
        grouping
        || otherwise
        || (destructuringList && allInputsOptional(destructuringList))
        || (destructuringData && allInputsOptional(destructuringData)))

const jsLocation = (location) => [sourceNode(location.name), location.locators ? ' /* Issue: locators not implemented */ ' : '']

const dataDefinition = (definition) => {
    console.log(JSON.stringify(definition))
    switch (definition.type) {
        case 'dataDefinition':
            return jsLocation(definition.location)
        case 'assignExpandData':
            return 'null /* Issue: assignExpandData not implemented */'
        default:
            console.error(`Unknown definition type ${definition.type}`);
            return sourceNode(definition)
    }
}

const jsData = (definitions) => {
    return ['{ ', join(definitions.map(dataDefinition)), ' }']
}

const simple = (expression) => ['locate', 'digitNumber', 'decimalNumber', 'literal'].includes(expression.type)

const jsMethodExecution = (expression) => {
    const {method, receiver, arguments, otherwise} = expression
    const receiverValue = sourceNode(receiver, symbol('receiver'))
    const methodCall = ['.', sourceNode(method), '(', arguments ? jsData(arguments) : [], ')']
    return otherwise
        ? (!simple(receiver)
            ? [
                '(() => { ',
                `const ${receiverValue} = `, jsExpression(receiver), '; ',
                'return ', receiverValue, '.', sourceNode(method), ' !== undefined ? ', receiverValue, methodCall, ' : ', jsExpression(otherwise),
                ' })()'
            ]
            : ['(', jsExpression(receiver), ').', sourceNode(method), ' !== undefined ? (', jsExpression(receiver), ')', methodCall, ' : ', jsExpression(otherwise)]
        )
        : ['(', jsExpression(receiver), ')', methodCall]
}

const expressionOperators = {
    'exponentiation': 'raised',
    'multiplication': 'times',
    'division': 'into',
    'addition': 'plus',
    'subtraction': 'minus'
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

const jsExpression = (expression) => {
    console.log(JSON.stringify(expression))
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
            // Issue: String formatting is not implemented yet. Could use JavaScript's own backtick formatting?
            return [sourceNode(expression), '/* Issue: formatting not implemented */']
        case 'literal':
            return sourceNode(expression)
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
            console.error(`Unknown expression type ${expression.type}`);
            return sourceNode(expression)
    }
}

const jsDoes = (statement) => {
    const operators = {
        'result': 'return',
        'collect': 'return'
    }
    const {operator, expression} = statement
    if (!operator.type in operators) {
        console.log(`Unknown 'does' operator ${operator.type}`)
    }
    return [sourceNode(operator, operators[operator.type]), ' ', jsExpression(expression), '\n']
}

const jsFor = (statement) => {
    const {name, itemizing, expression, extent, statements} = statement
    const source = symbol('source')
    const sourceExtent = symbol('sourceExtent')
    const sourceOffset = symbol('sourceOffset')
    const itemsExtent = symbol('extent')
    const n = symbol('n')
    const items = symbol(methodName + 'Items')
    const item = symbol(methodName + 'Item')

    const memorizeThrough = itemizing && itemizing.value === 'through'
    const oneByOne = itemizing && itemizing.value === 'of'

    const extentSymbol = symbol(methodName + 'Extent')

    const body = [
        '   const ', sourceNode(name), ' = ', sourceOffset, '({ self: ', n, ' })\n',
        // Why: This is only *really* needed for one-by-one itemization.
        // But the other alternative is to duplicate the loop with exactly the same code minus this check
        // to make the usual case not have this line. Nb. one-by-one can also be limited by its source's extent.
        '   if (', sourceNode(name), ' === undefined) { return }\n',
        statements.map(jsStatement)
    ]

    const memory = symbol('memory')
    const i = symbol('i')

    return statement.do
        ? [
            'const ', source, ' = ', jsExpression(expression), '\n',
            'const ', sourceOffset, ' = ', source, '.offsetOf()', '\n',
            'const ', itemsExtent, ' = ', extent ? ['Math.min(', jsExpression(extent), ', ', source, '.extentOf()', ')'] : [source, '.extentOf()'], '\n',
            'for (let ', n, ' = 0; ', n, ' < ', itemsExtent, '; ++', n, ') {\n',
            body,
            '}\n',
        ]
        : [
            memorizeThrough ? ['const ', memory, ' = []\n'] : '',
            oneByOne ? ['let ', i, ' = 0\n'] : '',
            'const ', source, ' = ', jsExpression(expression), '\n',
            'const ', sourceOffset, ' = ', source, '.offsetOf()', '\n',
            extent ? ['const ', sourceExtent, ' = ', source, '.extentOf', '\n'] : '',

            'function ', items, '({ self: ', n, ' = this } = {}) {\n',
            oneByOne
                ? [
                    '   if (', n, '!== ', i, ') { return } else { ++i }\n',
                    body
                ]
                : (memorizeThrough
                    ? [
                        '   if (', memory, '.length > ', n, ') { return ', memory, '[', n, '] }\n',
                        '   for (let ', i, ' = ', memory, '.length; ', i, ' < ', n, '; ++', i, ') { ', items, '({ self: ', i ,' }) }\n',
                        '   return ', memory, '[', n, '] = (function ', item, '() {\n',
                        body,
                        '   })()\n'
                    ]
                    : body),
            '}\n',
            // Why: having offsetOf be a separate method while leaving the "items" object as
            // a plain function is intended to allow extensibility for user code to define itemizations
            // easily in Ducklang code, while also keeping conformity with the automatic "itemizable"
            // nature of every method defined in Ducklang, which should help the interpreter to compile
            // monomorphic code in the usual case.
            items, '.offsetOf', ' = ', '$self\n',
            items, '.kindOf', ' = ',
            !oneByOne && !memorizeThrough
                ? [source, '.kindOf\n']
                : [
                    'function () { return ',
                    oneByOne
                        ? '\'one-by-one\''
                        : [source, '.kindOf() === \'one-by-one\' ? \'one-by-one\' : \'sequence\''],
                    ' }\n',
                ],
            items, '.extentOf', ' = ', extent ? ['function ', extentSymbol, '() { return Math.min(', jsExpression(extent), ', ', sourceExtent, '()) }'] : [source, '.extentOf'], '\n',
            items, '.itemsOf', ' = ', '$self\n',
            'return ', items, '\n'
        ]
}

const jsCase = ({comments, definition: {expression, statements}}) => {
    return [
        jsComments(comments),
        '   case ', jsExpression(expression), '.valueOf():\n',
        statements.map(jsStatement),
        '       break\n'
    ]
}

const jsWhen = (statement) => {
    const {expression, cases, otherwise} = statement
    return [
        // Why: valueOf is used to allow objects to implement different comparison semantics than strict reference check
        // For example objects may decide to implement this using JSON.stringify, if field ordering is required
        'switch (', jsExpression(expression), '.valueOf()) {\n',
        cases.map(jsCase),
        otherwise
            ? [
                jsComments(otherwise.comments),
                '   default:\n',
                otherwise.definition.map(jsStatement),
            ]
            : '',
        '}\n'
    ]
}

const operators = {
    'updateExponential': 'raise',
    'updateTimes': 'multiply',
    'updateDividedBy': 'divide',
    'updatePlus': 'add',
    'updateMinus': 'subtract'
}

const jsAssignExpandData = (statement) => {
    const {location, destructuringData, expression} = statement

    if (location) {
        return ['const ', jsLocation(statement.location), ' = ', jsExpression(statement.methodNaming)]
    } else {
    }
}

const jsStatement = (statement) => {
    console.log(JSON.stringify(statement))
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
            return ['const ', sourceNode(statement.methodNaming.method), ' = ', jsExpression(statement.methodNaming), '\n']
        case 'methodExecution':
            return [jsMethodExecution(statement), '\n']
        case 'for':
            return jsFor(statement)
        case 'when':
            return jsWhen(statement)
        default:
            console.error(`Unknown statement type ${statement.type}`);
    }
}


const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))


const fileName = null;
const data = fs.readFileSync(0, 'utf-8')
parser.feed(data)


if (parser.results.length === 0) {
    console.error('Expected more input')
} else if (parser.results.length === 1) {

    const {description, modules} = parser.results[0]

    console.log(JSON.stringify(modules, null, 2))
    console.log('Good parse');

    modules.forEach(({namespaceDeclaration, using, methods}) => {

        methods.forEach(({comments, definition: {name, of, receiver, inputs, statements}}) => {

            // Issue: it's not possible to re-order statements with data dependency,
            // but the compiler could work this out. Can / should we try to reorder statements in a method
            //  so that dependencies don't need to be defined before their uses? eg.
            // a = [b]
            // b = 1

            inputs = inputs || []

            const names = inputs.filter(({entry: {type}}) => type === 'input')
            const group = inputs.filter(({entry: {type}}) =>
                ['inputSingleton', 'inputGroup'].includes(type))

            // Issue: validate there is at most one group and it's at the end
            if (group.length > 1) {
                throw new Error('Cannot have more than one input group per method')
            }

            // Issue: groups shouldn't be able to have an otherwise or an 'as' rename
            // Issue: only data-matching should allow 'otherwise', not group or list parameters
            // To do: validate that a matching list or data container is not empty, it has at least 1 thing in it
            // To do: check all inputs, dependencies and assignment statements to prevent name clash

        })
    })

    const compiledModules = modules.map(({namespaceDeclaration, using, methods}) => {

        const dependencies = using && jsInputs(using.definition) || ''

        const functions = methods.map(({comments, definition: {name, of, receiver, inputs, statements, sequence}}) => {

            console.log()
            console.log(JSON.stringify(name))

            // To do: make 'of' keyword identical to the name of method plus 'Of'
            methodName = name.value

            inputs = inputs || []
            receiver && !sequence && receiver.reverse().forEach(name => {
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
                                    name: {line: name.line, col: name.col, value: 'this'}
                                }
                            }
                        })
                    }
                })
            })

            const deconstruct = inputs.length
                ? [{
                    name: {line: inputs.line, col: inputs.col, value: '$inputs'},
                    inputs: inputs.map(({entry}) => entry),
                    type: 'data'
                }]
                : []

            const deconstructedInputs = []

            while (deconstruct.length) {
                const {name, inputs, type} = deconstruct.shift()

                console.log(JSON.stringify(inputs))

                const items = symbol('items')

                deconstructedInputs.push([

                    (type === 'list'
                        ? [
                            // To do: use itemization instead of JavaScript destructuring, with input.itemsOf()
                            //   [...rest] should be = input.itemsOf()
                            //   [a, ...rest] should create an anonymous itemization which shifts i by 1 element on input, and shifts extent down by 1
                            //   [a, ..."rest"] should create an anonymous itemization which shifts i by 1 element on input, does get('value') on it, and shifts extent down by 1

                            'const ', items, ' = ', sourceNode(name), '.itemsOf()\n',

                            inputs.map(({grouping, name, as, otherwise, destructuringList, destructuringData}) => [
                                ', ', grouping ? sourceNode(grouping) : '',
                                sourceNode(name), as ? sourceNode(as, [': ', sourceNode(as)]) : '',
                                otherwise ? sourceNode(otherwise, [' = ', jsExpression(otherwise)])
                                    // To do: this is a bit inefficient as it fully walks the rest of the structure for each layer
                                    // as it goes inward
                                    // To do: fix - this incorrectly believes that a group matching to a required list is optional
                                    : (destructuringList && allInputsOptional(destructuringList) ? ' = []'
                                    : (destructuringData && allInputsOptional(destructuringData) ? ' = {}' : ''))
                            ]),

                            '\n'
                        ]
                        : [
                            // To do: use get(name) for data itemization

                            'const ',
                            inputs.map(({grouping, name, as, otherwise, destructuringList, destructuringData}) => [
                                ', ', grouping ? sourceNode(grouping) : '',
                                sourceNode(name), as ? sourceNode(as, [': ', sourceNode(as)]) : '',
                                otherwise ? sourceNode(otherwise, [' = ', jsExpression(otherwise)])
                                    // To do: this is a bit inefficient as it fully walks the rest of the structure for each layer
                                    // as it goes inward
                                    // To do: fix - this incorrectly believes that a group matching to a required list is optional
                                    : (destructuringList && allInputsOptional(destructuringList) ? ' = []'
                                    : (destructuringData && allInputsOptional(destructuringData) ? ' = {}' : ''))
                            ]),
                            '\n'
                        ])
                ])

                inputs.forEach(({name, destructuringList, destructuringData}) => {
                    destructuringList && deconstruct.push({name, inputs: destructuringList, type: 'list'})
                    destructuringData && deconstruct.push({name, inputs: destructuringData, type: 'data'})
                })
            }

            return ['\n\n',
                sourceNode(name,
                    sequence
                        ? [
                            jsComments(comments),
                            sourceNode(name), ': ', ' (function ', sourceNode(name), ' () {\n',
                            jsStatement(sequence),
                            '})()'
                        ]
                        : [
                            jsComments(comments),
                            sourceNode(name), ': ', '$method(function ', sourceNode(name), '(', inputs.length ? ['$inputs', allInputsOptional(inputs.map(({entry}) => entry)) ? ' = {}' : ''] : '', ') {\n',
                            deconstructedInputs,
                            statements.map(jsStatement),
                            '})'
                        ])
            ]
        })

        const namespaceSymbol = symbol(namespaceDeclaration.value)

        // To do: Use Map for the Data type

        // To do: should we do module.exports['::2020-09::Number::'].square = ... ?
        return sourceNode(namespaceDeclaration, [
            '\n\n',
            '[\'', sourceNode(namespaceDeclaration), '\']: ',
            dependencies
                ? [
                    'function ', namespaceSymbol, '(', dependencies, ') {\n',
                    '   return {\n\n',
                    join(functions, ''),
                    '\n\n',
                    '   }\n',
                    '}'
                ]
                : [
                    '{\n\n',
                    join(functions, '\n'),
                    '\n\n',
                    '}'
                ]
        ])
    })

    // To do: add the description to the top of the generated code
    const {code, map} = new SourceNode(0, 0, fileName, [
        '\n',
        'function $offset() { return \'offset\' }\n',
        'function $infinity() { return Infinity }\n',
        'function $self() { return this }\n',
        '\n',
        'function $method(fn) {\n',
        '   fn.offsetOf = $self\n',
        '   fn.kindOf = $offset\n',
        '   fn.extentOf = $infinity\n',
        '   fn.itemsOf = $self\n',
        '   return fn\n',
        '}\n',
        '\n',
        'module.exports = {\n',
        join(compiledModules, '\n\n'),
        '}\n',
        '\n'
    ]).toStringWithSourceMap()
    console.log(code)

    // To do: make the output as pretty as possible
    // (nb. prettier isn't viable as it doesn't do source mapping. Workarounds exist but are slow)

    // To do: set the line,col of closing tags to be something at the end of the source
} else {
    console.log(JSON.stringify(parser.results, null, 2))
    console.error('Ambiguous parse')
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
