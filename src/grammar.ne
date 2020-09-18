@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({
    	todo: /todo: .*$/,
    	idea: /idea: .*$/,
    	note: /note: .*$/,
        literal: /`(?:\\[`\\]|[^\n`\\])*`/,
        text: /'(?:\\['\\]|[^\n'\\])*'/,

		namespaceIdentifier: /^::.*::$/,

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

		point: '->',

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
		namespaceSeparator: '::',
        locatorDefine: ':.',
        define: ':',
        locator: '.',
        separator: ',',

        exponential: '**',
        times: '*',
        dividedBy: '/',
        plus: '+',
        minus: '-',
    })
});

bin = () => null
second = ([, b]) => b
%}

# TODO: alternative syntax for requires and provides in code.
#       The problem is that different modules will want to implement this same method.

@lexer lexer

@builtin "postprocessors.ne"

does[operator] -> $operator _ expression newline {% ([operator, , expression]) => ({ type: 'does', operator, expression }) %}
assignmentWith[operator, expression] -> location _ $operator _ $expression newline {% ([location, , operator, , expression]) => ({ type: 'assignmentWith', location, operator, expression }) %}
assignmentOf[expression] -> assignmentWith["=" {% id %},       $expression {% id %}] {% id %}
assignment[operator]     -> assignmentWith[$operator {% id %}, expression {% id %}] {% id %}

standalone[definition] -> newline:?
	(____:+ comment {% ([, comment]) => comment %}):*
	____:+ $definition
	{% ([, comments, , definition]) => ({ type: 'standalone', ...(comments.length && { comments }), definition }) %}

indented[definition] -> newline indent $definition dedent {% ([, , definition]) => definition %}
blockOf[definition]  -> indented[standalone[$definition {% id %}]:+ {% id %}] {% id %}

items[definition]   -> delimited[$definition {% id %}, ("," _:+) {% bin %}] {% id %}
listing[definition] -> delimited[$definition {% id %}, ("," newline) {% bin %}] ",":? {% id %}

flowing[definition] -> items[$definition {% id %}] ("," newline
	____:* _:+ items[$definition {% id %}]
	{% ([, , , , items]) => items %}):*
	{% ([first, rest]) => ({ type: 'flowing', first, rest }) %}

listed[adjusted, definition] -> listing[(
		($adjusted comment {% ([, comment]) => comment %}):*
		 $adjusted $definition
		{% ([comments, , definition]) => ({ type: 'listed', ...(comments.length && { comments }), definition }) %}
	) {% id %}]
	{% id %}

elongated[adjusted, definition] -> $definition ("," newline
		listed[$adjusted {% id %}, $definition {% id %}]
		{% ([, , listed]) => listed %}
	):?
	{% ([definition, items]) => ({ type: 'elongated', definition, ...(items && { items }) }) %}

listingBlock[definition] ->
	indented[(
		listed[____:+ {% bin %}, $definition {% id %}] newline
		{% id %}
	) {% id %}]
	{% id %}


main ->
	(
		namespaceDeclaration
		use:?
		method:+
	):+
	newline
	newline
	{% ([namespaces]) => ({
		type: 'main',
		namespaces: namespaces.map(([namespaceDeclaration, use, methods]) => ({
			type: 'namespace',
			namespaceDeclaration,
			...(use && { use }),
			methods
		}))
	}) %}

namespaceDeclaration ->
	newline
	newline
	newline
	namespaceIdentifier newline
	newline
	{% ([, , , namespaceIdentifier]) => ({ type: 'namespaceDeclaration', namespaceIdentifier }) %}

use ->
	newline
	newline
	commented
	Use _
	elongated[(_ _ _ _) {% bin %}, name {% id %}] newline
	{% ([, , comments, , , elongated]) => ({ type: 'use', ...(comments && { comments }), elongated }) %}

# TODO: improve the { self, this, inner } to make any part optional
method ->
	newline
	newline
	commented
	name (_ of {% ([, of]) => of %}):? _ ("self" | "{" _ "self":? ("," _ "this"):? ("," _ "inner"):? _ "}") (_ with _
	elongated[(_ _ _ _ _ _ _ _ _:+) {% bin %}, parameter {% id %}] {% ([, , , parameters]) => parameters %}):? ":"
		blockOf[statement {% id %}]
	{% ([, , comments, name, of, , receiver, parameters, , block]) => ({ type: 'method', ...(comments && { comments }), name, ...(of && { of }), receiver, ...(parameters && { parameters }), block }) %}

