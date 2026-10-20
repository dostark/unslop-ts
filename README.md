# @dostark/unslop-ts

A Deno lint plugin engine for TypeScript projects. It turns a validated JSON **catalog** of style
rules into a `Deno.lint.Plugin` that runs inside `deno lint`, so the same diagnostics appear in the
editor, on the command line, and in a pre-commit gate.

The engine ships two rule packs. `TYPESCRIPT_RULE_PACK` holds 15 rules for type evidence, test
assertions, and size limits. `DENO_RULE_PACK` holds three rules about `deno-lint-ignore` comments and
Deno script headers. A project can add its own packs, so project-specific rules stay in the project.

## Use in a Deno project

1. Write a catalog. `examples/catalog.json` is a small one. Each rule id has the form
   `<plugin name>/<rule key>`, and each rule has an `engine`, a `severity`, a `scope`, and `tags` from the
   catalog's `tagVocabulary`.
1. Write the plugin entry. `examples/lint_plugin.ts` builds a registry from the rule packs, parses the
   catalog against it, and default-exports `createLintPlugin(name, catalog, { rulePacks })`.
1. Register the entry in the project's `deno.json` with `"lint": { "plugins": ["./lint_plugin.ts"] }`,
   and run `deno lint`.
1. To run a subset locally, export `<NAME>_LINT_RULES`, where `<NAME>` is the plugin name in upper
   case (`demo` gives `DEMO_LINT_RULES`). The value is a list of rule ids or `tag:<tag>` selectors.
   `selectionEnvName(name)` returns the variable name.

## Working with deno lint

`unslop-ts` adds to `deno lint` and does not replace it. These rules hold for every pack:

- **No duplicate diagnostics.** No rule reports what a built-in rule already reports.
  `tests/deno_builtin_overlap_test.ts` reads the built-in list of the installed Deno and fails when a
  pack rule key equals a built-in code or a built-in fires on a case that the test does not declare.
  `no-typeof-escape` reports only an `as typeof` cast, and the built-in `no-explicit-any` reports `any`.
  `ban-ts-comment` covers `@ts-ignore` pragmas.
- **Deno's suppression is the only suppression.** Use `// deno-lint-ignore <plugin>/<rule> -- <reason>`.
  The built-in `ban-unused-ignore` reports a stale ignore. Rules that read ignore comments report at the
  comment.
- **Every catalog rule is known to Deno.** A rule that is off, not selected, or out of scope stays
  registered and reports nothing, so its ignore comments are never `ban-unknown-rule-code`.
- **Deno's rule configuration wins.** `lint.rules.exclude` and `--rules-exclude` turn a plugin rule off.
  The catalog and `<NAME>_LINT_RULES` only narrow the run further.
- **Built-in configuration stays yours.** `unslop-ts` never writes or presets `lint.rules`. Choose the
  built-ins that fit your project, for example `no-explicit-any` with `no-typeof-escape`,
  `ban-ts-comment`, and `ban-unused-ignore`, which are in the recommended set.

## Layout

- `src/engine/catalog.ts` — catalog zod schema, `parseCatalog`, `classifyPath`, `ruleSettings`.
- `src/engine/registry.ts` — `createRuleRegistry` and the `IRulePack` contract. A rule pack groups rules
  and their option schemas under bare rule keys.
- `src/engine/plugin.ts` — `createLintPlugin(name, catalog, { rulePacks })` and `selectionEnvName`.
- `src/engine/run_plugin.ts` — `runPlugin` test helper over `Deno.lint.runPlugin`.
- `src/rules/` — rule implementations, their option schemas, and the two packs. `src/rules/deno/` holds
  the Deno pack.
- `src/rules/whole_tree/` — checks that need the whole tree. The Deno-only entry `@dostark/unslop-ts/whole-tree`
  exports `findDuplicateTypes`, `findDuplicateConstants`, and `detectMagicLiterals` with their option schemas,
  so a host script can call them in-process.
- `src/cli/` — `rule_report.ts` ranks one rule's findings, `whole_tree.ts` runs the whole-tree rules with
  settings from `--catalog=<path>` (`duplicate-type` and `duplicate-constant` read the `options`, `include`, and
  `scope` of their `rules` entry, and `magic-literals` reads `wholeTree.magicLiterals`), and `rule_ceiling.ts`
  holds per-package finding counts.
- `examples/` — a catalog and a plugin entry for any Deno project.
- `docs/style_guide.md` — the generic TypeScript style rules.

## Add a rule

1. Implement `create(context, ctx)` in `src/rules/<rule>.ts` and register it in `TYPESCRIPT_RULE_PACK`
   or, for a Deno-specific rule, `DENO_RULE_PACK` (`src/rules/mod.ts`) under its bare rule key.
1. Add its option schema to `TYPESCRIPT_OPTION_SCHEMAS` or `DENO_OPTION_SCHEMAS` in
   `src/rules/rule_options.ts`.
1. Add the catalog entry `<plugin name>/<rule key>` to the catalog of the project that loads the engine.
1. Add named valid and invalid cases in `tests/<rule>_test.ts`, and a case in
   `tests/deno_builtin_overlap_test.ts`.

## Development

`deno task test`, `deno task lint`, `deno task check`, and `deno task fmt --check` run in this
repository alone. The engine tests import the package by relative path.

## Analysis boundaries

Plugin rules run per file with no type information; imported aliases and cross-file
signatures are not resolved. Only syntactic shapes in the linted file are seen.

## Credits and upstream

Rule ideas come from [anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, commit
`13909c9e07590f5a85d93c62712259fe14a883f7`) and its fork
[deslop](https://github.com/maharshi365/deslop). No upstream source code is copied; the
rules are reimplemented on the Deno ESTree. Ported test cases keep their upstream names and
carry the MIT notice. A skipped or changed upstream case carries its reason next to the
case in the test file.

MIT notice (anti-slop): Copyright (c) its authors, MIT License. The type environment and
the type-safety rules are reimplementations; the licence text is not copied here.
