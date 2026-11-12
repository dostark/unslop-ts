# Report schema

## Health report

`unslop health` measures the configured project scope and prints a schema 2 report using formula `unslop-health-v2`.

```bash
deno run --allow-read --allow-env --allow-run=git,node src/cli/unslop.ts health --format=json
```

The command accepts `--root`, `--descriptor`, `--plugin`, `--format=text|json`, `--max-cyclomatic`,
`--max-cognitive`, `--max-lines`, `--max-crap`, `--coverage`, `--variant=classic|extended`, `--count-nullish`,
`--top`, `--sort`, `--since`, `--min-commits`, `--min-score`, `--classes` and `--top-classes`.

- **Permissions:** the command reads the project and the environment, and it runs `git` and `node`. The
  duplication signal needs the configured `jscpd` release in local `node_modules` or the pinned Deno npm
  installation under `node_modules/.deno`. Prepare that package once with `deno cache
  npm:jscpd@5.4.2/package.json` when using the default release. A missing runner makes duplication
  `unavailable`; a run without `--coverage` reports coverage source `none` and estimates CRAP.
- **Values:** a flag value is checked before any measurement. `--count-nullish` is exactly `true` or `false`,
  the numeric flags are decimal safe integers or finite decimals, and `--since` takes a safe duration or a strict
  ISO date. A malformed value exits `2` with no report.
- **Coverage:** `--coverage` takes an LCOV file inside the project root. Without it, CRAP uses the documented
  reachability fallbacks. A malformed LCOV record rejects the input. The report calls the coverage revision
  `verified` only when an adjacent `.manifest.json` names every covered file with a matching SHA-256. An empty or
  partial manifest stays `unverified`, and a mismatched one is rejected.
- **Graph:** the import graph resolves the import maps of the root and the workspace members, including
  `deno.jsonc` and workspace package exports. An entry that leaves the project root is ignored. Imports of
  configured excluded source files and JSON assets are outside the measured graph and have separate counts from
  genuinely external imports. A
  genuinely unresolved import or nonliteral dynamic import marks the graph incomplete, so its score signals
  become unavailable. A complete graph is complete within the configured scan scope.
- **File complexity:** `module_cyclomatic` counts top-level decisions outside function bodies. File
  `cyclomatic` adds this value to the sum of function values; the function population stays unchanged.
- **History:** `--since` accepts a day count, a month count or an ISO date, and `--min-commits` sets the
  history floor. Git and the duplicate runner run under a deadline and byte limits.
- **Score:** the project score starts at 100 and subtracts one capped penalty per signal. Grades are A at 85,
  B at 70, C at 55 and D at 40. Nine supported signals enter the formula. Unused dependencies and prop drilling
  are `not_measured`, carry no penalty, and do not make the supported-signal score partial. A partial report prints
  no grade. Without `--min-score`, the score is advisory and does not affect the exit code. With `--min-score`,
  a partial score or a score below the threshold exits 1; `--min-score=0` gates completeness only.

- **Class design:** the report adds four top-level keys that the fallow-compatible keys do not read, and the text view prints
  them after the score under the label `unslop extension`. `class_scores` holds the metrics of every class, `design_findings`
  holds the God Class, Data Class and Feature Envy matches with the values that made them match, and `class_thresholds` holds
  the sourced default limits beside the limits that this project's classes derive. `--classes` prints only this section, and
  `--top-classes` limits the text rows. Each class carries a `precision` label: `typed` for a class that both the Babel tree
  and the TypeScript compiler tree report, including named local declarations and named expressions. `class_analysis` records
  total and typed class counts and every unjoined site. Anonymous classes retain `syntactic` values, and unavailable method
  analysis is explicit in text and JSON. The health score and its formula do not change.
- **Large files:** when the catalog enables the `max-file-lines` rule, the report adds `large_files`, the files above the
  soft limit `softMax` or the hard limit `max`, largest first, each with its `limit` level. Only the files that the rule
  would lint appear, by its scope, `include` and `exclude`. The text view prints them as advice. The lint rule reports only
  the hard limit and counts physical lines.
- **Class-size rule:** the `max-class-size` rule has a `strategy` option. `god-class`, the default, reports a class when WMC,
  TCC and ATFD all cross their limits. `legacy-score` keeps the earlier weighted size score, and only it reads `minClassLines`
  and `threshold`. God Class detection visits declarations and named expressions; the legacy strategy retains its
  declaration-only behavior. Private names, lexical `this`, actual call edges and public constructor properties retain
  their metric meanings across both parser hosts. The rule reads one file, so its ATFD and CBO are `syntactic`. The limits and their sources are in
  [../metrics_methodology.md](../metrics_methodology.md).

The `./metrics` entry exports the measurement API: `createMeasurementContext`, `functionUnits`,
`measureFunction`, `METRIC_CONTRIBUTION_KINDS` and the metric types. The `./report` entry exports the report
schemas and the collection functions. The formulas, the construct tables and the calibration record are in
[../metrics_methodology.md](../metrics_methodology.md).

**Compatibility:** the engine default variant is `extended` with `countNullish: true`. A consumer that pins
`variant: "classic"` keeps the legacy counts. A consumer can pin classic during its transition and remove the
pin at its measured cutover.

## Reports and consumer adoption

`unslop report` runs the real lint host and reports per-rule observed coverage, callback outcomes,
selected and foreign findings, and explicit unavailable coverage. It accepts `--format=table` (the
default), `json`, `markdown`, or `sarif`; the SARIF output validates against the vendored OASIS 2.1.0
schema. Tracing is opt-in through the plugin trace environment variable. Source fingerprints come
from captured operand bytes, and a changed diagnosed source makes the report failed. The report uses
absolute operands, supports `--` for a leading-dash path, and refuses `--out` unless the write task is
used. Authored `limits` is optional: omission keeps the owner limit, and an empty string is preserved
through migration and edits.
