@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({

        literal: {
        	match: /`(?:\\[`\\]|[^`\\])*`/,
        	lineBreaks: true,
        },
        text: {
        	match: /'(?:\\['\\]|[^'\\])*'/,
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

        updateExponential: '=**',
        updateTimes: '=*',
        updateDividedBy: '=/',
        updatePlus: '=+',
        updateMinus: '=-',
        set: '=',

		expand: '...',
		namespaceSpecifier: '::',
        define: ':',
        separator: ',',

        exponential: '**',
        times: '*',
        dividedBy: '/',
        plus: '+',
        minus: '-',
    })
});

const ignore		= ()	=> null
const takeFirst		= ([a]) => a
const takeSecond	= ([, b]) => b
const takeThird		= ([, , c])	=> c
const takeFourth	= ([, , , d]) => d
const takeFifth		= ([, , , , e]) => e
const takeSixth		= ([, , , , , f]) => f
const takeSeventh	= ([, , , , , , g]) => g
const takeEighth	= ([, , , , , , , h]) => h
const take			= takeFirst
%}


@lexer lexer

@builtin "postprocessors.ne"

does[operator] -> $operator _ expression newline
	{%	([operator, , expression]) => ({ type: 'does', operator, expression })	 %}


assignmentWith[operator, expression] -> location $operator $expression
	{%	([location, operator, expression]) => ({ type: 'assignmentWith', location, operator, expression })	%}

assignmentOf[operator, expression	] -> assignmentWith[$operator							{% take %} , $expression {% take %}	] {% take %}
assignment[  operator				] -> assignmentWith[(_ $operator _ {% takeSecond %} )	{% take %} , expression  {% take %}	] {% take %}

assignExpand[operator] ->
	  ( location ":" {% take %} ):? "..." destructuringList $operator expression
		{% ([location, , locators, operator, expression]) =>
			({ type: 'expandAssignList', ...(location && { location }), locators, operator, expression }) %}

	| ( location ":" {% take %} ):? "..." destructuringData ( $operator expression {% ([operator, expression]) => ({ operator, expression }) %} ):?
		{% ([location, , locators, operatorWithExpression]) =>
			({ type: 'expandAssignData', ...(location && { location }), locators, ...(operatorWithExpression && { ...operatorWithExpression }) }) %}


standalone[definition, adjusted] -> newline:?
	($adjusted comment		{% takeSecond %} ):*
	 $adjusted $definition
	{%	([, comments, , definition]) => ({ type: 'standalone', ...(comments.length && { comments }), definition })	%}

indented[definition]	-> newline indent $definition dedent	{% takeThird %}
block[definition]		-> indented[standalone[$definition		{% take %} , ____:+ {% ignore %} ]		{% take %}	]	{% take %}
blockOf[definition]		-> indented[standalone[$definition		{% take %} , ____:+ {% ignore %} ]:+	{% take %}	]	{% take %}

items[definition]   -> delimited[$definition	{% take %} , ("," _:+)		{% ignore %} ]			{% take %}
listing[definition] -> delimited[$definition	{% take %} , ("," newline)	{% ignore %} ] ",":?	{% take %}

flowing[definition] -> items[$definition	{% take %} ] ("," newline
	____:* _:+ items[$definition	{% take %} ]
	{% takeFifth %}	):*
	{%	([first, rest]) => [...first, ...rest.flat()]	%}

# TODO: there is some duplication between listed/elongated which would be nice to extract and simplify

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


allowOtherwise[adjustment] -> ( $adjustment otherwise _ default _ expression {% takeSixth %} ):?	{% take %}

invokeWith[nameModifier] -> identifier $nameModifier (_ of {% takeSecond %} ):? _ expression
	{% ([method, nameModifier, of, , receiver]) =>
		({ method, ...(nameModifier && { nameModifier }), ...(of && { of }), receiver }) %}


