# Why unslop-ts exists

`unslop-ts` is not a general-purpose linter and not a formatting tool. It exists because code is now
generated faster than a team can read it, and the dominant failure of generated code is not a syntax
error. It is **low-evidence code**: code that compiles, passes its tests, and states a type without
proving it.

This page states that problem, why ordinary linters and the existing "slop" tools do not close it,
and where `unslop-ts` fits.

## The failure mode

An agent that is asked to make a check pass will usually make the check pass. That produces a small
set of recurring shapes, all of which are cheaper than the correct fix:

| Symptom                               | What it looks like                         | Rule                                 |
| ------------------------------------- | ------------------------------------------ | ------------------------------------ |
| Fabricated evidence                   | `input as object as User`                  | `no-chained-type-assertions`         |
| A contract that says nothing          | `function load(id: string): unknown`       | `no-explicit-unknown`                |
| The dictionary escape hatch           | `type Meta = Record<string, unknown>`      | `no-unsafe-dictionary`               |
| Runtime sniffing instead of parsing   | `if (typeof input === "string")`           | `no-runtime-typeof`                  |
| Borrowed evidence                     | `x as typeof imported.schema`              | `no-typeof-escape`                   |
| An alias that only renames            | `type Request = IncomingRequest`           | `no-pass-through-type-alias`         |
| An unjustified assertion              | `value as UserId` with no reason           | `require-safety-comment`             |
| A conditional empty spread            | `...(on ? { on } : {})`                    | `no-conditional-empty-object-spread` |
| A test that cannot fail               | `assert(await text())`                     | `no-boolean-assert`                  |
| A test that repeats the call          | `expect(f()).toBe(1); expect(f()).toBe(2)` | `no-repeated-assert-call`            |
| A test that restates a constant       | `assert(s.includes("draft"))`              | `no-constant-substring-assert`       |
| A comment that records a past attempt | `// tried this first, did not work`        | `ephemeral-comment`                  |
| A decorative banner                   | `// ===== helpers =====`                   | `decorative-comment`                 |
| Parameter accretion                   | a sixth parameter instead of a shape       | `max-params`                         |
| Restated literals                     | `"draft" \| "live"` repeated inline        | `magic-union-type`                   |

Each row is a decision that pushes work onto the next reader: the compiler is told to trust the
author, or the caller receives a value it must narrow again, or the test asserts that something
happened rather than what happened.

## Why ordinary linters do not cover it

A conventional linter answers "is this well formed?" and "is this a known bug class?". Those are
different questions from "does this code carry evidence for what it claims?".

- ESLint `max-params` counts parameters. It cannot say whether a parameter should have been a shape.
- `typescript-eslint` type-aware rules can prove a promise is floating, but they need the type
  checker and they cost a full program build.
- `deno lint` and Oxlint core rules are fast, and they are syntactic by design.
- None of them reads a repository as one graph, so duplicate types, duplicate constants, and an
  export that nothing imports go unreported.

The rules that do target this failure mode are a narrow, recent family. Each has a real strength,
and each leaves a gap that `unslop-ts` was built to fill. The comparison below reflects each
project's README and documentation in November 2026.

