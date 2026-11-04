# Metrics methodology

This document defines every metric, formula and threshold that the unslop-ts health report uses. It gives the
external source of each method and names the engine-policy decision where the engine chooses its own value.

## Measurement units

A unit is one executable function: a function declaration, a function expression, an arrow function, a class
method, an object method, a constructor or a getter or setter. The engine finds units with the pinned Babel parser
and measures each unit over its own range. A nested function is a separate unit, and its decisions never count
toward its ancestors. A unit start excludes a declared method key, so every host reports the same start. A default value in a parameter
list adds no decision, and the `?.` links that the extended variant counts are the ones in the body.

Cyclomatic contributions carry weight one and no nesting. Cognitive contributions carry a weight and a nesting
level. Both lists are sorted by line and column.

## Cyclomatic complexity

The count is `1 + the sum of decision weights` (McCabe 1976). The engine implements two variants:

| Variant    | Counts                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `classic`  | `for`, `for-in`, `for-of`, `while`, `do-while`, `if`, `else if`, `catch`, `case`, `ternary`, `&&`, ` |
| `extended` | Every classic construct, plus `??`, every optional-chain link and every logical assignment (`&&=`, ` |

`countNullish` controls the `??` contribution of the extended variant. With `countNullish: false` a `??` counts
nothing. The default engine variant is `extended`, and `DEFAULT_COUNT_NULLISH` is true. A `switch` statement adds
no separate weight: its `case` clauses each add one, and a `default` clause adds none. A `&&` or `||` chain adds
one per operator, not one per run.

### Contribution kinds

| Kind                 | Classic | Extended | Cognitive |
| -------------------- | ------- | -------- | --------- |
| `if`                 | yes     | yes      | yes       |
| `else-if`            | yes     | yes      | yes       |
| `else`               | no      | no       | yes       |
| `for`                | yes     | yes      | yes       |
| `for-in`             | yes     | yes      | yes       |
| `for-of`             | yes     | yes      | yes       |
| `while`              | yes     | yes      | yes       |
| `do-while`           | yes     | yes      | yes       |
| `case`               | yes     | yes      | no        |
| `switch`             | no      | no       | yes       |
| `catch`              | yes     | yes      | yes       |
| `ternary`            | yes     | yes      | yes       |
| `logical-and`        | yes     | yes      | yes       |
| `logical-or`         | yes     | yes      | yes       |
| `nullish-coalescing` | no      | yes      | yes       |
| `optional-chain`     | no      | yes      | no        |
| `logical-assignment` | no      | yes      | no        |
| `labeled-jump`       | no      | no       | yes       |
| `recursion`          | no      | no       | yes       |

The engine exports this list as `METRIC_CONTRIBUTION_KINDS`. The test below proves that the table names exactly
that tuple.

## Cognitive complexity

The engine follows Campbell's cognitive complexity model (SonarSource 2018). A structural construct adds
`1 + nesting` where the nesting is the number of enclosing bodies. A flat construct adds `1`.

