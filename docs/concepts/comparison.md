# Comparison with other linters

This page answers two questions: where `unslop-ts` overlaps an ordinary linter, and why a project
would choose it anyway. The problem it was built for is in
[Why unslop-ts exists](motivation.md). The rule ids are in
[Rules and presets](../reference/rules.md); the host matrix is in
[Hosts and runtimes](../how-to/hosts.md).

## Short answer

Choose `unslop-ts` when **one rule set must behave the same under `deno lint`, ESLint, and Oxlint**,
and when you want per-file rules, whole-tree checks, and a health report from one package. Keep the
host's own tooling for formatting, type checking, framework rules, and type-aware checks.

`unslop-ts` is not a general replacement for ESLint, `typescript-eslint`, Biome, or Sonar.

## What the package ships

| Surface                 | Count                                                             | Where                                  |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| TypeScript plugin rules | 40                                                                | `src/rules/`                           |
| Deno plugin rules       | 4                                                                 | `src/rules/deno/`                      |
| Whole-tree checks       | 8                                                                 | `../../src/rules/whole_tree/checks.ts` |
| Presets                 | 2 (`unslop:recommended`, `unslop:strict`) plus per-host fragments | `../../src/config/presets.ts`          |

That is 44 plugin rules plus 8 checks. A large ESLint installation runs several hundred rules, so
the overlap below is a named subset, not a claim of parity with the whole ecosystem.

## Declared overlaps: 16 rules