|                         | `unslop-ts`                                | [anti-slop](https://github.com/dmmulroy/anti-slop) | [deslop](https://github.com/maharshi365/deslop)           | [fallow](https://github.com/fallow-rs/fallow)                                                             | Ordinary linter                      |
| ----------------------- | ------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Hosts                   | `deno lint`, ESLint, Oxlint                | Oxlint                                             | Oxlint                                                    | its own CLI, LSP, MCP and editor integrations                                                             | the host's own rules                 |
| Distribution            | JSR package and a CLI                      | vendored copy, no package                          | npm package                                               | one Rust binary via npm or cargo                                                                          | package                              |
| Rule set                | 44                                         | 19 generic plus an Effect group                    | anti-slop plus extras, and some type-aware standard rules | about 70 named rules with `error`/`warn`/`off` severities, per-path overrides, and declarative rule packs | hundreds, in the plugins you install |
| Whole-repository checks | 8 checks                                   | none                                               | 2 opt-in duplicate checks                                 | the core strength: unused code, duplication, cycles, boundaries, and health from one graph                | plugin-dependent                     |
| Health report           | schema 2 report in the same package        | none                                               | none                                                      | a scored report with hotspots and history                                                                 | plugin-dependent                     |
| Suppression model       | a reason is required, in each host dialect | safety comment on assertions                       | safety comment on assertions                              | `fallow-ignore` comments, an opt-in reason check, and stale-suppression detection                         | host-dependent                       |
| Fixer                   | none                                       | some rules autofix                                 | some rules autofix                                        | `fallow fix` removes unused code                                                                          | many                                 |

Read the table as a division of labor, not a ranking. `anti-slop` is the best-articulated statement
of the evidence thesis and is deliberately vendored so a team can own it. `deslop` packages that
thesis for Oxlint, adds cross-file duplicate checks, and enables a few type-aware standard rules.

`fallow` is the strongest whole-repository engine in this group, and it is a rule engine, not only
an analyzer. One Rust binary reads a very large repository as one graph, with about 70 named rules
and per-path severities of its own, framework plugins, an LSP and MCP server, auto-fix, mutation
testing, and a changed-file audit that fails only on the findings a pull request introduces. It is
faster and broader than the whole-tree pass here, and it does not need a TypeScript compiler to
start.

What it does not do is run inside the lint host. There is no `deno lint` or ESLint plugin, so a
finding does not arrive through the editor's existing lint integration, and a team cannot use one
selection variable and one suppression dialect across Deno, Node, and Bun. That remains the gap
this package fills.

## What unslop-ts borrows from fallow

Fallow is the reference implementation for several numbers and for one report in this package. The
borrowings are deliberate, documented, and calibrated rather than paraphrased:

| Surface               | Borrowing                                                                                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unused exports        | `unused-exports --parity` is the fallow-aligned report. It matches each import to the module that defines the export, follows named and star re-exports, and treats entry points, tests, scripts, default exports, and namespaces as public. `--enum-members`, `--class-members`, and `--production` extend it. |
| Health report         | `unslop health` prints a report with fallow-compatible top-level keys and zero-based `col` values. The class-design and large-file sections are unslop extensions outside those keys.                                                                                                                           |
| Complexity            | The `extended` variant counts `?.`, `??`, `&&=`, `\|\|=`, and `??=` as fallow does, and it is the default.                                                                                                                                                                                                      |
| Maintainability index | The density variant is fallow's, named as such.                                                                                                                                                                                                                                                                 |
| Parameters            | The `max-params` default of 7 matches fallow's limit.                                                                                                                                                                                                                                                           |
| Duplication           | The token accounting is documented against fallow: `minTokens: 50` matches about `--min-tokens 25`.                                                                                                                                                                                                             |
| Calibration           | The metrics methodology pins fallow 3.36.0, schema 12, and records the matched populations: 46,137 of 46,138 function rows on each side, 99.998 percent coverage.                                                                                                                                               |

The parity report is the migration path. A team already running `fallow dead-code` can compare the
two reports on the same tree and then keep one gate. The numbers are not claimed to be identical,
and [Metrics methodology](../metrics_methodology.md) records every known difference.

## The niche

`unslop-ts` takes the evidence thesis and makes it portable and governed:

1. **Parity across three hosts.** The same rule id, message, and suppression dialect under
   `deno lint`, ESLint, and Oxlint, with the conformance suite proving it. A repository that mixes
   Deno services and Node packages gets one vocabulary, not three.
2. **Per-file rules and whole-repository checks in one package.** Evidence rules and the graph
   checks that catch dead structure, duplicated declarations, and drifted optionality.
3. **A shipped health report that speaks fallow's numbers.** Complexity, maintainability, CRAP,
   churn, duplication, and class design, gated by score, with the shared keys and formulas
   calibrated against fallow so an existing report stays comparable.
4. **Governance.** Presets, scopes, profiles, selection variables, parked opt-in rules with a
   required reason, per-package ceilings, edits that refuse an unsupported control, and a migration
   that never overwrites an input.
5. **Distribution as a package.** No vendoring step and no copy to keep in sync; the CLI installs
   from JSR.

Where the others are stronger, use them. Keep `typescript-eslint` for type-aware rules and Biome or
`deno fmt` for formatting. Keep `fallow` when you want the fastest whole-repository pass,
framework-aware dead-code detection, styling drift, auto-fix, mutation testing, an LSP or MCP
server, or a changed-file audit; this package complements it rather than replacing it, and the
parity report is the bridge between the two. The [comparison page](comparison.md) gives the decision
guide by project type and the combination that avoids double reporting.

## What slop is not

Slop is a property of the code, not of its author. A human-written file can fabricate evidence, and
an agent-written file can be clean. Every rule here is authorship-neutral: it reports a shape and a
location, never a commit or a tool. That is deliberate. A rule that guesses who wrote the code
cannot be reviewed, and a team that adopts one starts arguing about provenance instead of evidence.

## Lineage and credit

The evidence rules are not invented here. The rule ideas come from
[anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, commit
`13909c9e07590f5a85d93c62712259fe14a883f7`) and its fork
[deslop](https://github.com/maharshi365/deslop). No upstream source code is copied: each rule is
reimplemented against the Deno ESTree, ported test cases keep their upstream names and MIT notice,
and any skipped or changed case carries its reason in the test file. That lineage covers the
type-evidence group, the assertion and safety-comment rules, the test-assertion rules, and the
duplicate type and constant checks. The health and complexity methodology follows fallow 3.36.0
(schema 12): the density maintainability index, the `extended` cyclomatic variant, the parameter
limit, the parity unused-export report, and the fallow-compatible report keys. The calibration and
every known difference are in [Metrics methodology](../metrics_methodology.md). The host parity, the
whole-tree engine, the suppression dialects, and the configuration model are original to this
package.

## Boundaries

The honesty is part of the motivation. The rules are syntactic and per file, with no type
information, so they cannot replace the type checker. There is no fixer, so a finding asks for a
decision rather than applying one. The supported host ranges are in
[Compatibility](../compatibility.md). A tool that claims less and holds that line is easier to trust
than one that implies it can see everything.
