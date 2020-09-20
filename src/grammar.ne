@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({

        literal: {
        	match: /`(?:\\[`\\]|[^\n`\\])*`/,
        	lineBreaks: true,
        },
        text: {
        	match: /'(?:\\['\\]|[^\n'\\])*'/,
        	lineBreaks: true,
        },

    	todo: /todo: .*$/,
    	idea: /idea: .*$/,
    	note: /note: .*$/,

		namespaceIdentifier: /^::.*::$/,

        decimalNumber: /-?[0-9]+\.[0-9]+/,
        digitNumber: /0|-?[1-9][0-9]*/,
        hexNumber: /0x0|0x[1-9a-f][0-9a-f]*/,

		identifier: {
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

const ignore		= ()		=> null
const takeFirst		= ([a])		=> a
const takeSecond	= ([, b])	=> b
const takeThird		= ([, , c])	=> c
const takeFourth	= ([, , , d])		=> d
const takeFifth		= ([, , , , e])		=> e
const takeSixth		= ([, , , , , f])	=> f
const takeSeventh	= ([, , , , , , g])	=> g
const take			= takeFirst
%}

@lexer lexer

@builtin "postprocessors.ne"

does[operator] -> $operator _ expression newline
	{%	([operator, , expression]) => ({ type: 'does', operator, expression })	 %}

assignmentWith[operator, expression] -> location _ $operator _ $expression newline
	{%	([location, , operator, , expression]) => ({ type: 'assignmentWith', location, operator, expression })	%}

assignmentOf[expression] -> assignmentWith["=" {% take %}, $expression {% take %}	] {% take %}
assignment[operator] -> assignmentWith[$operator {% take %}, expression {% take %}	] {% take %}

standalone[definition, adjusted] -> newline:?
	($adjusted comment		{% takeSecond %} ):*
	 $adjusted $definition
	{%	([, comments, , definition]) => ({ type: 'standalone', ...(comments.length && { comments }), definition })	%}

indented[definition] -> newline indent $definition dedent	{% takeThird %}
blockOf[definition]  -> indented[standalone[$definition		{% take %} , ____:+ {% ignore %} ]:+		{% take %}	]	{% take %}

items[definition]   -> delimited[$definition	{% take %} , ("," _:+)		{% ignore %} ]			{% take %}
listing[definition] -> delimited[$definition	{% take %} , ("," newline)	{% ignore %} ] ",":?	{% take %}

flowing[definition] -> items[$definition	{% take %} ] ("," newline
	____:* _:+ items[$definition	{% take %} ]
	{% takeFifth %}	):*
	{%	([first, rest]) => [...first, ...rest.flat()]	%}

listed[adjusted, definition] -> listing[(
		($adjusted comment		{% takeSecond %} ):*
		 $adjusted $definition
		{%	([comments, , definition]) => ({ type: 'listed', ...(comments.length && { comments }), definition })	%} )
	{% take %} ]
	{% take %}

elongated[adjusted, definition] ->
	(
		  $definition {% ([definition]) => ({ type: 'listed', definition }) %}
		| ( delimited[comment {% take %}, $adjusted {% ignore %} ] {% take %} ):+ $adjusted $definition
			{%	([comments, , definition]) => ({ type: 'listed', ...(comments.length && { comments }), definition })	%}
	)
	("," newline
		listed[$adjusted	{% take %} , $definition	{% take %} ]
		{% takeThird %}
	):?
	{%	([first, rest]) => [first, ...(rest || [])]	%}

listingBlock[definition] ->
	indented[(
		listed[____:+ {% ignore %}	, $definition {% take %}	] newline
		{% take %}
	) {% take %} ]
	{% take %}


main ->
	(
		namespaceDeclaration
		using:?
		method:+

		{% ([namespaceDeclaration, using, methods]) => ({
			namespaceDeclaration,
			...(using && { using }),
			methods
		}) %}
	):+
	newline
	newline
	{%	take	%}

namespaceDeclaration ->
	newline
	newline
	newline
	namespaceIdentifier newline
	newline
	{%	takeFourth	%}

using ->
	newline
	newline
	standalone[(
			Use _
			elongated[(_ _ _ _) {% ignore %} , identifier {% take %} ] newline
			{%	takeThird	%}
		) {% take %} ,
		null {% ignore %} ]
	{%	takeThird	%}

# TODO: improve the { self, this, inner } to make any part optional
method ->
	newline
	newline
	standalone[(
			identifier (_ of {% takeSecond %} ):? _ ("self" | "{" _ "self":? ("," _ "this"):? ("," _ "inner"):? _ "}") (_ with _
			elongated[(_ _ _ _ _ _ _ _ _:+) {% ignore %} , parameter {% take %} ] {% takeFourth %} ):? ":"
				blockOf[statement {% take %} ]
			{%	([name, of, , receiver, parameters, , statements]) => ({
				name,
				...(of && { of }),
				receiver,
				...(parameters && { parameters }),
				statements
			}) %}
		) {% take %} ,
		null {% ignore %} ]
	{%	takeThird	%}

for -> For _ each _ identifier _ in _ expression (("," _ with _ extent ":" _ expression {% ([, , , , , , , extent]) => ({ extent }) %} ):? "," {% take %} | "," _ "do" ":" {% ([, , Do]) => ({ do: Do }) %} )
	blockOf[statement {% take %} ]
	{% ([, , , , name, , , , expression, extent, statements]) => ({ type: 'for', name, expression, ...(extent && { ...extent }), statements }) %}

when -> When _ expression
	indented[(
		standalone[
			(is _ expression ":" (_:+ statement	{% ([, statement]) => [statement] %}
				| blockOf[statement {% take %} ] {% take %} )
			{% ([, , expression, , statements]) => ({ type: 'case', expression, statements }) %} ) {% take %} ,
			____:+ {% ignore %}	]:+

    	standalone[
    		(otherwise ":" (_:+ statement	{% ([, statement]) => [statement] %}
				| blockOf[statement {% take %} ] {% take %} )
			{% ([, , statements]) => statements %} ) {% take %} ,
			____:+ {% ignore %}	]:?

		{% ([cases, otherwise]) => ({ cases, ...(otherwise && { otherwise }) }) %}
	) {% take %} ]
	{% ([, , expression, branches]) => ({ type: 'when', expression, ...branches }) %}


statement ->
	  assignmentOf[("["		flowing[expression 		{% take %} ]	"]" {% ([, list])   => ({ type: 'list', list }) %} ) {% take %} ]	{% take %}
	| assignmentOf[("{"	_	flowing[dataDefinition	{% take %} ] _	"}" {% ([, , data]) => ({ type: 'data', data }) %} ) {% take %} ]	{% take %}
	| assignmentOf[listBlock	{% take %} ]	{% take %}
	| assignmentOf[dataBlock	{% take %} ]	{% take %}
    | assignment["="			{% take %} ]	{% take %}
    | assignment["=*"			{% take %} ]	{% take %}
    | assignment["=/"			{% take %} ]	{% take %}
    | assignment["=+"			{% take %} ]	{% take %}
    | assignment["=-"			{% take %} ]	{% take %}
    | does[collect				{% take %} ]	{% take %}
    | does[result				{% take %} ]	{% take %}
	| methodExecution newline					{% take %}
	| stop newline								{% take %}
	| skip newline								{% take %}
    | when										{% take %}
    | for										{% take %}

# TODO: Require all binary operations be grouped with parentheses except additions and multiplications
# eg. (a / b) / c , (a - b) - c, a + b + c , a * b * c

expression ->
	  expression _ "-" _ expressionWithoutAddition {% ([a, , , , b]) => ({ type: 'subtraction', a, b }) %}
	| expression _ "+" _ expressionWithoutAddition {% ([a, , , , b]) => ({ type: 'addition', a, b }) %}
	| expressionWithoutAddition	{% take %}

expressionWithoutAddition ->
	  expressionWithoutAddition _ "/" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'division', a, b }) %}
	| expressionWithoutAddition _ "%" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'modulo', a, b }) %}
	| expressionWithoutAddition _ "*" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'multiplication', a, b }) %}
	| expressionWithoutMultiplication {% take %}