A rule records its ecosystem overlap in `IPluginRule.overlaps`. The generated table in
[Rules and presets](../reference/rules.md#overlaps) is authoritative; this table groups the same
sixteen entries by area.

| Area        | unslop rule                  | Overlapping rule                                  | Kind          |
| ----------- | ---------------------------- | ------------------------------------------------- | ------------- |
| Type safety | `no-explicit-unknown`        | `typescript-eslint/no-explicit-any`               | related       |
| Type safety | `no-unsafe-dictionary`       | `typescript-eslint/no-explicit-any`               | related       |
| Type safety | `no-typeof-escape`           | `typescript-eslint/no-explicit-any`               | related       |
| Type safety | `no-chained-type-assertions` | `typescript-eslint/no-unnecessary-type-assertion` | related       |
| Type safety | `no-pass-through-type-alias` | `typescript-eslint/no-unnecessary-type-assertion` | related       |
| Type safety | `ts-suppression-pragmas`     | `typescript-eslint/ban-ts-comment`                | related       |
| Runtime     | `no-runtime-typeof`          | ESLint `valid-typeof`                             | related       |
| Complexity  | `max-cyclomatic-complexity`  | ESLint `complexity`                               | related       |
| Complexity  | `max-cognitive-complexity`   | `sonarjs/cognitive-complexity`                    | related       |
| Complexity  | `max-function-lines`         | ESLint `max-lines-per-function`                   | related       |
| Complexity  | `max-file-lines`             | ESLint `max-lines`                                | related       |
| Complexity  | `max-params`                 | ESLint `max-params`                               | related       |
| Size        | `max-class-size`             | ESLint `max-classes-per-file`                     | related       |
| Naming      | `exported-interface-naming`  | `typescript-eslint/naming-convention`             | related       |
| Suppression | `ignore-needs-reason`        | `eslint-comments/require-description`             | **duplicate** |
| Suppression | `no-forbidden-lint-ignore`   | `eslint-comments/no-unlimited-disable`            | related       |

Only `ignore-needs-reason` is a true duplicate. On the ESLint host, the
`typescript-eslint-compat` preset turns it off; the other fifteen are `related`, so both rules may
run and the unslop rule is the narrower one.

## Functional overlaps the metadata does not record

These rules do the same job as common rules under a different name, so they are not declared as
overlaps:

- **Module structure and imports.** `barrel-only-reexports`, `dynamic-import`, `import-boundaries`,
  `import-inside-statement`, `import-placement`, `inline-type-import`, `prefer-named-imports`, and
  `re-export-imported` cover ground held by `eslint-plugin-import` and the `deno lint` import rules.
- **Test quality.** `no-boolean-assert`, `no-constant-substring-assert`, and
  `no-repeated-assert-call` overlap assertion-specificity rules from Jest and Vitest plugins.
- **Comments.** `decorative-comment`, `ephemeral-comment`, and `long-comment` overlap custom
  comment rules. `ephemeral-filename` has no common equivalent.
- **Interfaces.** `exported-interface-placement` and `no-interface-rename-on-import` overlap
  naming and import-order rules.
- **Magic values.** `magic-union-type` overlaps SonarJS `no-magic-numbers` and
  `no-duplicate-string`, but it is aware of the type shape.

## Whole-tree checks and standalone tools

The eight checks in [Whole-tree checks](../reference/whole-tree-checks.md) replace tools that are
usually installed separately:

| Check                                                                            | Usual standalone tool                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `unused-exports`, `unused-files`                                                 | `knip`, `ts-prune`                                                                          |
| `duplicate-code`                                                                 | `jscpd`                                                                                     |
| `duplicate-type`, `duplicate-constant`, `magic-literals`, `constant-restatement` | SonarJS rules, project-wide instead of per file                                             |
| `optional-params`                                                                | No common single-rule equivalent; it compares a parameter's optionality with its call sites |

The health report's duplication _signal_ can use `jscpd` when it is installed, but the
`duplicate-code` check makes its own comparison.

## Health report and code-quality platforms

`unslop health` computes cyclomatic and cognitive complexity, the maintainability index, CRAP,
churn hotspots, duplication, and class design (WMC, TCC, ATFD, CBO, RFC, and the God, Data Class,
and Feature Envy findings). That overlaps SonarQube, SonarJS, fallow, and Code Climate. The
per-package ceilings from `unslop:report`/`rule_ceiling` overlap budget tools such as `size-limit`.

The differences are operational: the report is schema 2 with a formula version, gates through
`--min-score`, takes an LCOV file for CRAP, and ships in the same package as the rules. See
[Report schema](../reference/report-schema.md).

## What unslop-ts does not do

- **Formatting.** Use `deno fmt`, Prettier, or Biome.
- **Type checking.** Use `tsc` or `deno check`.
- **Type-aware lint rules.** Plugin rules run per file with no type information; imported aliases
  and cross-file signatures are not resolved. See
  [Architecture](../concepts/architecture.md#analysis-boundaries).
- **Autofixes.** The rule API has no fixer; a finding names the problem and the fix is manual.
- **Framework rules.** No React, Vue, Svelte, or accessibility rules.
- **Security scanning.** No injection, secret, or dependency-vulnerability rules.
- **Dependency and license auditing.** Use `depcheck` and a license scanner.
- **JavaScript files.** On ESLint, the adapter reports on TypeScript files only; `.js`, `.jsx`,
  `.mjs`, and `.cjs` files produce no unslop findings.

## Why prefer unslop-ts

### 1. One rule set across three hosts

The same rule ids, messages, and suppression model run under `deno lint`, ESLint, and Oxlint. The
conformance suite in `../../tests/cases/conformance.json` runs the same case on every host, so parity is a
tested property. An ordinary setup needs a separate configuration per host, each with its own rule
names and ignore dialect.

### 2. Per-file rules and project-wide checks in one tool

Unused exports, unused files, duplicate code, duplicate types and constants, repeated literals, and
optional-parameter drift usually take three or four tools. Here they are one configuration, one
report, and one CI step.

### 3. A shipped health report

The same package that reports a finding also measures complexity, maintainability, CRAP, churn,
duplication, and class design, and can gate on the score. No second service is required.

### 4. A controlled rule budget

Beyond on and off, a project can use presets, scopes (`prod`, `test`, `all`), path classification,
profiles, selection variables, parked opt-in rules with a required reason, per-package ceilings, safe
configuration edits that refuse an unsupported control, and a version 1 to 2 migration that never
overwrites an input. See [Configuration](../reference/config.md).

### 5. Suppressions need a reason

`ignore-needs-reason` and `no-forbidden-lint-ignore` enforce a reason after `--` in each host's
dialect. A suppression without one is itself a finding.

### 6. Stated boundaries

The documentation says the rules are syntactic and per file. A predictable rule that does not
pretend to type-check is easier to trust than a type-aware rule running without the type checker.

## Where another linter is the better choice

| Need                                                                         | Better choice                                 | Reason                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Type-aware rules (floating promises, unsafe assignment, exhaustive switches) | `typescript-eslint` with type-checked configs | unslop rules have no type information                     |
| Framework, accessibility, or security rules                                  | ESLint plugins                                | the package ships 44 rules, not hundreds                  |
| Autofix on save                                                              | ESLint or Biome                               | the unslop rule API has no fixer                          |
| Formatting                                                                   | `deno fmt`, Prettier, Biome                   | unslop-ts is a linter                                     |
| JavaScript-only project                                                      | ESLint                                        | the adapter reports TypeScript files only                 |
| Dependency and license audit                                                 | `depcheck`, license scanners                  | not covered                                               |
| Long-term stability                                                          | ESLint, `typescript-eslint`                   | the package is `0.1.1` and Oxlint support is experimental |
| Oxlint-native team                                                           | Oxlint's own rules                            | the Oxlint integration is pinned and labeled experimental |

## Decision guide by project type

- **Deno-first repository that also runs ESLint or Oxlint.** Use `unslop-ts` as the shared rule
  layer. Keep `deno fmt` for formatting and `deno check` for types. This is the case it was built
  for.
- **Node or ESLint-only repository.** Start from `typescript-eslint` and the plugins you need.
  `unslop-ts` adds parity and whole-tree checks, but it reports TypeScript files and its rule set is
  narrower, so it does not replace a full ESLint setup.
- **Codebase with dead-code and duplication problems.** `unslop-ts` replaces `knip`, `jscpd`, and a
  metrics tool with one gate. That is the clearest operational win.
- **Team that needs one finding vocabulary across runtimes.** This is the strongest reason to
  prefer it: no other tool ships one conformance-tested rule set for all three hosts.

## The practical combination

1. Run `unslop-ts` for the cross-host rules, the whole-tree checks, and the health report.
2. Keep the host's own tooling for formatting, type checking, framework rules, and type-aware
   checks.
3. On ESLint, spread `typescript-eslint-compat` last so the one duplicate does not report twice.
4. Leave the fifteen `related` overlaps running; the unslop rule is narrower and names its reason.

## Verify the facts

The counts and the overlap set are in the source, not in this page alone:

```sh
deno task unslop rules list
deno task unslop rules list --select=tag:comments
deno task unslop presets show unslop:recommended
```

`unslop rules list --format=json` prints each rule's category, controls, and host modes. The
committed expectation file `../../tests/cases/overlap_expectations.json` records who reports a case when
the host's own rule also fires.
