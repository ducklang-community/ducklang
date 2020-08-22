@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({
        comment: /"(?:\\["\\]|[^\n"\\])*"/,
        string: /'(?:\\['\\]|[^\n'\\])*'/,
        interpolation: /`(?:\\[`\\]|[^\n`\\])*`/,
        NL: { match: /\n/, lineBreaks: true },
        _: / /,
        ____: /\t/,
        expandEqual: '...=',
        plusEqual: '+=',
        assign: '=',
        dotDefine: '.:',
        colon: ':',
        dot: '.',
        comma: ',',
        leftParen: '(',
        rightParen: ')',
        leftBrace: '{',
        rightBrace: '}',
        leftBracket: '[',
        rightBracket: ']',
        greater: '>',
        times: '*',
        decimalNumber: /[0-9]+\.[0-9]+/,
        digitNumber: /0|[1-9][0-9]*/,
        hexNumber: /0x0|0x[1-9a-f][0-9a-f]*/,

        name: {
            match: /\w*[a-zA-Z]\w*/,
            type: moo.keywords({
                Using: 'using',
                Otherwise: 'otherwise',
                Default: 'default',
                With: 'with',
                Of: 'of',
                Returns: 'returns',
                If: 'if',
                Repeat: 'repeat',
                For: 'for',
                In: 'in',
                Function: 'function'
            })
        },
    })
});
%}

@lexer lexer

lineList[DEFINITION] -> (%comma %NL $DEFINITION):+
spaceSeparated[SEGMENT] -> _ $SEGMENT | %NL %INDENT ____:+ $SEGMENT %NL %DEDENT

main -> %NL using:? method:+

using -> annotatedComment:* %Using dependencies %NL

method -> annotatedComment:* name (%_ %With _ parametersGroup):? %colon %NL
	indentedCommentedStatements

if -> %If _ expression %colon %NL
		indentedCommentedStatements
    (%NL:? ____:+ %Otherwise %colon %NL
		indentedCommentedStatements):?

for -> %For _ name _ %In _ expression %colon %NL
	indentedCommentedStatements


indentedCommentedStatements -> %INDENT
    (%NL:? ____:+ commentedStatement):+
    %DEDENT

commentedStatement -> annotatedComment:* statement

annotatedComment -> annotation _ %comment %NL
annotation -> "note" | "idea" | "todo"

statement -> methodCall %NL
    | if
    | for
    | %name (%dot %name):? _ %assign _ expression %NL
    | %name (%dot %name):? _ %plusEqual _ expression %NL
    | %expandEqual _ expression %NL
    | %Returns _ expression %NL


expression -> name
    | expression %dot name
    | %digitNumber
    | %decimalNumber
    | %string
    | %interpolation
    | expression _ %times _ expression
    | expression _ %greater _ expression
    | %leftBracket %rightBracket
    | %leftBracket listGroup %rightBracket
    | %leftBrace %rightBrace
    | %leftBrace _ dictionaryLine _ %rightBrace
    | tabbedDictionaryGroup
    | %Function (_ %Of _ parametersGroup):? %colon _ %Returns _ expression
    | listComprehension
    | ifExpression
    | methodCall
    | %leftParen expression %rightParen


ifExpression -> expression _ %If _ expression _ %Otherwise _ expression

listComprehension -> %leftBracket expression (_ %For _ name _ %In _ expression):+ (_ %If _ expression):? %rightBracket


methodCall -> name (_ %Of):? _ expression (_ %With methodArguments):? (spaceSeparated[%Otherwise _ %Default _ expression]):?


methodArguments -> _ dictionaryLine
    | _ %leftBrace _ dictionaryLine _ %rightBrace
    | (_ dictionaryLine %comma):? %NL tabbedDictionaryGroup

tabbedDictionaryGroup -> %INDENT
    tabbedDictionaryLine tabbedDictionaryLineList:? %comma:? %NL
    %DEDENT

tabbedDictionaryLineList -> lineList[tabbedDictionaryLine]
tabbedDictionaryLine -> ____:+ dictionaryLine

dictionaryLine -> dictionaryDefinition dictionaryList:?
dictionaryList -> (%comma _:+ dictionaryDefinition):+

dictionaryDefinition -> dictionaryName (dictionaryAssign _:+ expression):?
dictionaryAssign -> %colon | %dotDefine

dictionaryName -> name | %string


dependencies -> _ dependencyLine %NL
    | (_ dependencyLine %comma):? %NL tabbedDependencyGroup

tabbedDependencyGroup -> %INDENT
    tabbedDependencyLine tabbedDependencyLineList:? %comma:? %NL
    %DEDENT

tabbedDependencyLineList -> lineList[tabbedDependencyLine]
tabbedDependencyLine -> ____:+ dependencyLine

dependencyLine -> name dependencyList:?
dependencyList -> (%comma _ name):+


parametersGroup -> parameter (%comma _ parameter):*
parameter -> name | name _ %Otherwise _ expression

listGroup -> expression (%comma _ expression):*

name -> %name
_ -> %_
____ -> %____
