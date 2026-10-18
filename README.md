# @exaix/lint-rules

Generic Deno lint plugin engine. It turns a validated JSON **catalog** of style
rules into a `Deno.lint.Plugin` that runs inside `deno lint`, so the same diagnostics
appear in the editor, on the command line, and in the pre-commit gate.

The engine knows nothing about Exaix. All Exaix lint policy lives in `packages/lint-policy`: the
catalog `catalog.json`, the plugin entry `plugin.ts`, the style checkers, and the rule reference.

## Layout

- `src/engine/catalog.ts` — catalog zod schema, `parseCatalog`, `classifyPath`, `ruleSettings`.
- `src/engine/registry.ts` — `createRuleRegistry` and the `IRulePack` contract. A rule pack groups rules
  and their option schemas under bare rule keys.
- `src/engine/plugin.ts` — `createLintPlugin(name, catalog, { rulePacks })`; honours severity, scope, and
  the local `EXAIX_LINT_RULES` selection. Every catalog rule stays registered with Deno, and an inactive
  rule returns no visitors.
- `src/engine/run_plugin.ts` — `runPlugin` test helper over `Deno.lint.runPlugin`.
- `src/rules/` — generic rule implementations, their option schemas, `TYPESCRIPT_RULE_PACK`, and `DENO_RULE_PACK` (`src/rules/deno/`: rules about
  `deno-lint-ignore` comments and Deno script headers).
- `docs/style_guide.md` — the generic TypeScript style rules.

## Add a rule

1. Implement `create(context, ctx)` in `src/rules/<rule>.ts` and register it in
   `TYPESCRIPT_RULE_PACK` or, for a Deno-specific rule, `DENO_RULE_PACK` (`src/rules/mod.ts`) under its bare rule key.
1. Add its option schema to `TYPESCRIPT_OPTION_SCHEMAS` or `DENO_OPTION_SCHEMAS` in `src/rules/rule_options.ts`.
1. Add the catalog entry `<plugin name>/<rule key>` to the catalog of the project that loads the
   engine, with `tags` from the vocabulary.
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
