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
				result: 'result',
				collect: 'collect',
				of: 'of',
				With: 'with',
				otherwise: 'otherwise',
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

bin = () => null
second = ([, b]) => b
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
	Use _
	elongated[(_ _ _ _), name] newline
	newline

method ->
	newline
	commented
	name (_ of):? _ name (_ with _
	elongated[(_ _ _ _ _ _ _ _ _:+), parameter]):? ":"
		blockOf[statement]
	newline

for -> For _ every _ name _ in _ expression ","
	blockOf[statement]

when -> When _ expression
	indented[(
		(standalone[(is _ expression ":" (_:+ statement	{% id %}
			| blockOf[statement] {% id %}))]):+

    	(standalone[(otherwise ":" (_:+ statement	{% id %}
			| blockOf[statement] {% id %}))]):?
	)]


statement ->
	  stop newline	{% id %}
	| skip newline	{% id %}
    | assignmentOf[(function _ of _ flowing[parameter] ":" _ result _ expression)]	{% id %}
	| assignmentOf[("[" flowing[expression] "]")]			{% id %}
	| assignmentOf[("{" _ flowing[dataDefinition] _ "}")]	{% id %}
	| assignmentOf[listBlock]	{% id %}
	| assignmentOf[dataBlock]	{% id %}
    | assignment["="]	{% id %}
    | assignment["=*"]	{% id %}
    | assignment["=/"]	{% id %}
    | assignment["=+"]	{% id %}
    | assignment["=-"]	{% id %}
    | does[collect]	{% id %}
    | does[result]	{% id %}
	| methodExecution newline	{% id %}
    | when	{% id %}
    | for	{% id %}

expression ->
      locator	{% id %}
    | location (_ otherwise _ default _ expression):?
    | expression _ ("+" | "-" | "*" | "/") _ expression
    | methodExecution	{% id %}

methodExecution ->
	  name (_ of):? _ expression (_ otherwise _ default _ expression):?
	| name (_ of):? _ expression _ with (_ flowing[dataDefinition] {% second %} | listingBlock[dataDefinition] {% id %})
	| name (_ of):? _ expression _ with _ "{" _ flowing[dataDefinition] _ "}" (_ otherwise _ default _ expression):?
	| name (_ of):? _ expression _ with _
		enclosedDataBlock
		(newline ____:+ otherwise _ default _ expression):?


listBlock ->  "["
		listingBlock[flowing[expression]]
	____:+ "]"


dataBlock ->
	  listingBlock[dataDefinition]	{% id %}
	| enclosedDataBlock				{% id %}

enclosedDataBlock ->  "{"
		listingBlock[dataDefinition]
	____:+ "}"


dataDefinition ->
	  locator ((":" {% id %} | ":." {% id %}) _:+ expression):?
	| locator ":" _:+ ("[" flowing[expression] "]" | "{" _ flowing[dataDefinition] _ "}")
	| "..." "{" _ flowing[locator] _ "}" ":" _ expression

parameter ->
	  name (_:+ otherwise _ expression):?
	| "..." name {% second %}


commented -> comment:*
comment -> annotation literal newline
annotation ->
	  note	{% id %}
	| idea	{% id %}
	| todo	{% id %}


location -> name ("." locator):?

locator ->
	  name			{% id %}
	| digitNumber	{% id %}
	| decimalNumber	{% id %}
	| literal		{% id %}
	| text			{% id %}

# I've tried to use as few keywords as possible, while still getting a consistent parse
note -> "note"		{% id %}
idea -> "idea"		{% id %}
todo -> "todo"		{% id %}
Use -> "use"		{% bin %}
When -> "when"		{% bin %}
is -> "is"			{% bin %}
For -> "for"		{% bin %}
every -> "every"	{% bin %}
in -> "in"			{% bin %}
skip -> "skip"		{% bin %}
stop -> "stop"		{% bin %}
result -> %result	{% bin %}
collect -> %collect	{% bin %}
of -> %of			{% bin %}
with -> %With		{% bin %}
otherwise -> %otherwise	{% bin %}
default -> "default"	{% bin %}
function -> "function"	{% bin %}

literal -> %literal				{% id %}
text -> %text					{% id %}
decimalNumber -> %decimalNumber	{% id %}
digitNumber -> %digitNumber		{% id %}
name -> %name					{% id %}

newline -> %newline	{% bin %}
indent -> %indent	{% bin %}
dedent -> %dedent	{% bin %}
_ -> %_				{% bin %}
____ -> %____		{% bin %}