| Construct                                            | Weight        |
| ---------------------------------------------------- | ------------- |
| `if`, `for`, `for-in`, `for-of`, `while`, `do-while` | `1 + nesting` |
| `switch`                                             | `1 + nesting` |
| `catch`                                              | `1 + nesting` |
| `ternary`                                            | `1 + nesting` |
| `else if`                                            | `1`           |
| `else`                                               | `1`           |
| Each logical run (`&&`, `                            |               |
| `labeled-jump`                                       | `1`           |
| `recursion`                                          | `1`           |

An `if` body, a loop body, a `catch` body, a `switch` case body and a ternary branch each raise the nesting by
one. A logical run is a maximal chain of one operator. `countNullish` controls whether a `??` run counts. A call
to the unit's own name counts as recursion once. A nested function declaration, a class declaration, a variable, a
parameter or a `catch` binding with the same name shadows the call, so it adds nothing. The check is function-wide:
a binding anywhere in the unit blocks the recursion count, even in a scope that does not contain the call. This is
the conservative reading of an uncertain binding, and it can lower a cognitive value. The worked example
`recursion-shadow` shows it.

### Differences from the paper, SonarJS and fallow

- The published SonarSource white paper counts each logical operator of a chain only when the operator changes;
  the engine counts one per run, so `a && b && c` adds one.
- SonarJS increments nesting for `switch` case bodies and for ternary branches; the engine does the same.
- fallow 3.36.0 counts `??` in its cognitive metric and applies its own nesting rules. The calibration below
  records the measured differences rather than a claim of exact parity.
- The engine has no framework-aware or macro-expanded view. It measures syntax only.

## Lines of code and parameters

`lines` is the number of unique source lines containing code tokens owned by one unit. A nested function owns its
own tokens; its lines do not also count toward the enclosing function. Blank lines and comment-only lines do not
count. The unit start is normalized as described above for its reported position. `params` is the number of
declared parameters; a destructured pattern counts as one parameter. File-level `lines` uses the same code-token
definition across the whole file, so it can be lower than physical file length.

## Maintainability index

The health report uses a density-based file score, clamped to the range 0 to 100:

`MI = clamp(100 - 30 × (CC / LOC) × min(LOC / 50, 1) - 20 × deadExportRatio - min(4 × ln(fanOut + 1), 15))`

`CC` sums the measured functions' cyclomatic values and the module's cyclomatic value. Module complexity
starts at one and counts top-level decisions outside function bodies. `LOC` counts unique code-token lines in the file,
`deadExportRatio` is the unused share of value exports, and `fanOut` counts distinct internal targets. An empty
file has zero density. This is not the classic Halstead-volume maintainability index, and it must not be compared
as though it were the same metric.

## CRAP and coverage

The change-risk anti-pattern score (CRAP) is:

`CRAP = CC^2 * (1 - cov / 100)^3 + CC`

`CC` is the unit's cyclomatic count and `cov` is the line coverage of the unit in percent. Bands are below 30,
below 50, below 100 and 100 or more, in the order that the report prints them. When no measured coverage covers
a unit, the engine uses a fallback: 85 percent for a directly reachable unit, 40 percent for an indirectly
reachable unit and 0 percent for an unreachable unit. This is an engine-policy decision (Savoia's CRAP model
does not define unreachable code).

Coverage comes from an LCOV file. The parser checks each record against its grammar: `DA` needs a positive line
and a decimal hit count, `FN`, `FNDA` and `BRDA` follow their field lists, and the count tags are decimal
integers. A merged hit count must stay finite. A malformed record rejects the whole input, so it never becomes
measured evidence. Each record is bounded to 1 MiB of UTF-8, each input to 256 MiB and each source file to 16 MiB,
and a read stops at the bound instead of buffering the file.

The coverage manifest maps source paths to SHA-256 digests. The revision is `verified` only when the manifest names
every covered source and each digest matches the measured bytes. An empty or partial manifest leaves the revision
`unverified`. A malformed digest, an unknown path or a changed source is rejected.

## History and hotspots

Churn comes from the Git history of each file. The engine runs the fixed argument list
`git log --no-renames --no-merges -z --numstat` and applies a 90-day half-life to weigh recent changes. A hotspot
is a file whose churn and complexity both place it above the report thresholds. The engine accepts `--since` as
a day, month or ISO date and `--min-commits` as the history floor. Every Git call and the local duplicate runner
run under a deadline and byte limits on stdout and stderr. A child that passes a limit is killed, awaited and
reported as an unavailable signal with its cause. A child that exits returns its result at once: streams that a
grandchild keeps open are cancelled after a short grace. Only an unborn HEAD makes the history empty, and any other
failure of the HEAD probe makes the hotspot signal unavailable. A snapshot digest that cannot be read leaves the
duplication signal unavailable with the reason `source-changed-during-scan`.

## Project score

The score starts at 100 and subtracts one penalty per signal:

| Signal                 | Penalty per item  | Cap |
| ---------------------- | ----------------- | --- |
| Dead files and exports | 0.2               | 15  |
| Complexity findings    | 4                 | 20  |
| Maintainability        | 1.5               | 15  |
| Hotspots (per file)    | 10                | 10  |
| Cycles                 | 0.5               | 25  |
| Unit size              | 0.5               | 10  |
| Coupling               | 0.5               | 5   |
| Duplication            | `max(0, pct - 5)` | 10  |

Dependency signals come from the import graph. The graph resolves relative specifiers and the import maps of the
root and the workspace members, including `deno.jsonc` files and workspace package exports. An exact key matches only
itself, and the longest directory prefix wins. A workspace entry or an import target that leaves the project root is
ignored. A key that two configs map to different files, or an alias whose
target is not in the snapshot, makes the graph incomplete, and the graph signals become unavailable. A dead export
is an export site that no resolved import, re-export chain or public entry reaches. The cycle signal divides the
cycle count by all measured files, the same population as the vital sign.

The report supports nine score signals. It marks unused dependencies and prop drilling `not_measured` because
health v2 does not implement them; they are outside the formula and do not affect completeness. A supported signal,
such as duplication, is `unavailable` when its input or
runner is missing. A missing LCOV file is reported separately as coverage source `none`; CRAP then uses static
reachability estimates. Grades are A at 85 or more, B at 70, C at 55 and D at 40. A partial report has no grade.

## Thresholds and gates

The rule gate defaults to 15 cyclomatic, 15 cognitive and 60 lines per function. The line rule accepts a second,
optional limit, `softMax`, that is below `max`. The lint rule ignores `softMax`. The health report uses it, when it is set,
as the line limit of its findings, so a function between `softMax` and `max` is an advisory finding and fails no gate. The phase refactoring tranche
targets 20 cyclomatic and 30 cognitive. The compiled workspace ceilings are measured counts, and the
`check:complexity` task runs three single-rule invocations against them from the descriptor root with its own lint
config. A scan passes only when the lint plugin reports that the rule ran on files: a missing plugin, an inactive
rule or an empty scope fails the invocation, and so does every file that the plugin observed without a terminal
record for the rule. Listed lint files are compared in the path form that the plugin records. A ceiling is lowered only to a measured
count and never raised.

## Calibration record

The frozen calibration (2026-10-30) used the extended variant with `countNullish: true`. It compares the full
function populations of both tools. The pinned signed fallow 3.36.0 (schema 12) run matched 46,137 of 46,138
functions on each side: coverage 99.998 percent each, exact cyclomatic 97.78 percent and exact cognitive 99.77
percent. One fallow row and one core row stay unmatched in the exactl flow-command test (one anonymous method, one
column apart). Parse failures and ambiguous keys were zero.

Only listed exclusions leave a population, each with a stated reason in `CALIBRATION_EXCLUSIONS`. They removed
604 fallow rows and 496 core rows of the scenario fixture projects, which the two tools scan differently, 2,587
core rows of the generated engine bundle, and 22 core rows of evidence probes and generated scenario output. A
tool-only file that no exclusion names counts against the coverage of the tool that lacks it. A parse failure, an
ambiguous key or coverage below 99 percent makes the calibration insufficient.

## Class design metrics

Class metrics describe the design of one class. The class metric core measures what one file shows. The class pass of the health
report adds what only other files show, such as inheritance and the type of a receiver. Each metric below names its source by a tag
that the reference list resolves: [CK94] Chidamber and Kemerer, [BK95] Bieman and Kang, [HM95] Hitz and Montazeri and
[LM06] Lanza and Marinescu. Every class value carries a `precision` label: `syntactic` for the per-file value of the lint rule
and `typed` for the value of the health report.

### The class unit

A unit is one class declaration or class expression. Its methods are the methods and accessors it declares, and the
constructor is not a method for NOM. Its attributes are the property declarations and the constructor parameter properties. A
nested class is its own unit, and a function nested in a method belongs to that method. An object literal is not a class, and a
mixin factory counts only for the class expression it returns. The exact member kinds that the engine reads are the ones of the
Babel and the Deno host tree, and a test proves that both trees give equal values for the worked classes.

<!-- class-example: class-unit -->

```ts
class Account {
  private balance = 0;
  readonly id = 1;
  constructor(public owner: string) {}
  deposit(amount: number): void {
    this.balance += amount;
  }
  get total(): number {
    return this.balance;
  }
}
```

```json
{
  "id": "class-unit",
  "expected": {
    "Account": { "nom": 2, "noa": 3, "wmc": 3, "tcc": 1, "lcom4": 1, "noap": 1, "noam": 1 }
  }
}
```

`Account` has two methods (`deposit` and the accessor `total`), three attributes (`balance`, `id` and the parameter property
`owner`) and a WMC of 3, because the constructor and each method add 1. The Deno host tree does not report the accessibility of a
constructor parameter property, so NOAP counts declared properties only: `id` is the one public attribute, and `owner` is not
counted.

### Chidamber and Kemerer metrics

| Metric | Original definition [CK94]                             | unslop-ts definition                                                                                                         | Difference                                                                                                                       |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| WMC    | Sum of the complexities of the methods of a class      | Sum of the classic cyclomatic values of the constructor and the methods, and a nested function adds its value minus its base | The original leaves the weight open. The engine uses McCabe, and the classic variant because the limits come from classic counts |
| CBO    | Number of other classes that a class is coupled to     | Typed: the project classes and interfaces that the class names in types, `new`, receivers and `extends`, without itself      | The syntactic value counts imported or declared names used the same way and ignores externals                                    |
| RFC    | Methods of the class plus the methods that it can call | NOM plus the distinct methods of other types that typed receivers call, interfaces included and the class family left out    | Null where the pass cannot type a receiver                                                                                       |
| DIT    | Length of the path from the class to the root          | The longest `extends` chain among the walked classes. A base that no walked class declares adds 1 and ends the chain         | `implements` is not inheritance here                                                                                             |
| NOC    | Number of immediate subclasses                         | The direct subclasses among the walked classes                                                                               | Subclasses outside the walked files are unknown                                                                                  |

The original lack of cohesion of methods of [CK94] is not used. Section "Cohesion" explains the replacement.

### Cohesion

Tight class cohesion [BK95] is the share of visible method pairs that use a common attribute directly. A method is visible when
it is not private and its name does not start with `#`. A pair is connected when both methods read the same attribute through
`this`. The value is null for fewer than two visible methods, because no pair exists. A constructor takes no part, and a read in
a nested function belongs to the method that holds it.

LCOM4 [HM95] is the number of connected components of the graph whose nodes are the methods and whose edges join two methods
that share an attribute or where one calls the other through `this`. A value of 1 means one cohesive group, and a value of 2 or
more means that the class holds that many groups that could be separate classes. The original value of [CK94] counts method pairs
and stops at zero, so it cannot tell a class of two groups from a class of five. The component count can.

<!-- class-example: class-cohesion-groups -->

```ts
class Counter {
  private count = 0;
  private step = 1;
  inc(): void {
    this.count += this.step;
  }
  reset(): void {
    this.count = 0;
  }
  label(): string {
    return "counter";
  }
}
```

```json
{
  "id": "class-cohesion-groups",
  "expected": {
    "Counter": { "nom": 3, "wmc": 3, "noa": 2, "tcc": 0.3333333333333333, "lcom4": 2 }
  }
}
```

Of the three pairs only `inc` and `reset` share an attribute, so TCC is 1/3. `label` reads no attribute, so the graph has two
components, `inc` with `reset` and `label` alone.

### Foreign data

Access to foreign data (ATFD) counts the distinct attributes of other classes that a class reads directly. Locality of attribute
accesses (LAA) is the share of the attributes that a method reads that belong to its own class. Foreign data providers (FDP)
counts the distinct classes whose attributes a method reads. All three come from [LM06].

The lint rule has one file only. It counts the distinct `receiver.property` reads where the receiver is a plain identifier or
`this.field`. It leaves out calls, plain assignments, receivers that start with an uppercase letter, namespace imports, declared
types and the method names that the file declares. This is an approximation and its label is `syntactic`. The health report
types the receiver from the declaration of a parameter, a field, a variable, a return type or a cast. It counts a read only when
the receiver is a known class and the property is a field or an accessor of that class. An unknown or interface receiver adds
nothing, so the typed value never counts a read that it cannot place. The two values can differ for this reason, and each
carries its label.

<!-- class-example: class-foreign-data -->

```ts
class Report {
  total(order: { price: number; qty: number }, tax: { rate: number }): number {
    return order.price * order.qty * tax.rate;
  }
}
```

```json
{
  "id": "class-foreign-data",
  "expected": {
    "Report": { "atfd": 3, "cbo": 0, "precision": "syntactic" }
  }
}
```

The syntactic count is 3: `order.price`, `order.qty` and `tax.rate`. A typed pass over the same file would count none of them,
because the receivers have anonymous object types and no known class.

### Detection strategies

The strategies of [LM06] combine the metrics. A strategy is a conjunction of conditions, and each condition compares one
metric with a limit.

| Strategy     | Unit   | Condition                                                                                                                            |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| God Class    | class  | `wmcVeryHigh` <= WMC and TCC < `tccLimit` and ATFD > `atfdFew`                                                                       |
| Data Class   | class  | WOC < `wocLimit` and ((NOAP + NOAM > `dataClassFew` and WMC < `wmcHigh`) or (NOAP + NOAM > `dataClassMany` and WMC < `wmcVeryHigh`)) |
| Feature Envy | method | ATFD > `atfdFew` and LAA < `laaLimit` and FDP <= `fdpFew`                                                                            |

Weight of class (WOC) is the number of public methods that are not accessors, divided by all public members, and it is null when
a class has no public member. NOAP counts public attributes and NOAM counts public accessor methods.

The limits are second-hand values. The printed book was not available, so each value is a commonly cited figure with the
sources that quote it and the date on which they were read. The table is checked against the constants of the engine.

| Limit           | Value  | Used by                 | Retrieved  | Sources                                                                                                                                                                                                                                                |
| --------------- | ------ | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wmcVeryHigh`   | 47     | God Class, Data Class   | 2026-11-04 | https://docs.rs/cha-core/1.20.0/src/cha_core/plugins/god_class.rs.html, https://homepages.dcc.ufmg.br/~figueiredo/disciplinas/lectures/bad-smell-detection_v01.pdf, https://simpleorientedarchitecture.com/how-to-identify-data-class-using-ndepend/   |
| `tccLimit`      | 0.3333 | God Class               | 2026-11-04 | https://docs.rs/cha-core/1.20.0/src/cha_core/plugins/god_class.rs.html, https://homepages.dcc.ufmg.br/~figueiredo/disciplinas/lectures/bad-smell-detection_v01.pdf                                                                                     |
| `atfdFew`       | 5      | God Class, Feature Envy | 2026-11-04 | https://docs.rs/cha-core/1.20.0/src/cha_core/plugins/god_class.rs.html, https://homepages.dcc.ufmg.br/~figueiredo/disciplinas/lectures/bad-smell-detection_v01.pdf, https://simpleorientedarchitecture.com/how-to-identify-feature-envy-using-ndepend/ |
| `wmcHigh`       | 31     | Data Class              | 2026-11-04 | https://simpleorientedarchitecture.com/how-to-identify-data-class-using-ndepend/                                                                                                                                                                       |
| `dataClassFew`  | 5      | Data Class              | 2026-11-04 | https://simpleorientedarchitecture.com/how-to-identify-data-class-using-ndepend/                                                                                                                                                                       |
| `dataClassMany` | 8      | Data Class              | 2026-11-04 | https://simpleorientedarchitecture.com/how-to-identify-data-class-using-ndepend/                                                                                                                                                                       |
| `wocLimit`      | 0.3333 | Data Class              | 2026-11-04 | https://simpleorientedarchitecture.com/how-to-identify-data-class-using-ndepend/                                                                                                                                                                       |
| `laaLimit`      | 0.3333 | Feature Envy            | 2026-11-04 | https://simpleorientedarchitecture.com/how-to-identify-feature-envy-using-ndepend/, https://homepages.dcc.ufmg.br/~figueiredo/disciplinas/lectures/bad-smell-detection_v01.pdf                                                                         |
| `fdpFew`        | 5      | Feature Envy            | 2026-11-04 | https://simpleorientedarchitecture.com/how-to-identify-feature-envy-using-ndepend/, https://homepages.dcc.ufmg.br/~figueiredo/disciplinas/lectures/bad-smell-detection_v01.pdf                                                                         |

The article on Feature Envy uses `FDP <= 3` in its own query. The slides and the book formula use `FDP <= Few`, so the limit is the
Few value of 5. A summary of a thesis that reported `NOAP + NOAM > 2` and `> 7` was not confirmed and is not used.

The health report also derives the limits from the walked classes. For each metric it takes the mean and the population standard
deviation over the classes that declare a method. LOW is the mean minus one deviation and never below zero, AVERAGE is the mean,
HIGH is the mean plus one deviation, and VERY_HIGH is HIGH times 1.5. The report prints these bands beside the sourced defaults,
which is the calibration check for TypeScript code.

<!-- class-example: derived-bands -->

```ts
// The WMC values of eight classes: 2, 4, 4, 4, 5, 5, 7, 9.
```

```json
{
  "id": "derived-bands",
  "bands": [2, 4, 4, 4, 5, 5, 7, 9]
}
```

The mean is 5 and the deviation is 2, so the bands are 3, 5, 7 and 10.5.

<!-- class-example: data-class -->

```ts
class Point {
  x = 1;
  y = 2;
  z = 3;
  w = 4;
  v = 5;
  u = 6;
}
```

```json
{
  "id": "data-class",
  "expected": {
    "Point": { "nom": 0, "wmc": 0, "noap": 6, "noam": 0, "woc": 0 }
  },
  "strategies": { "Point": ["data-class"] }
}
```

`Point` has six public attributes and no method, so WOC is 0, NOAP is 6, which is above 5, and WMC is 0, which is below 31.

<!-- class-example: god-class -->

```ts
class Hub {
  private a0 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private a4 = 0;
  private a5 = 0;
  private a6 = 0;
  m0(o: Other, a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
    return o.f0 > this.a0 && a && b && c && d && e ? 1 : 2;
  }
  m1(o: Other, a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
    return o.f1 > this.a1 && a && b && c && d && e ? 1 : 2;
  }
  m2(o: Other, a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
    return o.f2 > this.a2 && a && b && c && d && e ? 1 : 2;
  }
  m3(o: Other, a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
    return o.f3 > this.a3 && a && b && c && d && e ? 1 : 2;
  }
  m4(o: Other, a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
    return o.f4 > this.a4 && a && b && c && d && e ? 1 : 2;
  }
  m5(o: Other, a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
    return o.f5 > this.a5 && a && b && c && d && e ? 1 : 2;
  }
  m6(o: Other, a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
    return o.f6 > this.a6 && a && b && c && d && e ? 1 : 2;
  }
}
```

```json
{
  "id": "god-class",
  "expected": {
    "Hub": { "nom": 7, "wmc": 49, "tcc": 0, "atfd": 7, "woc": 1 }
  },
  "strategies": { "Hub": ["god-class"] }
}
```

Each method adds 1, five `&&` and one ternary, so its value is 7 and WMC is 49, above 47. No two methods read the same attribute, so
TCC is 0. The class reads seven properties of `o`, so ATFD is 7, above 5. All three conditions hold.

### The legacy score

The class-size rule keeps its earlier weighted score under `strategy: "legacy-score"`, so a consumer can compare the two
algorithms or return to the old one. The score is rounded from six terms: 1.5 per method up to 30 methods; 3 per constructor
parameter when there are more than 7; one point per 50 lines above `minClassLines`; one point per 10 lines of the longest method above
100; 1.5 per import above 24; and 0.8 per field above 3. A class under `minClassLines` is skipped, and a class is reported when its
score exceeds `threshold`. The score measures size. It ranks a large cohesive class above a small tangled one, which is why the
God Class strategy is the default. The legacy message also prints WMC, TCC and LCOM4 for comparison.

### Parameter count

The parameter count is a function metric and is not part of the God Class conditions. The rule `max-params` counts the declared
parameters of a function, an arrow, a method and a constructor, once each, whether required, optional, defaulted or rest, and
counts a constructor parameter property. An erased TypeScript `this` parameter is free. An interface method signature and a
function type are not counted. A function with seven parameters passes and one with eight fails. A typed options object counts once,
so it satisfies the rule, but it does not prove that the grouped values belong together, and a class design problem is not solved by
moving its dependencies into one object.

### Calibration of the strategies

On 2026-11-04, at the cutover commit `faf52aa75`, the class-size rule found 39 classes with the God Class strategy and 17 with the
legacy score in the lint roots of this repository. Eleven classes were in both runs, 28 only in the God Class run and 6 only in the
legacy run. The classes only in the legacy run are large and cohesive, such as `FlowRunner` with TCC 1.00 and ATFD 0. The typed
report found no god class in the same tree, because the worst classes read other objects through methods and injected interfaces
and not through attributes. The two precisions therefore disagree on this repository, and the gate uses the syntactic rule with
per-package ceilings. The ceilings only hold a count from rising.

### Limits of class metrics from syntax

The pass reads syntax and declared types. It does not run the type checker, so structural typing, an inferred type, a mixin, a
decorator that adds members and a dynamic property access are invisible to it. A class declared inside a function or a class
expression is measured on the Babel tree and gets syntactic values only. Only top-level class declarations get typed values and
a position in the inheritance counts. A receiver whose declared type is a union of classes counts for each of them. The Deno host
tree does not give the accessibility of a parameter property, so NOAP leaves such properties out in both trees.

## Limitations

The measurement is syntax-only. The engine does not expand macros, evaluate types, follow generated code or
resolve framework conventions. A file that fails to parse is reported and skipped. The report reads the source
tree that the snapshot records, so a run over a shallow clone reports partial history.

## Worked examples

Each example is a standard `ts` fence followed by one `json` fence with its options and expected values. The
methodology test executes every example through the public metrics API.

<!-- metric-example: cyclomatic-classic-extended -->

```ts
function decide(value: string | null): boolean {
  if (value?.trim() && value !== "") {
    return value ?? true;
  }
  return false;
}
```

```json
{
  "id": "cyclomatic-classic-extended",
  "options": { "variant": "extended", "countNullish": true },
  "expected": { "decide": { "cyclomatic": 5, "cognitive": 3, "lines": 6, "params": 1 } }
}
```

The classic variant counts 3 for the same function: the base, the `if` and the `&&`. The extended variant adds
the optional link and the `??`.

<!-- metric-example: cognitive-nesting -->

```ts
function scan(rows: number[][]): number {
  let total = 0;
  for (const row of rows) {
    for (const cell of row) {
      if (cell > 0) {
        total += cell;
      }
    }
  }
  return total;
}
```

```json
{
  "id": "cognitive-nesting",
  "options": { "variant": "extended", "countNullish": true },
  "expected": { "scan": { "cyclomatic": 4, "cognitive": 6, "lines": 11, "params": 1 } }
}
```

<!-- metric-example: recursion-shadow -->

```ts
function walk(node: { next: unknown } | null): unknown {
  try {
    return node?.next;
  } catch (walk) {
    return walk;
  }
  return walk(node);
}
```

```json
{
  "id": "recursion-shadow",
  "options": { "variant": "extended", "countNullish": true },
  "expected": { "walk": { "cyclomatic": 3, "cognitive": 1, "lines": 8, "params": 1 } }
}
```

The `catch (walk)` binding shadows the final call, so the function measures cognitive 1. Without the binding the call
adds a recursion point and the value is 2.

The outer loop adds 1, the inner loop adds 2 and the `if` adds 3, for a cognitive count of 6.

<!-- metric-example: recursion -->

```ts
function depth(node: { left?: { left?: object; right?: object }; right?: object } | null): number {
  if (node === null) return 0;
  return 1 + (node.left ? depth(node.left) : 0);
}
```

```json
{
  "id": "recursion",
  "options": { "variant": "extended", "countNullish": true },
  "expected": { "depth": { "cyclomatic": 3, "cognitive": 3, "lines": 4, "params": 1 } }
}
```

The base, the `if` and the ternary make 3. The direct self-call adds one cognitive point.

<!-- metric-example: switch-case -->

```ts
function kindOf(value: string): string {
  switch (value) {
    case "a":
      return "A";
    case "b":
      return "B";
    default:
      return "?";
  }
}
```

```json
{
  "id": "switch-case",
  "options": { "variant": "extended", "countNullish": true },
  "expected": { "kindOf": { "cyclomatic": 3, "cognitive": 1, "lines": 10, "params": 1 } }
}
```

Each `case` adds one cyclomatic point and the `switch` adds one cognitive point.

## References

- McCabe, T. J. (1976). A Complexity Measure. IEEE Transactions on Software Engineering. DOI
  10.1109/TSE.1976.233837.
- Campbell, G. A. (2018). Cognitive Complexity: A new way of measuring understandability. SonarSource.
  https://www.sonarsource.com/resources/cognitive-complexity/
- SonarJS cognitive-complexity rule. https://github.com/SonarSource/SonarJS
- fallow 3.36.0 (schema 12). https://www.npmjs.com/package/fallow
- Savoia, A. CRAP metric. https://www.artima.com/weblogs/viewpost.jsp?thread=215899
- LCOV coverage format. https://github.com/linux-test-project/lcov
- Maintainability index, Visual Studio form.
  https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-maintainability-index-range-and-meaning
- [CK94] Chidamber, S. R., and Kemerer, C. F. (1994). A Metrics Suite for Object Oriented Design. IEEE Transactions on Software
  Engineering 20(6), 476-493. DOI 10.1109/32.295895.
- [BK95] Bieman, J. M., and Kang, B.-K. (1995). Cohesion and reuse in an object-oriented system. Proceedings of the ACM Symposium
  on Software Reusability, 259-262. DOI 10.1145/211782.211856.
- [HM95] Hitz, M., and Montazeri, B. (1995). Measuring coupling and cohesion in object-oriented systems. International Symposium on
  Applied Corporate Computing, Monterrey. No DOI is registered. The CiteSeerX record is 10.1.1.409.4862.
- [LM06] Lanza, M., and Marinescu, R. (2006). Object-Oriented Metrics in Practice. Springer. DOI 10.1007/3-540-39538-5.
