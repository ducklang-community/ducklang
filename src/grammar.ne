@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({

        literal: {
        	match: /`(?:\\[`\\]|[^`\\])*`/,
        	lineBreaks: true,
        },
        quote: {
        	match: /"[a-zA-Z]+[a-zA-Z0-9]*"/,
        	value: s => s.slice(1, -1),
        },
        text: {
        	match: /'(?:\\['\\]|[^'\\])*'/,
        	lineBreaks: true,
        },

    	why:	/Why: .*$/,
    	see:	/See: .*:\/\/.*$/,
    	issue:	/Issue: .*$/,

		namespaceIdentifier: /^::.*::$/,

        decimalNumber: /-?[0-9]+\.[0-9]+/,
        digitNumber: /0|-?[1-9][0-9]*/,
        hexNumber: /0x0|0x[1-9a-f][0-9a-f]*/,

		identifier: {
			match: /_|[a-zA-Z]+[a-zA-Z0-9]*/,
			type: moo.keywords({
				result: 'result',
				collect: 'collect',
				of: 'of',
				With: 'with',
				otherwise: 'otherwise',
				awaited: 'awaited',
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


# Issue: the term 'match' would be simpler than 'destructure'

# Issue: namespace is a strange name. Use the term 'module' (or 'collection' ?) or another term entirely?


@lexer lexer

@builtin "postprocessors.ne"

does[operator] -> $operator _ expression newline
	{%	([operator, , expression]) => ({ type: 'does', operator, expression })	 %}


assignWith[operator, expression] -> location $operator $expression
	{%	([location, operator, expression]) => ({ type: 'assignWith', location, ...(operator && ({ operator })), expression })	%}

assignOf[operator, expression	] -> assignWith[$operator							{% take %} , $expression {% take %}	] {% take %}
assign[  operator				] -> assignWith[(_ $operator _ {% takeSecond %} )	{% take %} , expression  {% take %}	] {% take %}

assignExpand[operator] ->
	  ( location ":" {% take %} ):? "..." destructuringList $operator expression
		{% ([location, , destructuring, , expression]) =>
			({ type: 'assignExpandList', ...(location && { location }), ...destructuring, expression }) %}

	| ( location ":" {% take %} ):? "..." destructuringData ( $operator expression {% takeSecond %} ):?
		{% ([location, , destructuring, expression]) =>
			({ type: 'assignExpandData', ...(location && { location }), ...destructuring, ...(expression && { expression }) }) %}


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

# Issue: there is some duplication between listed/elongated which would be nice to extract and simplify

listed[adjusted, entry] -> listing[(
		($adjusted comment		{% takeSecond %} ):*
		 $adjusted $entry
		{%	([comments, , entry]) => ({ type: 'entry', ...(comments.length && { comments }), entry })	%} )
	{% take %} ]
	{% take %}

elongated[adjusted, entry] ->
	(
		  $entry {% ([entry]) => ({ type: 'entry', entry }) %}
		| ( delimited[comment {% take %}, $adjusted {% ignore %} ] {% take %} ):+ $adjusted $entry
			{%	([comments, , entry]) => ({ type: 'entry', ...(comments.length && { comments }), entry })	%}
	)
	("," newline
		listed[$adjusted	{% take %} , $entry	{% take %} ]
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
	description
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
	{%	([description, modules]) => ({ description, modules })	%}

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
			elongated[(_ _ _ _) {% ignore %} , identifier {% ([name]) => ({ type: 'input', name }) %} ] newline
			{%	takeThird	%}
		) {% take %} ,
		null {% ignore %} ]
	{%	takeThird	%}


# Issue: lacks support (method in Z)	- binding a method with receiver Z
# Issue: lacks support (method using X)	- partially applying input X
# Issue: lacks support (method from Y)	- applying using inputs data Y

# But (method of from Z) is not pretty...
# 'of' could be completely optional and just for readability?
# How about: (method-of from Z)

# Issue: any part of { self, this, inner } should be optional
method ->
	newline
	newline
	standalone[(
			identifier (_ of {% takeSecond %} ):? _ ("self" | "{" _ "self":? ("," _ "this"):? ("," _ "inner"):? _ "}")
					methodInputs ":"
				blockOf[statement {% take %} ]
			{%	([name, of, , receiver, inputs, , statements]) => ({
				name,
				...(of && { of }),
				receiver,
				...(inputs && { inputs }),
				statements
			}) %}
		) {% take %} ,
		null {% ignore %} ]
	{%	takeThird	%}

sequence ->
	newline
	newline
	standalone[(
			identifier ":"
				block[for {% take %} ]
			{%	([name, , sequence]) => ({ name, sequence }) %}
		) {% take %} ,
		null {% ignore %} ]
	{%	takeThird	%}


methodInputs -> (_ with _ elongated[(_ _ _ _ _ _ _ _ _:+) {% ignore %} , input {% take %} ] {% takeFourth %} ):? {% take %}

input ->
	"...":? ( identifier {% take %} | quote {% take %} ) (_ as _ identifier {% takeFourth %} ):?
		(  ":" _:+ destructuringList {% takeThird %}
		 | ":" _:+ destructuringData {% takeThird %} ):?
		(_:+ "(" otherwise _ default _ expression ")" {% takeSeventh %} ):?

	{% ([grouping, name, as, destructuring, otherwise]) => ({
		type: 'input',
		...(grouping && { grouping }),
		name,
		...(as && { as }),
		...(destructuring && { ...destructuring }),
		...(otherwise && { otherwise })
	}) %}

destructuringList -> "["   flowing[input {% take %} ]   "]" {% ([, destructuringList])   => ({ destructuringList }) %}
destructuringData -> "{" _ flowing[input {% take %} ] _ "}" {% ([, , destructuringData]) => ({ destructuringData }) %}

for -> For _ each _ (awaited _ {% take %}):? identifier _ (in {% take %} | through {% take %} | of {% take %} ) _ expression ","
		(_ to _ extent _ of _ expression "," {% takeEighth %} ):?
		(_ do ":" {% takeSecond %} ):?
	blockOf[statement {% take %} ]
	{% ([, , , , awaited, name, , itemizing, , expression, , extent, Do, statements]) => ({ type: 'for', ...(awaited && awaited), name, itemizing, expression, ...(extent && { extent }), ...(Do && { do: Do }), statements }) %}

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
	| assignOf[(_ "=" _ {% ignore %} )	{% ignore %} , listLiteral	{% take %}	]	newline	{% take %}
	| assignOf[(_ "=" _ {% ignore %} )	{% ignore %} , dataLiteral	{% take %}	]	newline	{% take %}
	| assignOf[(_ "=" _ {% ignore %} )	{% ignore %} , listBlock	{% take %}	]	newline	{% take %}
	| assignOf[(_ "=" _ {% ignore %} )	{% ignore %} , dataBlock	{% take %}	]	newline	{% take %}
    | assign["="	{% take %} ]	newline	{% take %}
    | assign["=**"	{% take %} ]	newline	{% take %}
    | assign["=*"	{% take %} ]	newline	{% take %}
    | assign["=/"	{% take %} ]	newline	{% take %}
    | assign["=+"	{% take %} ]	newline	{% take %}
    | assign["=-"	{% take %} ]	newline	{% take %}
	| methodExecution				newline	{% take %}
	| stop							newline	{% take %}
	| skip							newline	{% take %}


# Issue: both (a / b / c) or (a - b - c) are ambiguous for those who don't yet know the associativity of "/" and "-"
# Should require parentheses to make this clearer visually, eg. (a / b) / c , (a - b) - c
# Addition and multiplication are unambiguous no matter the associativity so can be grouped: (a + b + c), (a * b * c)

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


listLiteral -> "["		flowing[expression		{% take %} ]	"]" {% ([, list]) => ({ type: 'list', list }) %}
dataLiteral -> "{" _	flowing[dataDefinition	{% take %} ] _	"}" {% ([, data]) => ({ type: 'data', data }) %}


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
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , listLiteral	{% take %} ]	{% take %}
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , dataLiteral	{% take %} ]	{% take %}
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , listBlock		{% take %} ]	{% take %}
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , dataBlock		{% take %} ]	{% take %}
	| location (":" _:+ expression {% takeThird %} ):?
	  	{% ([location, expression]) =>
	  		({ type: 'dataDefinition', location, ...(expression && { expression }) }) %}


