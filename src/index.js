const fs = require('fs')
const nearley = require("nearley")
const { SourceNode } = require("source-map")
const grammar = require("../dist/grammar.js")

const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))

const fileName = null;
const data = fs.readFileSync(0, 'utf-8')
parser.feed(data)

const jsComment = ({ value }) => value.includes('\n') ? `/*\n${value}\n*/\n` : `// ${value}\n`

const jsComments = (comments) => comments ? comments.map(comment => jsComment(comment)) : []

const jsParameters = (items) =>
    items && items.map(({ definition: { name: { line, col, value } } }) => [', ', new SourceNode(
        line, col - 1, fileName, value
    )]).flat().slice(1) || []

if (parser.results.length === 0) {
    console.error('Expected more input')
}
else if (parser.results.length === 1) {

    const results = parser.results[0]

    console.log(JSON.stringify(results, null, 2))
    console.log('Good parse');

    // TODO: validate the input for any rules that are not easy to put into grammar,
    // For example that the parameter names of a method are unique.
    results.forEach(({ namespaceDeclaration, using, methods }) => {

        methods.map(({ comments, definition: { name, of, receiver, parameters, statements } }) => {

        })

    })

    results.forEach(({ namespaceDeclaration, using, methods }) => {

        const dependencies = using && jsParameters(using.definition) || []

        methods.map(({ comments, definition: { name, of, receiver, parameters, statements } }) => {

            // TODO: check all parameters, dependencies and assignment statements to prevent name clash

            const names = jsParameters(parameters.filter(({ definition: { type } }) => type === 'parameter'))
            const singleton = jsParameters(parameters.filter(({ definition: { type } }) => type === 'parameterSingleton'))

            return new SourceNode(name.line, name.col - 1, fileName, [
                jsComments(comments),
                '($parameters) => {\n',
                    // For any parameters which weren't supplied we can automatically fill in defaults here.
                    'const { ', names,  ' } = $parameters\n',
                '}\n'
            ])
        })

        const namespace = new SourceNode(namespaceDeclaration.line, namespaceDeclaration.col - 1, fileName, [
            '{\n',
                // methods go here, each enclosed by the namespace's parameters
            '}\n'
        ])
    })

    // TODO: make the output as pretty as possible (prettier doesn't do source mapping)

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