for -> For _ each _ name _ in _ expression (("," _ with _ extent ":" _ expression {% ([, , , , , , , expression]) => ({ type: 'extent', expression }) %}):? "," {% id %} | "," _ "do" ":" {% () => ({ type: 'do' }) %})
	blockOf[statement {% id %}]
	{% ([, , , , name, , , , expression, extent, block]) => ({ type: 'for', name, expression, ...(extent && { extent }), block }) %}

when -> When _ expression
	indented[(
		(standalone[(is _ expression ":" (_:+ statement	{% ([, statement]) => [statement] %}
			| blockOf[statement {% id %}] {% id %}) {% ([, , expression, , statements]) => ({ type: 'case', expression, statements }) %}) {% id %}] {% id %}):+

    	(standalone[(otherwise ":" (_:+ statement	{% ([, statement]) => [statement] %}
			| blockOf[statement {% id %}] {% id %}) {% ([, , statements]) => statements %}) {% id %}]):?

		{% ([cases, otherwise]) => ({ type: 'cases', cases, ...(otherwise && { otherwise }) }) %}
	) {% id %}]
	{% ([, , expression, branches]) => ({ type: 'when', expression, branches }) %}


statement ->
	  stop newline							{% id %}
	| skip newline							{% id %}
	| assignmentOf[("[" flowing[expression {% id %}] "]")			{% ([, list])   => ({ type: 'list', list }) %}]	{% id %}
	| assignmentOf[("{" _ flowing[dataDefinition {% id %}] _ "}")	{% ([, , data]) => ({ type: 'data', data }) %}]	{% id %}
	| assignmentOf[listBlock	{% id %}]	{% id %}
	| assignmentOf[dataBlock	{% id %}]	{% id %}
    | assignment["="			{% id %}]	{% id %}
    | assignment["=*"			{% id %}]	{% id %}
    | assignment["=/"			{% id %}]	{% id %}
    | assignment["=+"			{% id %}]	{% id %}
    | assignment["=-"			{% id %}]	{% id %}
    | does[collect				{% id %}]	{% id %}
    | does[result				{% id %}]	{% id %}
	| methodExecution newline				{% id %}
    | when									{% id %}
    | for									{% id %}

# TODO: require complex division and subtraction be grouped with parentheses
# Require that non-same operation be grouped with parentheses except a + b + c and a * b * c

expression ->
	  expression _ "-" _ expressionWithoutAddition {% ([a, , , , b]) => ({ type: 'subtraction', a, b }) %}
	| expression _ "+" _ expressionWithoutAddition {% ([a, , , , b]) => ({ type: 'addition', a, b }) %}
	| expressionWithoutAddition	{% id %}

expressionWithoutAddition ->
	  expressionWithoutAddition _ "/" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'division', a, b }) %}
	| expressionWithoutAddition _ "%" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'modulo', a, b }) %}
	| expressionWithoutAddition _ "*" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'multiplication', a, b }) %}
	| expressionWithoutMultiplication {% id %}

expressionWithoutMultiplication ->
	  expressionWithoutExponentiation _ "**" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'exponentiation', a, b }) %}
	| expressionWithoutExponentiation {% id %}

expressionWithoutExponentiation ->
      value	{% id %}
    | location (_ otherwise _ default _ expression {% ([, , , , , expression]) => expression %}):? {% ([location, otherwise]) => ({ type: 'locate', location, ...(otherwise && { otherwise }) }) %}
    # These could go in their own terminals for associativity,
    # as per https://nearley.js.org/docs/how-to-grammar-good
    # However, I want the programmer to disambiguate using parentheses instead.
    #| mathematicsWithSum
    | methodExecution	{% id %}
    | "(" expression ")" {% ([, expression]) => expression %}

methodExecution ->
	  name (_ of {% ([, of]) => of %}):? _ expression (_ otherwise _ default _ expression {% ([, , , , , expression]) => expression %}):? {% ([name, of, , receiver, otherwise]) => ({ type: 'methodExecution', name, ...(of && { of }), receiver, ...(otherwise && { otherwise }) }) %}
	| name (_ of {% ([, of]) => of %}):? _ expression _ with (_ flowing[dataDefinition {% id %}] {% second %} | listingBlock[dataDefinition {% id %}] {% id %}) {% ([name, of, , receiver, , , arguments]) => ({ type: 'methodExecution', name, ...(of && { of }), receiver, arguments }) %}
	| name (_ of {% ([, of]) => of %}):? _ expression _ with _ "{" _ flowing[dataDefinition {% id %}] _ "}" (_ otherwise _ default _ expression {% ([, , , , , expression]) => expression %}):? {% ([name, of, , receiver, , , , , , arguments, , , otherwise]) => ({ type: 'methodExecution', name, ...(of && { of }), receiver, arguments, ...(otherwise && { otherwise }) }) %}
	| name (_ of {% ([, of]) => of %}):? _ expression _ with _
		enclosedDataBlock
		(newline ____:+ otherwise _ default _ expression {% ([, , , , , , expression]) => expression %}):?
	  {% ([name, of, , receiver, , , , arguments, otherwise]) => ({ type: 'methodExecution', name, ...(of && { of }), receiver, arguments, ...(otherwise && { otherwise }) }) %}

