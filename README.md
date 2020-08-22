# 🐥 Ducklang

*No PhD required!*

## About

Ducklang is a duck-typed programming language with an emphasis on readability of the language.

### Principles

* Duck Typing: Testing over typing - a good type system can get complex, while a good integration suite can give peace of mind
* Encapsulation: The language is completely object oriented, with all state held in objects
* Composition: (over inheritance) - the quick wins of inheritance can lead to code structures that are hard to refactor
* Inversion of Control: Dependencies inject into modules, not the other way round
* Readability: (over concision) - the code we tend to be most proud of is code that can be read almost like prose
* Promises: Asynchronicity using promises and processes like JavaScript, however the `async`/`await` behaviour is inverted - everything is `await`'ed unless the `background` keyword is used
* Smart Tabs: Indentation-aware syntax like Python - tabs for indentation, and spaces for alignment
* Named Arguments: methods calls pass arguments by name, for readability and ease of code evolution
* Extensibility: most operators expand into method calls, so you aren't tied by what comes shipped with the language
* Separation of Concerns: all code is stand-alone and can be "mixed-in" with existing types, allowing for smaller modules which do one thing and do it well

### Examples

Please see code examples in the [](fixtures/) directory

## Install
```shell script
yarn
```

## Run
```shell script
yarn build && yarn parse <fixtures/getOrDefault.dg
yarn build && yarn parse <fixtures/run.dg
yarn build && yarn parse <fixtures/program.dg
yarn build && yarn parse <fixtures/rocket.dg
```