assignMethodResult -> (location ":" {% take %} ):? methodNaming
	{% ([location, methodNaming]) => ({ type: 'assignMethodResult', ...(location && { location }), methodNaming }) %}

methodExecution -> methodCall[null	{% ignore %}	] {% take %}
methodNaming    -> methodCall["..."	{% take %}		] {% take %}


comment ->
	(  why		{% ([line]) => ({ line }) %}
	 | see		{% ([line]) => ({ line }) %}
	 | issue	{% ([line]) => ({ line }) %}
	 | ("Why" {% take %} | "See" {% take %} | "Issue" {% take %} ) ":" literal
	 	{% ([annotation, , literal]) => ({ annotation, literal }) %} )
	newline
	{% ([comment]) => ({ type: 'comment', ...comment }) %}

description ->
	newline
	newline
	newline
	"Why" ":" literal newline
	comment:*
	{% ([, , , , , why, , comments]) => ({ why, ...(comments.length && { comments }) }) %}


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
to			-> "to"			{% ignore %}
extent		-> "extent"		{% ignore %}
skip		-> "skip"		{% ignore %}
stop		-> "stop"		{% ignore %}
as			-> "as"			{% ignore %}
default		-> "default"	{% ignore %}
do			-> "do"			{% take %}
in			-> "in"			{% take %}
through		-> "through"	{% take %}

# I've tried to use as few reserved keywords as possible, while still having an unambiguous parse
result		-> %result		{% take %}
collect		-> %collect		{% take %}
of			-> %of			{% take %}
with		-> %With		{% ignore %}
otherwise	-> %otherwise	{% ignore %}
awaited		-> %awaited		{% take %}

why			-> %why		{% take %}
see			-> %see		{% take %}
issue		-> %issue	{% take %}

literal			-> %literal			{% take %}
quote			-> %quote			{% take %}
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
