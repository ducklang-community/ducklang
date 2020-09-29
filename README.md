# 🐥 Ducklang

[![Join the chat at https://gitter.im/ducklang-community/ducklang](https://badges.gitter.im/ducklang-community/ducklang.svg)](https://gitter.im/ducklang-community/ducklang?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

Ducklang is a duck-typed programming language with an emphasis on readability of the language.

## Examples

```ducklang



::2020-09::Sequences::



use infinity


fibonacci:
    for each n through infinity,
        when n
            is 0: collect 0
            is 1: collect 1
            otherwise: collect (fibonacci (n - 1)) + (fibonacci (n - 2))



::2020-09::Rocket::



use log,
    blaster,
    turbo


engageBoosters of self with thrust,
                            angle (otherwise default 0.0),
                            color (otherwise default 'green'):

    checksResult = preCheck blaster with angle, thrust

    add log with info: 'Hi {name}! Your favourite drink is {drink}.'

    state... of turbo with { angle, thrust,
                             size: usage of self } otherwise default 'poor'

    when state
        is 'good':
            add log with info: 'Turbo is go!'
            result launchBoosters of self with angle, thrust, state

        is 'okay':
            add log with warning: 'Turbo is iffy :/'
            result launchBoosters of self with angle, thrust, state

        otherwise:
            result 'stopped'



```

See [fixtures/definitions.dg](fixtures/definitions.dg) for more example code.

## Usage

### Install
```shell script
yarn
```

### Run
```shell script
yarn parse-fixtures
```

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

## Roadmap

* ~~Define the language grammar~~
* ~~Clean up the Nearley output using functions~~
* Compile the program representation into JavaScript (in progress)
* Using the generated JavaScript methods from a JavaScript inversion-control-style program
* Add validations on the parse-tree prior to generating output
* NPM-style method and namespace repository, using github sources direct and Certificate Transparency style consistency

## Project organisation

Ducklang takes a *keep it as simple as needed* approach to community organisation.
At the moment that means the language originator acting as a de-facto
product manager, shepherding the language between differing concepts and goals.

The project code is young, and as such any code is welcome, however unprofessional
(though good quality code is of course welcome too :).

## Code of conduct

* Be vocal
* Be pleasant
* Be succinct
