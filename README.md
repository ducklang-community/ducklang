# 🐥 Ducklang

*No PhD required!*

## About

Ducklang is a duck-typed programming language with an emphasis on readability of the language.

### Principles

* **Duck typing**: Testing over typing - a good type system can get complex while a good integration suite can give peace of mind
* **Encapsulation**: The language is completely object oriented with all state held in objects
* **Composition**: (over inheritance) - the quick wins of inheritance can lead to code structures that are hard to refactor
* **Inversion of control**: Dependencies inject into modules not the other way round for better modularity
* **Readability**: (over concision) - the code which we're most proud about tends to be code which reads like prose
* **Promises**: Asynchronicity using promises and processes like JavaScript, but the `async`/`await` behaviour is inverted - everything is `await`'ed unless the `background` keyword is used
* **Smart tabs**: Indentation-aware syntax like Python - tabs for indentation and spaces for alignment
* **Named arguments**: methods calls pass arguments by name for readability and ease of code evolution
* **Extensibility**: most operators expand into method calls so you aren't tied by what comes shipped with the language
* **Separation of Concerns**: all code is stand-alone and can be "mixed-in" with existing types, allowing for smaller modules which do one thing and do it well
* **Uniformity**: emphasis on the object oriented paradigm and uniform whitespace makes the community's code much less irregular
* **Error propagation**: Errors are signalled using Result objects as in Rust, but the behaviour is inverted - every error is returned immediately to the caller unless the `?=` operator is used

### Code examples

Please see the [fixtures](fixtures/) directory for example code

## Usage

### Install
```shell script
yarn
```

### Run
```shell script
yarn parse-fixtures
```

## Roadmap

* Clean up the Nearley output using functions
* Build a representation of the program from the parse tree

## 👋 Say hi

* [Slack](https://join.slack.com/t/ducklang/shared_invite/zt-gt4ne6er-zASbb3R5p68g2jddKyqFOw)
* [Matrix](https://matrix.to/#/%23ducklang%3Amatrix.org)
