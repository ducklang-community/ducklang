@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({

        literal: /"(?:\\["\\]|[^\n"\\])*"/,
        text: /'(?:\\['\\]|[^\n'\\])*'/,

        decimalNumber: /-?[0-9]+\.[0-9]+/,
        digitNumber: /0|-?[1-9][0-9]*/,
        hexNumber: /0x0|0x[1-9a-f][0-9a-f]*/,

		name: /[a-zA-Z]+[a-zA-Z0-9]*/,

        newline: { match: /\n/, lineBreaks: true },
        _: ' ',
        ____: '\t',

        leftParen: '(',
        rightParen: ')',
        leftBrace: '{',
        rightBrace: '}',
        leftBracket: '[',
        rightBracket: ']',

        updateTimes: '=*',
        updateDividedBy: '=/',
        updatePlus: '=+',
        updateMinus: '=-',
        set: '=',

		expand: '...'
        locatorDefine: ':.',
        define: ':',
        locator: '.',
        separator: ',',

        times: '*',
        dividedBy: '/',
        plus: '+',
        minus: '-',
    })
});
%}

@lexer lexer

@builtin "number.ne"
@builtin "string.ne"
@builtin "postprocessors.ne"

does[operator] -> $operator _ expression newline
assignmentWith[operator, expression] -> location _ $operator _ $expression newline
assignmentOf[expression] -> assignmentWith["=",       $expression]
assignment[operator]     -> assignmentWith[$operator, expression]

standalone[definition] -> newline:?
	(____:+ comment):*
	____:+ $definition

indented[definition] -> newline indent $definition dedent
blockOf[$definition] -> indented[standalone[$definition]]

list[definition]    -> delimited[$definition, ("," _)]
items[definition]   -> delimited[$definition, ("," _:+)]
listing[definition] -> delimited[$definition, ("," newline)]

flowing[definition] ->
	  list[$definition]
	| items[$definition] ("," newline _:+ items[$definition]):+

listed[adjusted, definition] -> listing[
		($adjusted comment):*
		$adjusted $definition
	]

elongated[adjusted, definition] -> $definition (","
		listed[$adjusted, $definition]
	):?

listingBlock[definition] ->
	indented[
		listed[____, $definition] newline
	]


main ->
	newline
	use:?
	method:+
	newline

use ->
	commented
	"use" _
	elongated[(_ _ _ _), name]

method ->
	newline
	commented
	name (_ "of"):? _ name (_ "with" _
	elongated[(_ _ _ _ _ _ _ _ _:+), parameter]):? ":"
		blockOf[statement]
	newline


for -> "for" _ "every" _ name _ "in" _ expression ","
	blockOf[statement]

when -> "when" _ expression
	indented[
		(standalone["is" _ expression ":" (_:+ statement
			| blockOf[statement])]):+

    	(standalone["otherwise" ":" (_:+ statement
			| blockOf[statement])]):?
	]


statement ->
	  "stop" newline
	| "skip" newline
    | assignmentOf[("function" _ "of" _ flowing[parameter] ":" _ "result" _ expression)]
	| assignmentOf[("[" flowing[expression] "]")]
	| assignmentOf[("{" _ flowing[dataDefinition] _ "}")]
	| assignmentOf[listBlock]
	| assignmentOf[dataBlock]
    | assignment["="]
    | assignment["=*"]
    | assignment["=/"]
    | assignment["=+"]
    | assignment["=-"]
    | does["collect"]
    | does["result"]
	| methodExecution
    | when
    | for

expression ->
	  location (_ "otherwise" _ "default" _ expression):?
    | simple
    | expression _ "+" _ expression
    | expression _ "-" _ expression
    | expression _ "*" _ expression
    | expression _ "/" _ expression
    | methodExecution

methodExecution ->
	  name (_ "of"):? _ expression
	| name (_ "of"):? _ expression _ "otherwise" _ "default" _ expression
	| name (_ "of"):? _ expression _ "with" _ flowing[dataDefinition]
	| name (_ "of"):? _ expression _ "with" _ "{" _ flowing[dataDefinition] _ "}" (_ "otherwise" _ "default" _ expression):?
	| name (_ "of"):? _ expression _ "with"
		listingBlock[dataDefinition]
	| name (_ "of"):? _ expression _ "with" _ enclosedDataBlock
		(newline "otherwise" _ "default" _ expression):?


listBlock ->  "["
		listingBlock[flowing[expression]]
	"]"


dataBlock -> listingBlock[dataDefinition] | enclosedDataBlock

enclosedDataBlock ->  "{"
		listingBlock[dataDefinition]
	"}"


dataDefinition ->
	  simple ((":" | ":.") _:+ expression):?
	| "..." "{" flowing[simple] "}" ":" _ expression

parameter -> name (_:+ "otherwise" _ expression):?


commented -> comment:*
comment -> annotation _ literal newline
annotation -> "note" | "idea" | "todo"


location -> name ("." simple):?

simple ->
	  name
	| digitNumber
	| decimalNumber
	| literal
	| text

literal -> dqstring
text -> sqstring
decimalNumber -> decimal
digitNumber -> %digitNumber

newline -> %newline
indent -> %indent
dedent -> %dedent
name -> %name
_ -> %_
____ -> %____
