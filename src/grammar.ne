@{%
const moo = require('moo');
const IndentationLexer = require('moo-indentation-lexer');

const lexer = new IndentationLexer({
    lexer: moo.compile({
        comment: /"(?:\\["\\]|[^\n"\\])*"/,
        _: / /,
        ____: /\t/,
        decimalNumber: /[0-9]+\.[0-9]+/,
        digitNumber: /0|[1-9][0-9]*/,
        hexNumber: /0x0|0x[1-9a-f][0-9a-f]*/,
        string: /'(?:\\['\\]|[^\n'\\])*'/,
        expandEqual: '...=',
        dotDefine: '.:',
        colon: ':',
        dot: '.',
        comma: ',',
        lparen: '(',
        rparen: ')',
        lbrace: '{',
        rbrace: '}',
        lbracket: '[',
        rbracket: ']',
        assign: '=',
        plusEqual: '+=',
        times: '*',

        name: {
            match: /\w*[a-zA-Z]\w*/,
            type: moo.keywords({
                Using: 'using',
                Otherwise: 'otherwise',
                With: 'with',
                Of: 'of',
                Returns: 'returns',
                If: 'if',
                Else: 'else',
                Repeat: 'repeat',
                For: 'for',
                In: 'in',
                Function: 'function'
            })
        },

        NL: { match: /\n/, lineBreaks: true }
    })
});
%}

@lexer lexer

main -> %NL (using:* %NL):? method:+

using -> annotatedComment:* %Using _ name (%comma _ name):* %NL

method -> annotatedComment:* name (%_ %With _ parametersGroup):? %colon %NL
    %INDENT
    (%NL:? ____ commentedStatement):+
    %DEDENT

if -> %If %_ expression %colon %NL
    %INDENT
    (%NL:? ____:+ commentedStatement):+
    %DEDENT

for -> %For %_ name _ %In _ expression %colon %NL
    %INDENT
    (%NL:? ____:+ commentedStatement):+
    %DEDENT

commentedStatement -> annotatedComment:* statement

annotatedComment -> name:? %comment %NL

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
    | expression _ %times _ expression
    | %lbracket listGroup %rbracket
    | %lbrace _ dictionaryLine _ %rbrace
    | tabbedDictionaryGroup
    | %Function (_ %Of _ parametersGroup):? %colon _ %Returns _ expression
    | methodCall
    | %lparen expression %rparen

methodCall -> name (_ %Of):? _ expression (_ %With methodArguments):? (_ %Otherwise _ expression):?

methodArguments -> _ dictionaryLine (%comma %NL tabbedDictionaryGroup):?
    | _ %lbrace _ dictionaryLine _ %rbrace
    | (_ dictionaryLine %comma):? %NL tabbedDictionaryGroup

tabbedDictionaryGroup -> %INDENT
    tabbedDictionaryLine tabbedDictionaryLineList:? %comma:? %NL
    %DEDENT

tabbedDictionaryLineList -> (%comma %NL tabbedDictionaryLine):+
tabbedDictionaryLine -> ____:+ dictionaryLine

dictionaryLine -> dictionaryDefinition dictionaryList:?
dictionaryList -> (%comma _:+ dictionaryDefinition):+

dictionaryDefinition -> dictionaryName (dictionaryAssign _:+ expression):?
dictionaryAssign -> %colon | %dotDefine

dictionaryName -> name | %string

parametersGroup -> parameter (%comma _ parameter):*
parameter -> name | name _ %Otherwise _ expression

listGroup -> expression (%comma _ expression):*

name -> %name
_ -> %_
____ -> %____
