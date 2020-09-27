const fs = require('fs')
const nearley = require("nearley")
const {SourceNode} = require("source-map")
const grammar = require("../dist/grammar.js")


let methodName;


const join = (array) => array.map(item => [', ', item]).flat().slice(1)


const symbols = {}
const symbol = (name) => {
    symbols[name] = name in symbols ? (symbols[name] + 1) : 0
    return name + (symbols[name] && '$' + symbols[name] || '$')
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

const jsLocation = (location) => [sourceNode(location.name), location.locators ? ' /* todo: locators */ ' : '']

const dataDefinition = (definition) => {
    console.log(JSON.stringify(definition))
    switch (definition.type) {
        case 'dataDefinition':
            return jsLocation(definition.location)
        case 'assignExpandData':
            return 'null /* todo: assignExpandData */'
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
    return [
        otherwise
            ? (!simple(receiver)
                ? [
                    '(() => { ',
                    `const ${receiverValue} = `, jsExpression(receiver), '; ',
                    'return ', receiverValue, '.', sourceNode(method), ' !== undefined ? ', receiverValue, methodCall, ' : ', jsExpression(otherwise),
                    ' })()'
                ]
                : [jsExpression(receiver), '.', sourceNode(method), ' !== undefined ? ', jsExpression(receiver), methodCall, ' : ', jsExpression(otherwise)]
            )
            : [jsExpression(receiver), methodCall]
    ]
}

const jsExpression = (expression) => {
    console.log(JSON.stringify(expression))
    switch (expression.type) {
        case 'locate':
            return jsLocation(expression.location)
        case 'digitNumber':
            return sourceNode(expression)
        case 'decimalNumber':
            return sourceNode(expression)
        case 'text':
            // The best way to do formattion is replace ' -> ` and { -> ${
            // so we can use JavaScripts own string formatting
            return [sourceNode(expression), '/* todo: formatting */']
        case 'literal':
            return sourceNode(expression)
        case 'list':
            return ['[', join(expression.list.map(jsExpression)), ']']
        case 'data':
            return ['{ /* todo: data */ }']
        case 'exponentiation':
            return [jsExpression(expression.a), ' ** ', jsExpression(expression.b)]
        case 'multiplication':
            return [jsExpression(expression.a), ' * ', jsExpression(expression.b)]
        case 'division':
            return [jsExpression(expression.a), ' / ', jsExpression(expression.b)]
        case 'addition':
            return [jsExpression(expression.a), ' + ', jsExpression(expression.b)]
        case 'subtraction':
            return [jsExpression(expression.a), ' - ', jsExpression(expression.b)]
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

// TODO: sequences like fibonnaci should execute in-situe as a (() => { })() wrapper

const jsFor = (statement) => {
    const {name, itemizing, expression, extent, statements} = statement
    const source = symbol('source')
    const i = symbol('i')
    const items = symbol(methodName + 'Items')
    const sourceValue = !simple(expression) ? source : jsExpression(expression)

    return statement.do
        ? [
            !simple(expression) ? ['const ', source, ' = ', jsExpression(expression), '\n'] : [],
            'for (let ', i, ' = 0; ', extent ? [i, ' < ', jsExpression(extent)]: '','; ++', i, ') {\n',
            '   const ', sourceNode(name), ' = ', sourceValue, '({ self: ', i, ' })\n',
            '   if (', sourceNode(name), ' === undefined) { break }\n',
            statements.map(jsStatement),
            '}\n',
        ]
        : [
            !simple(expression) ? ['const ', source, ' = ', jsExpression(expression), '\n'] : [],
            'function ', items, '({ self: ', i, ' }) {\n',
            '   const ', sourceNode(name), ' = ', sourceValue, '({ self: ', i, ' })\n',
            '   if (', sourceNode(name), ' === undefined) { return }\n',
            statements.map(jsStatement),
            '}\n',
            extent ? [items, '.extent', ' = function ', symbol(methodName + 'Extent'), '() { return ', jsExpression(extent), ' }\n'] : '',
            'return ', items, '\n'
        ]
}

const jsCase = ({comments, definition: {expression, statements}}) => {
    return [
        jsComments(comments),
        '   case ', jsExpression(expression), ':\n',
        statements.map(jsStatement),
        '       break\n'
    ]
}

const jsWhen = (statement) => {
    const {expression, cases, otherwise} = statement
    return [
        'switch (', jsExpression(expression), ') { ', '{\n',
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
    'updateExponential': '**=',
    'updateTimes': '*=',
    'updateDividedBy': '/=',
    'updatePlus': '+=',
    'updateMinus': '-=',
    'set': '='
}
const jsOperator = (operator) => operators[operator ? operator.type : 'set']

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
            return ['const ', jsLocation(statement.location), ' ', jsOperator(statement.operator), ' ', jsExpression(statement.expression), '\n']

        // TODO: these ones are a little trickier. Deduplicate inputs code
        case 'assignExpandData':
            return ['const ', symbol('assignExpandData'), ' = null /* todo: assignExpandData */\n']
        case 'assignExpandList':
            return ['const ', symbol('assignExpandList'), ' = null /* todo: assignExpandList */\n']

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

    const results = parser.results[0]

    console.log(JSON.stringify(results, null, 2))
    console.log('Good parse');

    results.forEach(({namespaceDeclaration, using, methods}) => {

        methods.forEach(({comments, definition: {name, of, receiver, inputs, statements}}) => {

            inputs = inputs || []

            const names = inputs.filter(({entry: {type}}) => type === 'input')
            const group = inputs.filter(({entry: {type}}) =>
                ['inputSingleton', 'inputGroup'].includes(type))

            // TODO: validate there is at most one group and it's at the end
            if (group.length > 1) {
                throw new Error('Cannot have more than one input group per method')
            }

            // TODO: validate the groups can't have an otherwise or an 'as' rename
            // TODO: validate only data names may have an otherwise
            // TODO: validate that a destructuring list or data has at least 1 thing in it
            // TODO: check all inputs, dependencies and assignment statements to prevent name clash

        })
    })

    const compiled = results.map(({namespaceDeclaration, using, methods}) => {

        const dependencies = using && jsInputs(using.definition) || []

        const functions = methods.map(({comments, definition: {name, of, receiver, inputs, statements, sequence}}) => {

            console.log()
            console.log(JSON.stringify(name))
            methodName = name.value

            inputs = inputs || []
            receiver && receiver.reverse().forEach(name => {
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

                // We destructure one layer at a time so intermediate variables also get defined, eg. in
                // var { main: { content: { title } } } = ...
                // JavaScript will only define 'title' variable, but we also want 'main' and 'content'
                // (using renames as needed to avoid naming collision)

                deconstructedInputs.push([
                    'const ',
                    inputs.length === 1 && inputs[0].grouping
                        ? [sourceNode(inputs[0].name), ' = ', sourceNode(name)]
                        : [
                            type === 'list' ? '[' : '{ ',
                            inputs.map(({grouping, name, as, otherwise, destructuringList, destructuringData}) =>
                                [', ', grouping ? sourceNode(grouping) : '', sourceNode(name), as ? sourceNode(as, [': ', sourceNode(as)]) : '',
                                    otherwise ? sourceNode(otherwise, [' = ', jsExpression(otherwise)])
                                        // NB. this is a bit inefficient as it fully walks the rest of the structure for each layer
                                        // as it goes inward
                                        : (destructuringList && allInputsOptional(destructuringList) ? ' = []'
                                        : (destructuringData && allInputsOptional(destructuringData) ? ' = {}' : ''))]
                            ).flat().slice(1),
                            type === 'list' ? ']' : ' }',
                            ' = ',
                            // TODO: pick these values as needed, not by retrieving the entire set of items
                            sourceNode(name),
                        ],
                    '\n'
                ])

                inputs.forEach(({name, destructuringList, destructuringData}) => {
                    destructuringList && deconstruct.push({name, inputs: destructuringList, type: 'list'})
                    destructuringData && deconstruct.push({name, inputs: destructuringData, type: 'data'})
                })
            }

            const body = sequence ? jsStatement(sequence) : statements.map(jsStatement)

            return ['\n\n',
                sourceNode(name, [
                    jsComments(comments),
                    'function ', sourceNode(name), '(', inputs.length ? ['$inputs', allInputsOptional(inputs.map(({entry}) => entry)) ? ' = {}' : ''] : '', ') {\n',
                    deconstructedInputs,
                    body,
                    '}\n'
                ])
            ]
        })

        return sourceNode(namespaceDeclaration, [
            '\n\n',
            'namespace = {\n',
            // methods go here, each enclosed by the namespace's inputs
            functions,
            '\n\n',
            '}\n'
        ])
    })

    const {code, map} = new SourceNode(0, 0, fileName, compiled).toStringWithSourceMap()
    console.log(code)

    // TODO: make the output as pretty as possible
    // (nb. prettier isn't viable as it doesn't do source mapping. Workarounds exist but are slow)

    // TODO: set the line,col of closing tags to be something at the end of the source
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
