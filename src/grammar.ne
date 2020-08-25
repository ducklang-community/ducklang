@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({
        literal: /`(?:\\[`\\]|[^\n`\\])*`/,
        text: /'(?:\\['\\]|[^\n'\\])*'/,

        decimalNumber: /-?[0-9]+\.[0-9]+/,
        digitNumber: /0|-?[1-9][0-9]*/,
        hexNumber: /0x0|0x[1-9a-f][0-9a-f]*/,

		name: {
			match: /[a-zA-Z]+[a-zA-Z0-9]*/,
			type: moo.keywords({
				when: 'when',
				For: 'for',
				result: 'result',
				collect: 'collect',
				of: 'of',
				With: 'with',
			})
		},

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

		expand: '...',
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

# TODO: Make comments not be ambiguous with a method call on a literal.

@lexer lexer

@builtin "postprocessors.ne"

does[operator] -> $operator _ expression newline
assignmentWith[operator, expression] -> location _ $operator _ $expression newline
assignmentOf[expression] -> assignmentWith["=",       $expression]
assignment[operator]     -> assignmentWith[$operator, expression]

standalone[definition] -> newline:?
	(____:+ comment):*
	____:+ $definition

indented[definition] -> newline indent $definition dedent
blockOf[definition]  -> indented[standalone[$definition]:+]

items[definition]   -> delimited[$definition, ("," _:+)]
listing[definition] -> delimited[$definition, ("," newline)] ",":?

flowing[definition] -> items[$definition] ("," newline
	____:* _:+ items[$definition]):*

listed[adjusted, definition] -> listing[(
		($adjusted comment):*
		 $adjusted $definition
	)]

elongated[adjusted, definition] -> $definition ("," newline
		listed[$adjusted, $definition]
	):?

listingBlock[definition] ->
	indented[(
		listed[____:+, $definition] newline
	)]


main ->
	newline
	use:?
	method:+

use ->
	commented
	"use" _
	elongated[(_ _ _ _), name] newline
	newline

method ->
	newline
	commented
	name (_ of):? _ name (_ with _
	elongated[(_ _ _ _ _ _ _ _ _:+), parameter]):? ":"
		blockOf[statement]
	newline

for -> for _ "every" _ name _ "in" _ expression ","
	blockOf[statement]

when -> when _ expression
	indented[(
		(standalone[("is" _ expression ":" (_:+ statement
			| blockOf[statement]))]):+

    	(standalone[("otherwise" ":" (_:+ statement
			| blockOf[statement]))]):?
	)]


statement ->
	  "stop" newline
	| "skip" newline
    | assignmentOf[("function" _ of _ flowing[parameter] ":" _ result _ expression)]
	| assignmentOf[("[" flowing[expression] "]")]
	| assignmentOf[("{" _ flowing[dataDefinition] _ "}")]
	| assignmentOf[listBlock]
	| assignmentOf[dataBlock]
    | assignment["="]
    | assignment["=*"]
    | assignment["=/"]
    | assignment["=+"]
    | assignment["=-"]
    | does[collect]
    | does[result]
	| methodExecution newline
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
	  name (_ of):? _ expression
	| name (_ of):? _ expression _ "otherwise" _ "default" _ expression
	| name (_ of):? _ expression _ with _ flowing[dataDefinition]
	| name (_ of):? _ expression _ with _ "{" _ flowing[dataDefinition] _ "}" (_ "otherwise" _ "default" _ expression):?
	| name (_ of):? _ expression _ with
		listingBlock[dataDefinition]
	| name (_ of):? _ expression _ with _ enclosedDataBlock
		(newline ____:+ "otherwise" _ "default" _ expression):?


listBlock ->  "["
		listingBlock[flowing[expression]]
	____:+ "]"


dataBlock -> listingBlock[dataDefinition] | enclosedDataBlock

enclosedDataBlock ->  "{"
		listingBlock[dataDefinition]
	____:+ "}"


dataDefinition ->
	  simple ((":" | ":.") _:+ expression):?
	| simple ":" _:+ "[" flowing[expression] "]"
	| simple ":" _:+ "{" _ flowing[dataDefinition] _ "}"
	| "..." "{" _ flowing[simple] _ "}" ":" _ expression

parameter ->
	  name (_:+ "otherwise" _ expression):?
	| "..." name


commented -> comment:*
comment -> annotation literal newline
annotation -> "note" | "idea" | "todo"


location -> name ("." simple):?

simple ->
	  name
	| digitNumber
	| decimalNumber
	| literal
	| text

when -> %when
for -> %For
result -> %result
collect -> %collect
of -> %of
with -> %With

literal -> %literal
text -> %text
decimalNumber -> %decimalNumber
digitNumber -> %digitNumber

newline -> %newline
indent -> %indent
dedent -> %dedent
name -> %name
_ -> %_
____ -> %____