main ->
	(
		namespaceDeclaration
		using:?
		(method {% take %} | sequence {% take %} ):+

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
			elongated[(_ _ _ _) {% ignore %} , identifier {% ([name]) => ({ type: 'parameter', name }) %} ] newline
			{%	takeThird	%}
		) {% take %} ,
		null {% ignore %} ]
	{%	takeThird	%}


# TODO: support (method in Z)		- binds a method with receiver Z
# TODO: support (method using X)	- partially applies parameter X
# TODO: support (method from Y)		- applies using parameters data Y

# But (method of from Z) is not pretty...
# 'of' could be completely optional and just for readability?
# How about: (method-of from Z)

# TODO: improve the { self, this, inner } to make any part optional
method ->
	newline
	newline
	standalone[(
			identifier (_ of {% takeSecond %} ):? _ ("self" | "{" _ "self":? ("," _ "this"):? ("," _ "inner"):? _ "}")
					methodParameters ":"
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

sequence ->
	newline
	newline
	standalone[(
			identifier methodParameters ":"
				block[for {% take %} ]
			{%	([name, parameters, , sequence]) => ({
				name,
				...(parameters && { parameters }),
				sequence
			}) %}
		) {% take %} ,
		null {% ignore %} ]
	{%	takeThird	%}


methodParameters -> (_ with _ elongated[(_ _ _ _ _ _ _ _ _:+) {% ignore %} , parameter {% take %} ] {% takeFourth %} ):?

parameter ->
	"...":? identifier
		(  ":" _:+ destructuringList {% takeThird %}
		 | ":" _:+ destructuringData {% takeThird %} ):?
		(_:+ "(" otherwise _ default _ expression ")" {% takeSeventh %} ):?

	{% ([grouping, name, destructuring, otherwise]) => ({
		type: 'parameter',
		...(grouping && { grouping }),
		name,
		...(destructuring && { ...destructuring }),
		...(otherwise && { otherwise })
	}) %}

destructuringList -> "["   flowing[parameter {% take %} ]   "]" {% ([, listed]) => ({ listed }) %}
destructuringData -> "{" _ flowing[parameter {% take %} ] _ "}" {% ([, , dataDefinition]) => ({ dataDefinition }) %}

for -> For _ each _ identifier _ (in {% take %} | through {% take %} ) _ expression ","
		(_ to _ extent _ of _ expression "," {% takeEighth %} ):?
		(_ do ":" {% takeSecond %} ):?
	blockOf[statement {% take %} ]
	{% ([, , , , name, , iteration, , expression, , , extent, Do, statements]) => ({ type: 'for', name, expression, ...(extent && { extent }), ...(Do && { do: Do }), statements }) %}

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
      for							{% take %}
    | when							{% take %}
    | does[collect	{% take %} ]	{% take %}
    | does[result	{% take %} ]	{% take %}
    | assignMethodResult																newline	{% take %}
	| assignExpand[(_ "=" _ {% ignore %} )	{% ignore %} ]								newline	{% take %}
	| assignmentOf[(_ "=" _ {% ignore %} )	{% ignore %} , listLiteral	{% take %}	]	newline	{% take %}
	| assignmentOf[(_ "=" _ {% ignore %} )	{% ignore %} , dataLiteral	{% take %}	]	newline	{% take %}
	| assignmentOf[(_ "=" _ {% ignore %} )	{% ignore %} , listBlock	{% take %}	]	newline	{% take %}
	| assignmentOf[(_ "=" _ {% ignore %} )	{% ignore %} , dataBlock	{% take %}	]	newline	{% take %}
    | assignment["="	{% take %} ]	newline	{% take %}
    | assignment["=**"	{% take %} ]	newline	{% take %}
    | assignment["=*"	{% take %} ]	newline	{% take %}
    | assignment["=/"	{% take %} ]	newline	{% take %}
    | assignment["=+"	{% take %} ]	newline	{% take %}
    | assignment["=-"	{% take %} ]	newline	{% take %}
	| methodExecution					newline	{% take %}
	| stop								newline	{% take %}
	| skip								newline	{% take %}


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
    | methodExecution	{% take %}
    | "(" expression ")" {% takeSecond %}
    | location (_ otherwise _ default _ expression {% takeSixth %} ):?
    	{% ([location, otherwise]) =>
    		({ type: 'locate', location, ...(otherwise && { otherwise }) }) %}


methodCall[nameModifier] ->

	  invokeWith[$nameModifier {% take %} ] allowOtherwise[_ {% take %} ]
	  	{% ([invocation, otherwise]) =>
	  		({ type: 'methodExecution', ...invocation, ...(otherwise && { otherwise }) }) %}

	| invokeWith[$nameModifier {% take %} ] _ with
				(  _ flowing[dataDefinition {% take %} ] {% takeSecond %}
				 | listingBlock[dataDefinition {% take %} ] {% take %} )
		{% ([invocation, , , arguments]) =>
			({ type: 'methodExecution', ...invocation, arguments }) %}

	| invokeWith[$nameModifier {% take %} ] _ with _ "{" _ flowing[dataDefinition {% take %} ] _ "}" allowOtherwise[_ {% take %} ]
		{% ([invocation, , , , , , arguments, , , otherwise]) =>
			({ type: 'methodExecution', ...invocation, arguments, ...(otherwise && { otherwise }) }) %}

	| invokeWith[$nameModifier {% take %} ] _ with _ enclosedDataBlock allowOtherwise[(newline ____:+) {% take %} ]
		{% ([invocation, , , , arguments, otherwise]) =>
			({ type: 'methodExecution', ...invocation, arguments, ...(otherwise && { otherwise }) }) %}


listLiteral -> "["		flowing[expression		{% take %} ]	"]" {% ([, list]) => ({ list }) %}
dataLiteral -> "{" _	flowing[dataDefinition	{% take %} ] _	"}" {% ([, data]) => ({ data }) %}


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
	  assignMethodResult																{% take %}
	| assignExpand[(":"	_:+ {% ignore %} ) {% ignore %} ]								{% take %}
	| assignmentOf[(":" _:+ {% ignore %} ) {% ignore %} , listLiteral	{% take %} ]	{% take %}
	| assignmentOf[(":" _:+ {% ignore %} ) {% ignore %} , dataLiteral	{% take %} ]	{% take %}
	| assignmentOf[(":" _:+ {% ignore %} ) {% ignore %} , listBlock		{% take %} ]	{% take %}
	| assignmentOf[(":" _:+ {% ignore %} ) {% ignore %} , dataBlock		{% take %} ]	{% take %}
	| location (":" _:+ expression {% takeThird %} ):?
	  	{% ([location, expression]) =>
	  		({ type: 'dataDefinition', location, ...(expression && { expression }) }) %}


assignMethodResult -> (location ":" {% take %} ):? methodNaming
	{% ([location, methodNaming]) => ({ type: 'assignMethodResult', ...(location && { location }), methodNaming }) %}

methodExecution -> methodCall[null	{% ignore %}	]
methodNaming    -> methodCall["..."	{% take %}		]


comment ->
	(todo {% take %} | idea {% take %} | note {% take %}
		| annotation ":" literal  {% ([annotation, , literal]) => ({ type: 'comment', annotation, literal }) %} )
	newline
	{% take %}

annotation ->
	  "note"	{% take %}
	| "idea"	{% take %}
	| "todo"	{% take %}


location -> identifier (":" locator {% takeSecond %} ):*
	{% ([name, locators]) =>
		({ type: 'location', name, ...(locators.length && { locators }) }) %}

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
to			-> "to"			{% ignore %}
extent		-> "extent"		{% ignore %}
do			-> "do"			{% ignore %}
through		-> "through"	{% ignore %}
skip		-> "skip"		{% ignore %}
stop		-> "stop"		{% ignore %}
default		-> "default"	{% ignore %}

# I've tried to use as few reserved keywords as possible, while still having an unambiguous parse
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
