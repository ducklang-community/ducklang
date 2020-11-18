# 🐥 Ducklang

[![Join the chat at https://gitter.im/ducklang-community/ducklang](https://badges.gitter.im/ducklang-community/ducklang.svg)](https://gitter.im/ducklang-community/ducklang?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
![stability-unstable](https://img.shields.io/badge/stability-unstable-yellow.svg)

Ducklang is a duck-typed programming language with an emphasis on readability of the language.

## Sample code

![Sample code](sample.png)

See [fixtures/definitions.dg](fixtures/definitions.dg) for more example code.

## Usage

### Install
```shell script
yarn
```

### Run
```shell script
yarn build && yarn start -f fixtures/definitions.dg && cat dist/fixtures/definitions.js
```

### Principles

* **Duck typing**: Testing over typing - a good type system can get complex while a good integration suite can give peace of mind
* **Encapsulation**: The language is completely object oriented with all state held in objects
* **Composition**: (over inheritance) - the quick wins of inheritance can lead to code structures that are hard to refactor
* **Inversion of control**: Dependencies inject into modules not the other way round for better modularity
* **Readability**: (over concision) - the code which we're most proud about tends to be code which reads like prose
* **Asynchronous**: Asynchronicity using an explicit but clear fork-join model
* **Named inputs**: method calls pass inputs by name for readability and ease of code evolution. Un-named inputs and positional-matching can also be used.
* **Extensibility**: most operators expand into method calls so you aren't tied by what comes shipped with the language
* **Separation of Concerns**: all code is stand-alone and can be "mixed-in" with existing types, allowing for smaller modules which do one thing and do it well
* **Uniformity**: emphasis on the object oriented paradigm and uniform whitespace means code is more regular across projects
* **Error propagation**: Errors are signalled using Result objects as in Rust, but the behaviour is inverted - every error is returned immediately to the caller unless the `?=` operator is used. The code expresses optimism, tests express skepticism.
* **Itemization**: Powerful iterable sequences with offset-ability are truly first-class in the language

## Roadmap

* ~~Define the language grammar~~
* ~~Clean up the Nearley output using functions~~
* Compile the program representation into JavaScript (in progress, ~75%)
* Dependabot-style software lockfile updater for any dependency maps found inside the repo (in progress, ~10%)
* Source-code fetch into ~/.local cache (Certificate Transparency style checks?)
* 'yarn link' style behaviour for local code checkouts of projects
* Ability to instantiate Program and run it inside a Tasklet
* Add validations on the parse-tree prior to generating output
* VS Code plugin
* Open Source code search

## Project organisation

Ducklang takes a *keep it as simple as needed* approach to community organisation.
At the moment that means the language originator acting as a de-facto
product manager, shepherding the language between differing concepts and goals.

The project code is young, and as such any code is welcome, however scrappy
(good quality code is welcome too :)

## Code of conduct

* Be vocal
* Be pleasant
* Be succinct
