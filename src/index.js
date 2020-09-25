const fs = require('fs')
const nearley = require("nearley")
const { SourceNode } = require("source-map")
const grammar = require("../dist/grammar.js")


const jsComment = ({ line, annotation, literal }) =>
    line
        ? new SourceNode(line.line, line.col - 1, fileName, `// ${line.value}\n`)
        : (literal.value.includes('\n')
            ? new SourceNode(annotation.line, annotation.col - 1, fileName, `/*\n${annotation.value}: ${literal.value}\n*/\n`)
            : new SourceNode(annotation.line, annotation.col - 1, fileName, `// ${annotation.value}: ${literal.value}\n`))


const jsComments = (comments) => comments ? comments.map(comment => jsComment(comment)) : []

const jsParameters = (items) =>
    items.map(({ entry: { name: { line, col, value } } }) =>
        [', ', new SourceNode(line, col - 1, fileName, value)]).flat()

const jsParametersGroup = (item) =>
    item.map(({ entry: { group: { line, col, value } } }) =>
        [', ', '...', new SourceNode(line, col - 1, fileName, value)]).flat()

const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))


const fileName = null;
const data = fs.readFileSync(0, 'utf-8')
parser.feed(data)


if (parser.results.length === 0) {
    console.error('Expected more input')
}
else if (parser.results.length === 1) {

    const results = parser.results[0]

    console.log(JSON.stringify(results, null, 2))
    console.log('Good parse');

    results.forEach(({ namespaceDeclaration, using, methods }) => {

        methods.forEach(({ comments, definition: { name, of, receiver, parameters, statements } }) => {

            parameters = parameters || []

            const names = parameters.filter(({ entry: { type } }) => type === 'parameter')
            const group = parameters.filter(({ entry: { type } }) =>
                ['parameterSingleton', 'parameterGroup'].includes(type))

            if (group.length > 1) {
                throw new Error('Cannot have more than one parameter group per method')
            }

            // TODO: check all parameters, dependencies and assignment statements to prevent name clash

        })

    })

    results.map(({ namespaceDeclaration, using, methods }) => {

        const dependencies = using && jsParameters(using.definition) || []

        methods.map(({ comments, definition: { name, of, receiver, parameters, statements } }) => {

            parameters = parameters || []

            const names     = jsParameters(     parameters.filter(({ entry: { type } }) => type === 'parameter'))
            const group     = jsParametersGroup(parameters.filter(({ entry: { type } }) => type === 'parameterGroup'))
            const singleton = jsParametersGroup(parameters.filter(({ entry: { type } }) => type === 'parameterSingleton'))

            return new SourceNode(name.line, name.col - 1, fileName, [
                jsComments(comments),
                '($parameters) => {\n',
                    'const { ', ...[...names, ...group, ...singleton].slice(1), ' } = $parameters\n',

                    // TODO: get the singleton out, if relevant and group has length 1

                    // TODO: check and fill in the defaults for missing params (will need to move those into a 'let')
                    //  Remember singleton can also have otherwise

                '}\n'
            ])
        })

        return new SourceNode(namespaceDeclaration.line, namespaceDeclaration.col - 1, fileName, [
            '{\n',
                // methods go here, each enclosed by the namespace's parameters
            '}\n'
        ])
    })

    // TODO: make the output as pretty as possible
    // (nb. prettier isn't viable as it doesn't do source mapping. Workarounds exist but are slow)

    // TODO: set the line,col of closing tags to be something at the end of the source
}
else {
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