listBlock ->  "["
		listingBlock[flowing[expression {% id %}] {% id %}]
	____:+ "]"
	{% ([, listingBlock]) => ({ type: 'listBlock', listingBlock }) %}


dataBlock ->
	  listingBlock[dataDefinition {% id %}]	{% id %}
	| enclosedDataBlock				{% id %}

enclosedDataBlock ->  "{"
		listingBlock[dataDefinition {% id %}]
	____:+ "}"
	{% ([, listingBlock]) => ({ type: 'enclosedDataBlock', listingBlock }) %}


dataDefinition ->
	  locator ((":" {% id %} | ":." {% id %}) _:+ expression {% ([definer, , expression]) => ({ type: 'definer', definer, expression }) %}):?	{% ([locator, definition]) => ({ type: 'dataDefinition', locator, ...(definition && { definition }) }) %}
	| locator ":" _:+ ("[" flowing[expression {% id %}] "]" {% ([, flowing]) => { type: 'listing', flowing } %} | "{" _ flowing[dataDefinition {% id %}] _ "}" {% ([, flowing]) => { type: 'definition', flowing } %})	{% ([locator, , , definition]) => ({ type: 'dataDefinition', locator, definition }) %}
	| "..." "{" _ flowing[locator {% id %}] _ "}" ":" _ expression {% ([, , , flowing, , , , , expression]) => { type: 'expandDefinition', flowing, expression } %}

parameter ->
	  name (_:+ otherwise _ expression {% ([, , , expression]) => expression %}):? {% ([name, otherwise]) => ({ type: 'parameter', name, ...(otherwise && { otherwise }) }) %}
	| "..." name {% ([, name]) => ({ type: 'parameterGroup', name }) %}
	| "..." name _ point _ name {% ([, parameters, , , , name]) => ({ type: 'parameterSingleton', parameters, name }) %}


commented -> comment:* {% ([comments]) => comments.length ? comments : null %}
comment -> (todo {% id %} | idea {% id %} | note {% id %} | annotation ":" literal  {% ([annotation, , literal]) => ({ type: 'comment', annotation, literal }) %}) newline {% id %}
annotation ->
	  "note"	{% id %}
	| "idea"	{% id %}
	| "todo"	{% id %}


location -> name ("." locator):? {% ([name, _, locator]) => ({ type: 'location', name, ...(locator && { locator: locator[1] }) }) %}

locator ->
	  name	{% id %}
	| value	{% id %}

value ->
	  digitNumber	{% id %}
	| decimalNumber	{% id %}
	| literal		{% id %}
	| text			{% id %}


# I've tried to use as few keywords as possible, while still getting a consistent parse
Use		-> "use"	{% bin %}
When	-> "when"	{% bin %}
is		-> "is"		{% bin %}
For		-> "for"	{% bin %}
each	-> "each"	{% bin %}
in		-> "in"		{% bin %}
skip	-> "skip"	{% bin %}
stop	-> "stop"	{% bin %}
extent	-> "extent"	{% bin %}
with	-> %With	{% bin %}
otherwise	-> %otherwise	{% bin %}
default		-> "default"	{% bin %}

of		-> %of		{% id %}
result	-> %result	{% id %}
collect	-> %collect	{% id %}

todo	-> %todo	{% id %}
idea	-> %idea	{% id %}
note	-> %note	{% id %}

literal			-> %literal			{% id %}
text			-> %text			{% id %}
decimalNumber	-> %decimalNumber	{% id %}
digitNumber		-> %digitNumber		{% id %}
name			-> %name			{% id %}

namespaceIdentifier -> %namespaceIdentifier	{% id %}

point	-> %point	{% bin %}
newline -> %newline	{% bin %}
indent	-> %indent	{% bin %}
dedent	-> %dedent	{% bin %}
_		-> %_		{% bin %}
____	-> %____	{% bin %}
