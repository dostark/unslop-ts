# @exaix/lint-rules

Generic Deno lint plugin engine for Exaix. It turns a validated JSON **catalog** of style
rules into a `Deno.lint.Plugin` that runs inside `deno lint`, so the same diagnostics
appear in the editor, on the command line, and in the pre-commit gate.

The generic engine (`src/engine/`, `src/rules/`) knows nothing about Exaix: repository policy
lives in the parent repo at `scripts/config/style_rule_catalog.json`, and the entry point that
loads it is `scripts/config/exaix_lint_plugin.ts`. The `src/exaix/` folder holds the Exaix rule
scripts moved here from `scripts/`.

## Layout

- `src/engine/catalog.ts` — catalog zod schema, `parseCatalog`, `classifyPath`, `ruleSettings`.
- `src/engine/plugin.ts` — `createLintPlugin(name, catalog)`; honours severity, scope, and
  the local `EXAIX_LINT_RULES` selection.
- `src/engine/run_plugin.ts` — `runPlugin` test helper over `Deno.lint.runPlugin`.
- `src/rules/` — generic rule implementations and their option schemas.
- `src/exaix/` — the moved Exaix rule scripts (`check_code_style.ts`, `check_magic_values.ts`);
  they name Exaix policy and read repo paths from the catalog.
- `docs/style_rules.md` — the error-tag reference for the style checker.

## Add a rule

1. Implement `create(context, ctx)` in `src/rules/<rule>.ts` and register it in
   `src/rules/mod.ts` under its catalog id.
1. Add its option schema to `src/rules/rule_options.ts`.
1. Add the catalog entry in the parent repo, with `tags` from the vocabulary.
1. Add named valid and invalid cases in `tests/<rule>_test.ts`.

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