expressionWithoutMultiplication ->
	  expressionWithoutExponentiation _ "**" _ expressionWithoutMultiplication {% ([a, , , , b]) => ({ type: 'exponentiation', a, b }) %}
	| expressionWithoutExponentiation {% take %}

expressionWithoutExponentiation ->
      value	{% take %}
    | location (_ otherwise _ default _ expression {% takeSixth %} ):? {% ([location, otherwise]) => ({ type: 'locate', location, ...(otherwise && { otherwise }) }) %}
    | methodExecution	{% take %}
    | "(" expression ")" {% takeSecond %}

methodExecution ->
	  identifier (_ of {% takeSecond %} ):? _ expression (_ otherwise _ default _ expression {% takeSixth %} ):? {% ([identifier, of, , receiver, otherwise]) => ({ type: 'methodExecution', identifier, ...(of && { of }), receiver, ...(otherwise && { otherwise }) }) %}
	| identifier (_ of {% takeSecond %} ):? _ expression _ with (_ flowing[dataDefinition {% take %} ] {% takeSecond %} | listingBlock[dataDefinition {% take %} ] {% take %} ) {% ([identifier, of, , receiver, , , arguments]) => ({ type: 'methodExecution', identifier, ...(of && { of }), receiver, arguments }) %}
	| identifier (_ of {% takeSecond %} ):? _ expression _ with _ "{" _ flowing[dataDefinition {% take %} ] _ "}" (_ otherwise _ default _ expression {% takeSixth %} ):? {% ([identifier, of, , receiver, , , , , , arguments, , , otherwise]) => ({ type: 'methodExecution', identifier, ...(of && { of }), receiver, arguments, ...(otherwise && { otherwise }) }) %}
	| identifier (_ of {% takeSecond %} ):? _ expression _ with _
		enclosedDataBlock
		(newline ____:+ otherwise _ default _ expression {% takeSeventh %} ):?
	{% ([identifier, of, , receiver, , , , arguments, otherwise]) => ({
	  	type: 'methodExecution',
	  	identifier,
	  	...(of && { of }),
	  	receiver,
	  	arguments,
	  	...(otherwise && { otherwise })
	}) %}

