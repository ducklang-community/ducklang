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
	        // Issue: This does not allow \{ to display a single bracket
			// A workaround for now is to concatenate a literal to text as required
        	match: /'(?:\\['\\]|[^'\\])*'/,
        	lineBreaks: true,
        },

    	why:		/Why: .*$/,
    	see:		/See: .*:\/\/.*$/,
    	issue:		/Issue: .*$/,
    	ellided:	/\.\.\. .*$/,

		namespaceIdentifier: /^::.*::$/,

        decimalNumber: /-?[0-9]+\.[0-9]+/,
        digitNumber: /0|-?[1-9][0-9]*/,
        hexNumber: /0x0|0x[1-9a-f][0-9a-f]*/,

		// Issue: support for positionals >99
        positional: {
			match: /[2-9]?1st|[2-9]?2nd|[2-9]?3rd|[2-9]?[4-9]th|1[0-9]th|[2-9]0th/,
			value: s => parseInt(s, 10) - 1
		},

		identifier: {
			match: /_|[a-zA-Z]+[a-zA-Z0-9]*/,
			type: moo.keywords({
				Return: 'return',
				collect: 'collect',
				of: 'of',
				With: 'with',
				otherwise: 'otherwise'
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

# Issue: data assign with locators is confusing
#        	with a:b, c: d
#        can easily look like 'a: b'
#        	with {b}: a, c: d
#        seems better because it keeps the name on LHS

# Issue: Nested RHS matching is hard to understand:
#        	with a: {b: {c: ["d" (otherwise default 2), "e": {f (otherwise default 1)}]}}:
#        Allow one level of RHS match:
#        	with a: {b}}:
#        Then continue the rest line by line
#           {c} = b
#           ["d" (otherwise default 2), "e"] = c
#           {f (otherwise default 1)} = e

# Issue: {resultFromEach of numbers with square}
#        should always use method name as the key

# Issue: the term 'match' would be simpler than 'destructure'

# Issue: namespace is a strange name. Use the term 'module' (or 'collection' ?) or another term entirely?

# Issue: making all things synchronous is worst of both worlds
# The reason being that having line-by-line await does not take advantage of asynchronicity.
# It would be better to require anything asynchronous to be marked out in the call site, like:
# 	request = task: get resource with url: 'https://example.org/'
# 	request = anytime: get resource with url: 'https://example.org/'
# 	request = start: get resource with url: 'https://example.org/'
# 	request = start to: get resource with location: 'https://example.org/'
# 	request = begin: get resource with url: 'https://example.org/'
# 	request = do: get resource with url: 'https://example.org/'		# Confusing as for-do means 'now'
# 	request = go: get resource with url: 'https://example.org/'
# And in this case not perform automatic 'await',
# But instead have an `await` that is more like Promise.all - expects multiple awaitables.
#   ...[response, contents] = await: [request, file]
#   ...await: { response: request, contents: file }
#   ...{ request as response, file as contents }
#
# How does 'start:' work? It's not really needed if the method just returns a promise...

# Issue: the itemization code would still need to be async/await if allowing `await Promise.all` in code.
# Can we make just those parts be callback based? Promise.all(...).then(continue)


@lexer lexer

@builtin "postprocessors.ne"

does[operator] -> $operator _ expression newline
	{%	([operator, , expression]) => ({ type: 'does', operator, expression })	 %}


assignWith[operator, expression] -> location $operator $expression
	{%	([location, operator, expression]) => ({ type: 'assignWith', location, ...(operator && ({ operator })), expression })	%}

assignOf[operator, expression	] -> assignWith[$operator							{% take %} , $expression {% take %}	] {% take %}
assign[  operator				] -> assignWith[(_ $operator _ {% takeSecond %} )	{% take %} , expression  {% take %}	] {% take %}

assignExpand[operator] ->
	  ( location ":" {% take %} ):? destructuringList $operator expression
		{% ([location, destructuring, , expression]) =>
			({ type: 'assignExpandList', ...(location && { location }), ...destructuring, expression }) %}

	| ( location ":" {% take %} ):? destructuringData ( $operator expression {% takeSecond %} ):?
		{% ([location, destructuring, expression]) =>
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

invokeWith[prefix] -> $prefix identifier (_ of {% takeSecond %} ):? _ expression
	{% ([prefix, method, of, , receiver]) =>
		({ ...(prefix && { prefix }), method, ...(of && { of }), receiver }) %}

methodCall[prefix] ->

	  invokeWith[$prefix {% take %} ] allowOtherwise[_ {% take %} ]
	  	{% ([invocation, otherwise]) =>
	  		({ type: 'methodExecution', ...invocation, ...(otherwise && { otherwise }) }) %}

	| invokeWith[$prefix {% take %} ] _ with
				(  _ flowing[dataDefinition {% take %} ] {% takeSecond %}
				 | listingBlock[dataDefinition {% take %} ] {% take %} )
		{% ([invocation, , , arguments]) =>
			({ type: 'methodExecution', ...invocation, arguments }) %}

	| invokeWith[$prefix {% take %} ] _ with _ dataLiteral allowOtherwise[_ {% take %} ]
		{% ([invocation, , , , { data: arguments }, otherwise]) =>
			({ type: 'methodExecution', ...invocation, arguments, ...(otherwise && { otherwise }) }) %}

	| invokeWith[$prefix {% take %} ] _ with _ enclosedDataBlock allowOtherwise[(newline ____:+) {% take %} ]
		{% ([invocation, , , , arguments, otherwise]) =>
			({ type: 'methodExecution', ...invocation, arguments, ...(otherwise && { otherwise }) }) %}


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
# Issue: lacks support (method from Y)	- applying using inputs data Y. Don't do this, better to be explicit in the params

# But (method of from Z) is not pretty...
# 'of' could be completely optional and just for readability?
# How about: (method-of from Z)

# Syntax unification for non-identifer-of:
# person:'age'
# person:age
#
# Means 'age' of person   (which is different from the method call "age of person")
#
# person:age = 50
# update ('age' of person) with value: 50
#
# ('age' of person) => entry having (reference of person, name: 'age')
#
# (0 of person) is not the first entry added, it's still a plain map lookup.
# (0 of [...person]) is its first entry (also a mutable entry)
#
# square:5
# Means 5 of square
# Because it's a method this is same as square of 5

# EDIT: I don't think this is a good idea. Having reference-ey things is funky
#		and hurts performance in the normal case.
#       Plus, it's always possible to do: (update in person using field: 'age'),
#		That will give a thunk that can be used to set the value at any time


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
	(  destructuringList _:+ "=" _:+ {% take %}
	 | destructuringData _:+ "=" _:+ {% take %} ):?
	"...":? ( identifier {% take %} | quote {% take %} ) (_ as _ identifier {% takeFourth %} ):?
		(_:+ "(" otherwise _ default _ expression ")" {% takeSeventh %} ):?

	{% ([destructuring, grouping, name, as, otherwise]) => ({
		type: 'input',
		...(grouping && { grouping }),
		name,
		...(as && { as }),
		...(destructuring && { ...destructuring }),
		...(otherwise && { otherwise })
	}) %}

destructuringList -> "["   flowing[input {% take %} ]   "]" {% ([, destructuringList])   => ({ destructuringList }) %}
destructuringData -> "{" _ flowing[input {% take %} ] _ "}" {% ([, , destructuringData]) => ({ destructuringData }) %}

for -> For _ each _ identifier _ (in {% take %} | through {% take %} | of {% take %} ) _ expression ","
		(_ to _ extent _ of _ expression "," {% takeEighth %} ):?
		(_ do ":" {% takeSecond %} ):?
	blockOf[statement {% take %} ]
	{% ([, , , , name, , itemizing, , expression, , extent, Do, statements]) => ({ type: 'for', name, itemizing, expression, ...(extent && { extent }), ...(Do && { do: Do }), statements }) %}

when -> When _ expression
	indented[(
		standalone[
			((is _ expression {% ([, , is]) => ({ is }) %} | has _ ( identifier {% take %} | quote {% take %} ) (_ as _ identifier {% takeFourth %}):? {% ([, , has, as]) => ({ has, ...(as && { as }) }) %}) ":" (_:+ statement	{% ([, statement]) => [statement] %}
				| blockOf[statement {% take %} ] {% take %} )
			{% ([test, , statements]) => ({ type: 'case', ...test, statements }) %} ) {% take %} ,
			____:+ {% ignore %}	]:+

    	standalone[
    		(otherwise ":" (_:+ statement	{% ([, statement]) => [statement] %}
				| blockOf[statement {% take %} ] {% take %} )
			{% ([, , statements]) => statements %} ) {% take %} ,
			____:+ {% ignore %}	]:?

		{% ([cases, otherwise]) => ({ cases, ...(otherwise && { otherwise }) }) %}
	) {% take %} ]
	{% ([, , expression, branches]) => ({ type: 'when', expression, ...branches }) %}


# Issue: it can be annoying for method arguments to be const,
#        because it's value is often not quite what you want within the method body yet.
#        On the other hand, making them mutable like in JS feels a bit wrong.
#        Either: - make otherwise default more expressive, allow to reference earlier input
#                - add an := operator for mutable assignment
#		         - both
#        The former is more natural, but could end up with verbose code in the parameters.
#        On the other hand, this is in fact a description of the API, so that could be a good thing.
#        If a parameter has complex default behaviour, then actually the API is itself complex.
#
#		 Probably not allow := operator (except perhaps dedicated syntax for assign on data)
#        Firstly, parameters can have "as" so the variable name is still free to match the parameter.
#        Secondly, it's better to require mutability via a Data name, as this "reifies" the state.
#        Thirdly, it doesn't gel with the modifier operators =+ etc.

# Issue: sometimes ?

statement ->
      for							{% take %}
    | when							{% take %}
    | does[collect	{% take %} ]	{% take %}
    | does[return	{% take %} ]	{% take %}
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
	| "..."							newline	{% take %}
	| ellided						newline	{% take %}


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


listLiteral -> "["   flowing[expression		{% take %} ]   "]" {% ([, list]) => ({ type: 'list', list }) %}
dataLiteral -> "{" _ flowing[dataDefinition	{% take %} ] _ "}" {% ([, , data]) => ({ type: 'data', data }) %}


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
	  expression																	{% ([expression]) => ({ type: 'expression', expression }) %}
	| assignMethodResult															{% take %}
	| assignExpand[(_:+ "="	_:+ {% ignore %} ) {% ignore %} ]						{% take %}
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , listLiteral	{% take %} ]	{% take %}
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , dataLiteral	{% take %} ]	{% take %}
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , listBlock		{% take %} ]	{% take %}
	| assignOf[(":" _:+ {% ignore %} ) {% ignore %} , dataBlock		{% take %} ]	{% take %}
	| location ":" _:+ expression
	  	{% ([location, , , expression]) =>
	  		({ type: 'dataDefinition', location, ...(expression && { expression }) }) %}


assignMethodResult -> (location {% take %} ):? methodNaming
	{% ([location, methodNaming]) => ({ type: 'assignMethodResult', ...(location && { location }), methodNaming }) %}

methodExecution -> methodCall[null	{% ignore %}	] {% take %}
methodNaming    -> methodCall[":"	{% take %}		] {% take %}


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
	| positional	{% take %}
	| literal		{% take %}
	| text			{% take %}


Use			-> "use"		{% ignore %}
When		-> "when"		{% ignore %}
For			-> "for"		{% ignore %}
each		-> "each"		{% ignore %}
to			-> "to"			{% ignore %}
extent		-> "extent"		{% ignore %}
skip		-> "skip"		{% ignore %}
stop		-> "stop"		{% ignore %}
as			-> "as"			{% ignore %}
default		-> "default"	{% ignore %}
is			-> "is"			{% take %}
has			-> "has"		{% take %}
do			-> "do"			{% take %}
in			-> "in"			{% take %}
through		-> "through"	{% take %}

# I've tried to use as few reserved keywords as possible, while still having an unambiguous parse
return		-> %Return		{% take %}
collect		-> %collect		{% take %}
of			-> %of			{% take %}
with		-> %With		{% ignore %}
otherwise	-> %otherwise	{% ignore %}

why			-> %why		{% take %}
see			-> %see		{% take %}
issue		-> %issue	{% take %}
ellided		-> %ellided	{% take %}

literal			-> %literal			{% take %}
quote			-> %quote			{% take %}
text			-> %text			{% take %}
decimalNumber	-> %decimalNumber	{% take %}
digitNumber		-> %digitNumber		{% take %}
positional		-> %positional		{% take %}
identifier		-> %identifier		{% take %}

namespaceIdentifier -> %namespaceIdentifier	{% take %}

point	-> %point	{% ignore %}
newline -> %newline	{% ignore %}
indent	-> %indent	{% ignore %}
dedent	-> %dedent	{% ignore %}
_		-> %_		{% ignore %}
____	-> %____	{% ignore %}
