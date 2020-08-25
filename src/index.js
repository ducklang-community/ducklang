const fs = require('fs')
const nearley = require("nearley")
const grammar = require("../dist/grammar.js")

const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))

const data = fs.readFileSync(0, 'utf-8')
parser.feed(data)

if (parser.results.length === 0) {
    console.error('Expected more input')
}
else if (parser.results.length === 1) {
    console.log('Good parse');
}
else {
    console.error('Ambiguous parse')
    console.log(parser.results)
}
