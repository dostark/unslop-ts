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

The rule gate defaults to 15 cyclomatic, 15 cognitive and 60 lines per function. The phase refactoring tranche
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
