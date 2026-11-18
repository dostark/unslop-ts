# Architecture

## Pipeline

```text
descriptor → compileConfig → catalog → rule registry → host adapter → diagnostics
```

1. `compileConfig` validates the version 2 configuration against the descriptor's packs.
1. The compiled catalog carries each rule's level, scope, options, and docs anchor.
1. The registry resolves rule ids to the implementations in the packs.
1. A host adapter (`deno.ts`, `eslint.ts`, or the whole-tree entry) runs the rules.
1. A diagnostic keeps the bare message; the host adds the plugin prefix and the docs link.

The root export imports only `zod`. Deno globals live in `deno.ts`, so the ESLint and Oxlint entries
never import them.

## Trust model

Local entries and their imports are trusted executable project code. The CLI is not a sandbox. It
accepts local paths and `file:` URLs only, stores no credentials, and reads project source,
configuration, lockfiles, LCOV files, and git history when a history flag is used.

## Development

`deno task test`, `deno task lint`, `deno task check`, and `deno fmt --check` run in this repository
alone. The engine tests import the package by relative path. `deno task unslop` runs the CLI from the
checkout; add `:write` for edits, and use `unslop:report` for `report`.

The conformance data in `../../tests/cases/conformance.json` is the single source of the named cases. A new
rule needs one entry before its host tests can pass. The host suites live in `tests_node/` and the
shared runners in `tests/hosts/`; they run through npm or Bun, as the matrix above shows.

### One source of truth

The packs and their metadata are shared. A version 2 configuration compiles to the Deno catalog, and
the ESLint presets and Oxlint fragments are derived from the same packs. The generator and presets
never change a foreign diagnostic; the additivity suite checks that on all three hosts.

The invariants hold for every host:

1. Adding the plugin leaves every foreign diagnostic unchanged.
1. The plugin reports only `unslop/...` ids.
1. A preset sets no parser and no foreign rule.
1. Plugin rules are `error` or `off`; `warn` becomes `error` in `deno lint`.
1. Suppression follows the dialect the host understands.

## Analysis boundaries

Plugin rules run per file with no type information; imported aliases and cross-file signatures are not
resolved. Only syntactic shapes in the linted file are seen.

## Credits and upstream

Rule ideas come from [anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, commit
`13909c9e07590f5a85d93c62712259fe14a883f7`) and its fork
[deslop](https://github.com/maharshi365/deslop). No upstream source code is copied; the rules are
reimplemented on the Deno ESTree. Ported test cases keep their upstream names and carry the MIT notice.
A skipped or changed upstream case carries its reason next to the case in the test file.

MIT notice (anti-slop): Copyright (c) its authors, MIT License. The type environment and the
type-safety rules are reimplementations; the licence text is not copied here.

## Layout

- `src/engine/` — catalog parsing, path classification, the rule registry, the plugin factory, and the
  test runner helper.
- `src/rules/` — rule implementations, option schemas, metadata, and the two packs. `src/rules/deno/`
  holds the Deno pack. Every pack entry carries the rule's `meta`.
- `src/rules/whole_tree/` — the nine whole-tree checks, their option schemas, and `WHOLE_TREE_CHECKS`
  descriptors (metadata, controls, host command). The Deno-only entry `@dostark/unslop-ts/whole-tree`
  exports the duplicate, duplicate-code, constant-restatement, optional-parameter, unused-export, and
  magic-literal checkers so a host script can call them in-process.
- `src/config/` — the version 2 schema, descriptor contracts, pure compiler and presets, JSON Schema,
  migration and projection, project factory, and the pure edit functions.
- `src/cli/` — the CLI dispatcher, local module loader, selection, read and write routes, migration
  command, safe writer, diff, and output. The older `rule_report.ts`, `whole_tree.ts`, and
  `rule_ceiling.ts` entry points remain for one-rule reports and whole-tree hosts.
- `examples/` — a descriptor, a version 2 configuration, and a plugin entry for any Deno project.
- `../style_guide.md` — the generic TypeScript style rules and their metadata notes.