listBlock ->  "["
		listingBlock[flowing[expression {% take %} ] {% take %} ]
	____:+ "]"
	{% ([, listingBlock]) => ({ type: 'listBlock', listingBlock }) %}


dataBlock ->
	  listingBlock[dataDefinition {% take %} ]	{% take %}
	| enclosedDataBlock	{% take %}

enclosedDataBlock ->  "{"
		listingBlock[dataDefinition {% take %} ]
	____:+ "}"
	{% ([, listingBlock]) => ({ type: 'enclosedDataBlock', listingBlock }) %}


dataDefinition ->
	  locator ((":" {% take %} | ":." {% take %} ) _:+ expression {% ([operator, , expression]) => ({ operator, expression }) %} ):?	{% ([locator, definition]) => ({ type: 'dataDefinition', locator, ...(definition && { ...definition }) }) %}
	| locator ":" _:+ ("[" flowing[expression {% take %} ] "]" {% ([, list]) => { list } %} | "{" _ flowing[dataDefinition {% take %} ] _ "}" {% ([, data]) => { data } %} )	{% ([locator, , , definition]) => ({ type: 'dataDefinition', locator, ...definition }) %}
	| "..." "{" _ flowing[locator {% take %} ] _ "}" ":" _ expression {% ([, , , locators, , , , , expression]) => { type: 'expandDefinition', locators, expression } %}

parameter ->
	  identifier (_:+ otherwise _ expression {% takeFourth %} ):? {% ([name, otherwise]) => ({ type: 'parameter', name, ...(otherwise && { otherwise }) }) %}
	| "..." identifier {% ([, name]) => ({ type: 'parameterGroup', name }) %}
	| "..." identifier _ point _ identifier {% ([, parameters, , , , name]) => ({ type: 'parameterSingleton', parameters, name }) %}


comment -> (todo {% take %} | idea {% take %} | note {% take %} | annotation ":" literal  {% ([annotation, , literal]) => ({ type: 'comment', annotation, literal }) %} ) newline {% take %}
annotation ->
	  "note"	{% take %}
	| "idea"	{% take %}
	| "todo"	{% take %}


location -> identifier ("." locator {% takeSecond %} ):? {% ([name, locator]) => ({ type: 'location', name, ...(locator && { locator }) }) %}

locator ->
	  identifier	{% take %}
	| value			{% take %}

value ->
	  digitNumber	{% take %}
	| decimalNumber	{% take %}
	| literal		{% take %}
	| text			{% take %}


Use			-> "use"		{% ignore %}
When		-> "when"		{% ignore %}
is			-> "is"			{% ignore %}
For			-> "for"		{% ignore %}
each		-> "each"		{% ignore %}
in			-> "in"			{% ignore %}
skip		-> "skip"		{% ignore %}
stop		-> "stop"		{% ignore %}
extent		-> "extent"		{% ignore %}
default		-> "default"	{% ignore %}

# I've tried to use as few reserved keywords as possible, while still getting a consistent parse
result		-> %result		{% take %}
collect		-> %collect		{% take %}
of			-> %of			{% take %}
with		-> %With		{% ignore %}
otherwise	-> %otherwise	{% ignore %}

todo		-> %todo		{% take %}
idea		-> %idea		{% take %}
note		-> %note		{% take %}

literal			-> %literal			{% take %}
text			-> %text			{% take %}
decimalNumber	-> %decimalNumber	{% take %}
digitNumber		-> %digitNumber		{% take %}
identifier		-> %identifier		{% take %}

namespaceIdentifier -> %namespaceIdentifier	{% take %}

point	-> %point	{% ignore %}
newline -> %newline	{% ignore %}
indent	-> %indent	{% ignore %}
dedent	-> %dedent	{% ignore %}
_		-> %_		{% ignore %}
____	-> %____	{% ignore %}
