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
project's README in November 2026.

|                         | `unslop-ts`                                | [anti-slop](https://github.com/dmmulroy/anti-slop) | [deslop](https://github.com/maharshi365/deslop)           | [fallow](https://github.com/fallow-rs/fallow)           | Ordinary linter                      |
| ----------------------- | ------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| Hosts                   | `deno lint`, ESLint, Oxlint                | Oxlint                                             | Oxlint                                                    | its own binary                                          | the host's own rules                 |
| Distribution            | JSR package and a CLI                      | vendored copy, no package                          | npm package                                               | binary                                                  | package                              |
| Per-file rules          | 44                                         | 19 generic plus an Effect group                    | anti-slop plus extras, and some type-aware standard rules | none — analysis only                                    | hundreds, in the plugins you install |
| Whole-repository checks | 8 checks                                   | none                                               | 2 opt-in duplicate checks                                 | one graph: unused code, duplication, cycles, boundaries | plugin-dependent                     |
| Health report           | schema 2 report in the same package        | none                                               | none                                                      | health and hotspots                                     | plugin-dependent                     |
| Suppression model       | a reason is required, in each host dialect | safety comment on assertions                       | safety comment on assertions                              | not a lint host                                         | host-dependent                       |
| Fixer                   | none                                       | some rules autofix                                 | some rules autofix                                        | not applicable                                          | many                                 |

Read the table as a division of labor, not a ranking. `anti-slop` is the best-articulated statement
of the evidence thesis and is deliberately vendored so a team can own it. `deslop` packages that
thesis for Oxlint, adds cross-file duplicate checks, and enables a few type-aware standard rules.
`fallow` reads the whole repository as one graph and is strong exactly where a per-file linter is
blind.

## The niche

`unslop-ts` takes the evidence thesis and makes it portable and governed:

1. **Parity across three hosts.** The same rule id, message, and suppression dialect under
   `deno lint`, ESLint, and Oxlint, with the conformance suite proving it. A repository that mixes
   Deno services and Node packages gets one vocabulary, not three.
2. **Per-file rules and whole-repository checks in one package.** Evidence rules and the graph
   checks that catch dead structure, duplicated declarations, and drifted optionality.
3. **A shipped health report.** Complexity, maintainability, CRAP, churn, duplication, and class
   design, gated by score, with no second service.
4. **Governance.** Presets, scopes, profiles, selection variables, parked opt-in rules with a
   required reason, per-package ceilings, edits that refuse an unsupported control, and a migration
   that never overwrites an input.
5. **Distribution as a package.** No vendoring step and no copy to keep in sync; the CLI installs
   from JSR.

Where the others are stronger, use them. Keep `typescript-eslint` for type-aware rules, Biome or
`deno fmt` for formatting, and `fallow` when you want one graph and its architecture boundaries.
The [comparison page](comparison.md) gives the decision guide by project type and the combination
that avoids double reporting.

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
duplicate type and constant checks. The host parity, the whole-tree engine, the health report, the
suppression dialects, and the configuration model are original to this package.

## Boundaries

The honesty is part of the motivation. The rules are syntactic and per file, with no type
information, so they cannot replace the type checker. There is no fixer, so a finding asks for a
decision rather than applying one. The supported host ranges are in
[Compatibility](../compatibility.md). A tool that claims less and holds that line is easier to trust
than one that implies it can see everything.
