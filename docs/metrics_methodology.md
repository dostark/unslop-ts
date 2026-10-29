# Metrics methodology

This document defines every metric, formula and threshold that the unslop-ts health report uses. It gives the
external source of each method and names the engine-policy decision where the engine chooses its own value.

## Measurement units

A unit is one executable function: a function declaration, a function expression, an arrow function, a class
method, an object method, a constructor or a getter or setter. The engine finds units with the pinned Babel parser
and measures each unit over its own range. A nested function is a separate unit, and its decisions never count
toward its ancestors. A unit start excludes a declared method key, so every host reports the same start.

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
one. A logical run is a maximal chain of one operator. `countNullish` controls whether a `??` run counts.

### Differences from the paper, SonarJS and fallow

- The published SonarSource white paper counts each logical operator of a chain only when the operator changes;
  the engine counts one per run, so `a && b && c` adds one.
- SonarJS increments nesting for `switch` case bodies and for ternary branches; the engine does the same.
- fallow 3.36.0 counts `??` in its cognitive metric and applies its own nesting rules. The calibration below
  records the measured differences rather than a claim of exact parity.
- The engine has no framework-aware or macro-expanded view. It measures syntax only.

## Lines of code and parameters

`lines` is the number of source lines of one unit, counted from the first to the last line of its range, with the
unit start normalized as described above. `params` is the number of declared parameters; a destructured pattern
counts as one parameter.

## Maintainability index

The engine uses the classic maintainability index (MI) form:

`MI = 171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)`

`HV` is the Halstead volume, `CC` is the classic cyclomatic count of the file and `LOC` is the file length. The
engine also reports the scaled `MI` in the 0 to 100 range, which multiplies the raw value by `100 / 171` and
clamps it to the range. This is an engine-policy decision that follows the common Visual Studio form of the
metric; the raw value is always reported next to it.

## CRAP and coverage

The change-risk anti-pattern score (CRAP) is:

`CRAP = CC^2 * (1 - cov / 100)^3 + CC`

`CC` is the unit's cyclomatic count and `cov` is the line coverage of the unit in percent. Bands are below 30,
below 50, below 100 and 100 or more, in the order that the report prints them. When no measured coverage covers
a unit, the engine uses a fallback: 85 percent for a directly reachable unit, 40 percent for an indirectly
reachable unit and 0 percent for an unreachable unit. This is an engine-policy decision (Savoia's CRAP model
does not define unreachable code).

Coverage comes from an LCOV file. Each record is bounded to 1 MiB, each input to 256 MiB and the source file to
16 MiB. The coverage manifest records the snapshot that produced the numbers, so a run can be audited later.

## History and hotspots

Churn comes from the Git history of each file. The engine runs the fixed argument list
`git log --no-renames --no-merges -z --numstat` and applies a 90-day half-life to weigh recent changes. A hotspot
is a file whose churn and complexity both place it above the report thresholds. The engine accepts `--since` as
a day, month or ISO date and `--min-commits` as the history floor.

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

The report supports nine signals and marks two as `not_measured`: line coverage when no LCOV file is given and
duplication when the local duplicate runner is unavailable. Grades are A at 85 or more, B at 70, C at 55 and D
at 40. A partial report has no grade.

## Thresholds and gates

The rule gate defaults to 15 cyclomatic, 15 cognitive and 60 lines per function. The phase refactoring tranche
targets 20 cyclomatic and 30 cognitive. The compiled workspace ceilings are measured counts, and the
`check:complexity` task runs three single-rule invocations against them. A ceiling is lowered only to a measured
count and never raised.

## Calibration record

The frozen calibration (2026-10-29) used the extended variant with `countNullish: true`. The pinned signed
fallow 3.36.0 (schema 12) run matched 46,107 of 46,108 functions over the 3,195 common files of the two file
populations (3,216 fallow, 3,201 core): coverage 99.998 percent each, exact cyclomatic 97.82 percent and exact
cognitive 99.77 percent. One fallow row and one core row stay unmatched in the exactl flow-command test
(one anonymous method, one column apart). 108 fallow rows sit
outside the health snapshot because the snapshot does not follow the symlinked portal-fixture files, and 2,626
core rows sit in files that fallow did not report. Parse failures were zero.

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
