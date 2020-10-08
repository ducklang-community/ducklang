
// Issue: should use the compiler to load the program code (compiling to a cache first if needed)

//definitions = load('definitions.dg')...
//Number.prototype.countingTo = definitions.get('::2020-09::Ranges::')(infinity).get('countingTo')

// Why: add any runtime methods needed here
Number.prototype.raised = function (inputs) { return this ** inputs.entries().next().value[1] }

// Issue: should run the program here
