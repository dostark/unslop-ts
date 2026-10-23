# unslop-ts

A TypeScript lint rule engine that runs the same rules under `deno lint`, ESLint 9 and later, and
Oxlint, on Deno, Node.js, and Bun. The rule set, the messages, and the suppression model are shared,
so a finding means the same thing in every host.

For `deno lint`, the engine compiles a validated version 2 configuration into a `Deno.lint.Plugin`
that runs inside `deno lint`. For ESLint and Oxlint, it exports a flat-config plugin and presets that
add the same rules to an existing configuration without changing a foreign diagnostic. A small CLI
lists and explains rules, edits supported settings, migrates a version 1 catalog, and exports a host
fragment.

The engine ships two rule packs. `TYPESCRIPT_RULE_PACK` holds 35 rules for type evidence, imports,
module layout, comments, interface conventions, test assertions, and size limits. `DENO_RULE_PACK`
holds 4 rules about `deno-lint-ignore` comments and Deno script headers. Every rule declares its
description, category, guide anchor, preset membership, and overlaps in code. A project can add its
own rule packs and script checks, so project-specific rules stay in the project.

## Use in a Deno project

1. Write a version 2 configuration. `examples/unslop.config.json` is a small one. It names the plugin,
   extends a preset, and sets rule overrides. Rule ids are `<plugin name>/<rule key>` for plugin rules
   and bare ids for whole-tree checks and consumer scripts.
1. Write the project descriptor. `examples/unslop.project.ts` exports the plugin name, the rule packs,
   the configuration location, and any consumer script or whole-tree host descriptors. It reads no
   configuration file, so it stays importable when the configuration is absent or invalid.
1. Write the plugin entry. `examples/lint_plugin.ts` imports `createUnslopProject` from
   `@dostark/unslop-ts/deno`, compiles the configuration with
   `createUnslopProject({ descriptor, config })`, and default-exports `project.plugin`.
1. Register the entry in the project's `deno.json` with `"lint": { "plugins": ["./examples/lint_plugin.ts"] }`,
   and run `deno lint`.
1. To run a subset locally, export `<NAME>_LINT_RULES`, where `<NAME>` is the plugin name in upper case
   (`demo` gives `DEMO_LINT_RULES`). The value is a list of full ids, unambiguous bare keys, or
   `tag:<tag>` selectors. The CLI `--select` and `--profile` options replace that variable for one call.
   `selectionEnvName(name)` returns the variable name.

## Hosts

| Host                             | Entry                                                                 | Runtime      | Status       |
| -------------------------------- | --------------------------------------------------------------------- | ------------ | ------------ |
| `deno lint`                      | `@dostark/unslop-ts/deno` in `lint.plugins`, or `dist/deno_plugin.js` | Deno         | supported    |
| ESLint 9.0.0 and later, below 11 | `@dostark/unslop-ts/eslint` as a plugin                               | Node.js, Bun | supported    |
| Oxlint 1.88                      | the same ESLint plugin through `jsPlugins`                            | Node.js      | experimental |

The same rule modules run on every host. The conformance suite drives one case table
(`tests/cases/conformance.json`) through `deno lint`, ESLint on Node.js, ESLint on Bun, and Oxlint on
Node.js, so parity is a property of the code, not of a particular editor.

### What parity covers

- The rule id, message text, line, and column are identical. ESLint and Oxlint append `Hint:` and the
  hint after the message; `deno lint` keeps the hint in its own field.
- The option schema is the same. An invalid option fails the host with a named error instead of
  silently changing behavior.
- Both comment-aware rules read the Deno, ESLint, and Oxlint suppression dialects; each host reads its
  own dialect by default.
- Adding a preset or a generated fragment changes no foreign diagnostic. The additivity suite runs on
  Deno, ESLint, and Oxlint.
- A rule that declares a `duplicate` overlap is turned off by `typescript-eslint-compat`; the README
  overlap table is generated from the same metadata.

### Verification matrix

| Guarantee                                                            | Test                                                                             | Hosts                                      | Command                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| 39 rules report the same result                                      | `tests_node/conformance.test.mjs`, `tests/conformance_test.ts`                   | ESLint/Node, ESLint/Bun, Oxlint/Node, Deno | `npm --prefix hosts run test:node`, `bun run --cwd hosts test:bun`, `deno task test` |
| Adapter works at the supported ESLint range                          | `tests_node/eslint_adapter.test.mjs`                                             | ESLint 9.0.0, 9.39.5, 10.13.0              | `npm --prefix hosts run test:node`                                                   |
| Presets and fragments are additive                                   | `tests_node/additivity.test.mjs`, `tests/additivity_test.ts`                     | Deno, ESLint, Oxlint                       | `deno task test`, `npm --prefix hosts run test:node`                                 |
| Generated configuration matches the golden and refuses unsafe writes | `tests_node/host_config.test.mjs`, `tests/cli_config_test.ts`                    | Node.js, Bun, Deno                         | `npm --prefix hosts run test:node`, `deno task test`                                 |
| The real CLIs accept the plugin                                      | `tests_node/examples_integration.test.mjs`, `tests/examples_deno_bundle_test.ts` | Node.js, Bun, Deno                         | `npm --prefix hosts run test:node`, `bun run --cwd hosts test:bun`, `deno task test` |
| Both comment-aware rules handle three dialects                       | `tests_node/suppression_dialects.test.mjs`                                       | ESLint, Oxlint, Deno                       | `npm --prefix hosts run test:node`, `deno task test`                                 |
| Duplicate overlaps are declared and disabled                         | `tests_node/overlap.test.mjs`                                                    | ESLint, Oxlint                             | `npm --prefix hosts run test:node`                                                   |
| The package imports outside Deno                                     | `tests_node/runtime_import.test.mjs`, `tests_node/package_pins.test.mjs`         | Node.js, Bun                               | `npm --prefix hosts run test:node`, `bun run --cwd hosts test:bun`                   |

Oxlint is not part of the Bun column: the conformance test skips its Oxlint branch under `bun test`,
because Oxlint support is pinned to Node.js. An Oxlint divergence is reported by the separate
`test:oxlint` step and does not fail the host job.

## Runtimes

- Deno 2.9 is the reference runtime and owns the `deno lint` host, the CLI, `unslop report`, the
  coverage trace protocol, and `./whole-tree`.
- Node.js 24 runs ESLint and Oxlint. Node strips TypeScript types, so the adapter imports a relative
  path outside `node_modules`.
- Bun 1.4 runs ESLint. The `test:bun` task needs no Deno.
- Oxlint is pinned at 1.88.0. Its JavaScript-plugin API is still marked experimental upstream, so the
  integration is labeled experimental and the pin guards it.

The root export imports only `zod`. The Deno globals live in `deno.ts`, which the ESLint and Oxlint
entries never import.

## Adding to your linter

### ESLint

- Install `@dostark/unslop-ts` and import `createEslintPlugin` from `@dostark/unslop-ts/eslint`.
- The supported range is 9.0.0 and later, below 11. The adapter table runs at 9.0.0, 9.39.5, and
  10.13.0.
- Spread a preset after your baseline: `...unslop.configs.recommended`. The presets are `recommended`,
  `strict`, `strict-error`, `deno`, and `typescript-eslint-compat`.
- A preset adds only the plugin, `unslop/...` rules at `warn`, and the `unslop` settings key. It sets no
  parser and no foreign rule. To change a rule after the spread, add a later object with
  `"unslop/<rule>": "error"` or `"warn"`.
- If your baseline already enables a typescript-eslint rule that duplicates an unslop rule, spread
  `typescript-eslint-compat` last. It turns the unslop duplicates off; the generated overlap table
  names each one.
- ESLint exits 0 when it reports only warnings. Use `--max-warnings 0` in a gate that must fail on
  them.

### Oxlint

- Add the plugin module to `jsPlugins`, enable the `unslop/...` rules you want, and set
  `settings.unslop`. Rules that classify test or fixture paths read `testGlobs`, `fixtureGlobs`, and
  `ignoreGlobs` from that object. A missing settings object fails with a named `EslintAdapterError`;
  this is deliberate, so a path-sensitive rule never guesses.
- Generate a starting config with
  `unslop config export --host=oxlint --out=.oxlintrc.json`, then merge the fragment into your existing
  config. The CLI refuses an existing file unless you pass `--overwrite`, and refuses a symlink.
- Oxlint warns without failing and fails on an `error` level.
- Oxlint is experimental upstream. The integration pins 1.88.0; treat a version bump as a compatibility
  change that must pass the conformance suite.

### deno lint

- Register the plugin entry or the release bundle in `lint.plugins`, or compile a version 2
  configuration with `createUnslopProject`.
- Plugin rules are `error` or `off`; a configured `warn` becomes `error` because `deno lint` has one
  severity for plugin findings.
- The Deno suppression dialect applies: `// deno-lint-ignore <code> -- reason`.

### One source of truth

The packs and their metadata are shared. A version 2 configuration compiles to the Deno catalog, and
the ESLint presets and Oxlint fragments are derived from the same packs. The generator and presets
never change a foreign diagnostic; the additivity suite checks that on all three hosts.

The invariants hold for every host:

1. Adding the plugin leaves every foreign diagnostic unchanged.
2. The plugin reports only `unslop/...` ids.
3. A preset sets no parser and no foreign rule.
4. Plugin rules are `error` or `off`; `warn` becomes `error` in `deno lint`.
5. Suppression follows the dialect the host understands.

### Current limits

- Oxlint support is experimental and pinned to 1.88.0. It is not part of the Bun column.
- The JSR-install smoke run (`npx jsr add`, `bunx jsr add`) is `PENDING VERIFICATION` until the user
  publishes `@dostark/unslop-ts`. The example projects import the adapter by relative path.
- The CLI, `unslop report`, the coverage trace protocol, and `./whole-tree` are Deno-only.
- There is no Biome host. Biome keeps its own rules and suppressions; unslop-ts reads only the three
  dialects above.

## Suppression comments

A suppression needs a reason after `--`.

| Dialect | Ignore one line                                | Ignore the file                             | Used by     |
| ------- | ---------------------------------------------- | ------------------------------------------- | ----------- |
| Deno    | `// deno-lint-ignore <code> -- reason`         | `// deno-lint-ignore-file <code> -- reason` | `deno lint` |
| ESLint  | `// eslint-disable-next-line <rule> -- reason` | `/* eslint-disable <rule> -- reason */`     | ESLint      |
| Oxlint  | `// oxlint-disable-next-line <rule> -- reason` | `/* oxlint-disable <rule> -- reason */`     | Oxlint      |

`unslop/ignore-needs-reason` and `unslop/no-forbidden-lint-ignore` read the dialect list from their
`dialects` option; by default each host reads its own dialect.

## Working with Biome

Biome is a formatter and linter, and unslop-ts has no Biome host. The two coexist: Biome keeps
formatting and its own lint rules, and unslop-ts adds the rule families it owns. The generated overlap
table lists the Biome rules that duplicate or relate to unslop-ts rules, with `duplicate` or `related`
as the kind. When a rule duplicates, turn one of the two off. Biome suppressions stay Biome's
(`// biome-ignore lint/<group>/<rule>: reason`); unslop-ts does not parse them and reports only the
Deno, ESLint, and Oxlint dialects.

## Lockfiles

- `deno.lock` belongs to Deno and covers the engine and the Deno test suite.
- `hosts/package-lock.json` belongs to npm and covers the Node.js host suite.
- `hosts/bun.lock` belongs to Bun and covers the Bun host suite.

Do not edit a lockfile by hand; regenerate it with the tool that owns it.

## Choosing a host

- Run `deno lint` when the project already uses Deno. It gets the version 2 configuration, the CLI,
  `unslop report`, and the whole-tree checks.
- Run ESLint when the project uses ESLint 9 or 10. It gets the presets, the adapter range tested at
  9.0.0, 9.39.5, and 10.13.0, and the host's own formatter and reporting.
- Run Oxlint when the project already uses it and accepts the experimental label. The plugin runs
  through `jsPlugins` on Node.js and is pinned to 1.88.0.

Install only the tools of the host you run. The published package depends on `zod` only, so an ESLint
or Oxlint project does not install Deno. The CLI, `unslop report`, the coverage trace protocol, and
`./whole-tree` run on the Deno host only; ESLint and Oxlint users use their host's formatters.

## Contributing without Deno

The CI `verify` job needs Deno and runs `fmt`, `lint`, `check`, `deno publish --dry-run`, the purity
tests, the dogfood test, the bundle test, and the Deno conformance column. Two jobs need no Deno:

- `hosts-node` (Node.js 24): `npm ci` in `hosts`, then `npm --prefix hosts run test:node`, which
  covers ESLint/Node and Oxlint/Node. The Oxlint example runs as a separate `test:oxlint` step with
  `continue-on-error`, so an Oxlint divergence is reported without failing the job.
- `hosts-bun` (Bun 1.4.3): `bun install --frozen-lockfile` in `hosts`, then
  `bun run --cwd hosts test:bun`, which covers ESLint/Bun. Oxlint is not part of this column.

Locally, the same commands run from `unslop-ts/`:

```sh
npm --prefix hosts run test:node
npm --prefix hosts run test:oxlint
bun run --cwd hosts test:bun
deno task test
```

The Deno job installs no Node.js or Bun, and the host jobs install no Deno. The JSR-install smoke run
(`npx jsr add`, `bunx jsr add`) stays `PENDING VERIFICATION` until the user publishes
`@dostark/unslop-ts`.

## Verifying release bundles

```sh
sha256sum -c dist/unslop_engine.js.sha256
sha256sum -c dist/deno_plugin.js.sha256
```

Both bundles and both checksum files attach to a release. `deno task bundle` rebuilds them.

## Configuration (version 2)

```json
{
  "version": 2,
  "plugin": "demo",
  "extends": ["unslop:recommended"],
  "docsBase": "docs/style_guide.md",
  "paths": {
    "test": ["**/*_test.ts"],
    "fixture": ["**/tests/fixtures/**"],
    "ignore": [{ "glob": "**/vendor/**", "reason": "Vendored code is not reviewed." }]
  },
  "tags": {
    "project-choice": { "description": "A rule choice of this project.", "requiresScope": ["prod"] }
  },
  "profiles": {
    "comments": ["tag:comments"]
  },
  "rules": {
    "demo/no-runtime-typeof": {
      "level": "error",
      "scope": "prod",
      "options": { "allowInTypeGuards": true }
    },
    "demo/max-params": ["error", { "max": 5 }],
    "demo/exported-interface-naming": {
      "level": "off",
      "optIn": true,
      "reason": "Opt-in naming convention."
    }
  }
}
```

- `version` must be `2`, and `plugin` must match `^[a-z][a-z0-9-]*$`.
- `extends` lists `unslop:recommended` and/or `unslop:strict`. The order is the expansion order, and a
  later entry for the same rule replaces the earlier one completely.
- `docsBase` is prefixed to engine-owned guide anchors. An explicit rule `docs` value always wins, and
  consumer script docs are never prefixed.
- `paths.test` and `paths.fixture` become the classification globs, and each `paths.ignore` entry
  needs a reason.
- `tags` overrides a category description and may restrict its scope. Only tags used by an emitted rule
  enter the compiled vocabulary.
- `profiles` maps a name to a non-empty selector list for `--profile`. Every profile token is validated
  when the configuration is compiled, so a typo fails `config validate` rather than the later user who
  selects that profile.
- `rules` accepts a level, `[level, options]`, or the long form. The long form adds `scope` (default
  `all`), `include`, `exclude`, `options`, `optIn`, `reason`, `docs`, `tags`, and consumer-only
  `exclusionCodes`.

`off` and `optIn: true` require a non-empty reason. Plugin rules accept `error` or `off`; `deno lint`
reports a selected plugin finding as an error. An omitted rule is registered off and opt-in with the
reason `Not enabled by the configuration.`, so its ignore code is known to Deno.

## Presets and rule metadata

- Both packs: `unslop:recommended` expands 13 rules and `unslop:strict` expands 34 (the 13 plus 21).
- TypeScript pack only: 11 and 32.
- `unslop:strict` includes the recommended rules.

Each rule's metadata drives presets, docs, and limits. `unslop rules list` shows the status, level,
category, editable controls, and host modes. `unslop rules show <id>` adds the configured, default, and
effective options, the per-field source, the guide anchor, and the host command.

Statuses describe the configuration, not the host:

- `active`: the rule is enabled and selected.
- `parked`: the rule is off and opt-in; selecting it runs it and makes its finding an error.
- `off`: the rule is off and cannot be selected on.
- `not-selected`: a selection excludes the rule for this call.

A query status never overrides a host flag. A whole-tree check keeps its host mode: `unused-exports`
stays a warning until `--strict`, and `optional-params` stays a warning until `--fail` or `--staged`,
regardless of the configured level shown by the CLI.

## Project descriptor

`IProjectDescriptor` holds `pluginName`, `rootUrl`, `configUrl`, `lintConfigUrl`, `pluginUrl`, `packs`,
`scriptRules`, and `wholeTreeHosts`. A script rule supplies metadata, an option schema (or `null` for
no options), controls, and its host command. `wholeTreeHosts` may specialize only the fixed
applicability and command of `duplicate-type` and `duplicate-constant`. Export the descriptor from a
project module; migration and `config validate` load it without importing the plugin or a version 2
file.

## Command line

Run the CLI from a checkout with `deno task unslop`, or as the package subpath `@dostark/unslop-ts/cli`.

| Command                                                                        | Effect                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `unslop rules list [--category=] [--status=] [--format=table\|json]`           | Every resolved rule with status, level, category, controls, and host modes.       |
| `unslop rules show <id> [--format=table\|json]`                                | One rule with configured/effective/default options and per-field sources.         |
| `unslop rules enable <id> [--level=error\|warn] [--dry-run]`                   | Set a supported level and clear obsolete off fields.                              |
| `unslop rules disable <id> --reason=<text> [--opt-in] [--dry-run]`             | Set the level to off with a reason, optionally parking the rule for selection.    |
| `unslop rules set <id> <option>=<json> [--dry-run]`                            | Set one supported option and preserve every other effective setting.              |
| `unslop rules unset <id> <option> [--dry-run]`                                 | Remove one option override and use its engine default.                            |
| `unslop presets list [--format=table\|json]`                                   | Every preset with the ids its memberships enable for the registered packs.        |
| `unslop presets show <name> [--format=table\|json]`                            | One preset's expansion.                                                           |
| `unslop config validate [--descriptor=<entry>]`                                | Read the file from disk and compile it against the descriptor.                    |
| `unslop config print [--resolved] [--descriptor=<entry>]`                      | The emitted catalog, or the catalog plus the resolved index with `--resolved`.    |
| `unslop config schema`                                                         | The generated structural JSON Schema.                                             |
| `unslop migrate --descriptor=<entry> --from=<v1> --out=<path> [--layout-out=]` | Migrate a version 1 catalog without overwriting an input or existing destination. |

Use `deno task unslop` for read commands and dry runs. Use `deno task unslop:write` for a real edit, a
migration, or any command that locks, stages, and writes files. The read task grants no write access,
because the CLI imports trusted project code with its own permissions.

### Get the `unslop` command

The package publishes a module, not a binary. Install the command with Deno:

```sh
deno install --global --name unslop --allow-read --allow-env jsr:@dostark/unslop-ts/cli
```

Add `--allow-write` for edits and `--allow-run=deno` for `unslop report`. Then run
`unslop rules list`. In a checkout, `deno task unslop` and `deno task unslop:write` run the same
entry with the same permissions.

### Command examples

These examples run in a checkout of this repository. Each line uses the task whose permissions it
needs. The `migrate` example assumes a version 1 project and writes a separate output name so it cannot
clobber a live version 2 file.

```sh
deno task unslop rules list --format=json
deno task unslop rules show demo/max-params --format=json
deno task unslop rules enable demo/no-boolean-assert --dry-run
deno task unslop rules disable demo/no-chained-type-assertions --reason=unused --dry-run
deno task unslop rules set demo/max-params max=4 --dry-run
deno task unslop rules unset demo/max-params max --dry-run
deno task unslop presets list --format=json
deno task unslop presets show unslop:strict --format=json
deno task unslop config validate
deno task unslop config print
deno task unslop config schema
deno task unslop:write rules set demo/max-params max=3
deno task unslop:write migrate --descriptor=examples/unslop.project.ts --from=catalog.json --out=unslop.migrated.config.json --layout-out=layout.json
deno task unslop:report report --format=json src
deno task unslop:report report --format=markdown src
deno task unslop:report report --format=sarif src
deno task unslop:report:write report --format=json --out=report.json src
```

Query and edit routes accept `--plugin=<entry>` to select a local plugin entry. Without it, discovery
walks to the nearest JSON `deno.json` and uses its single configured plugin; several plugins require
`--plugin`. `--select=<tokens>` and `--profile=<name>` replace the selection variable for that call and
cannot be combined. An unknown selector, profile, category, status, format, command, or entry is a
usage error.

Exit codes:

- `0`: success.
- `1`: invalid file content, a failed compilation or validation, or a failed write.
- `2`: unknown or unsupported usage, a refused destination, a non-local entry, or a JSONC refusal.

The CLI accepts filesystem paths and local `file:` URLs only. It rejects `data:`, remote, and registry
schemes before import, and it refuses a JSONC lint configuration instead of parsing it. Local entries
and their transitive imports are trusted executable project code, not a sandbox; the CLI itself does
not request, store, or print credentials.

## Editing

`rules enable`, `disable`, `set`, and `unset` re-read the file on every call, validate the result by
compiling it, and preserve unrelated rules and fields. Because an explicit entry replaces its preset
entry completely, an edit first materializes the effective level, options, scope, include/exclude, docs,
and tags, then changes only the target. The command writes the shortest form that compiles to the same
effective rule.

An edit refuses a control that the named host does not read, a plugin `warn` level, a missing reason,
and an `unset` whose option has no engine default. A refused or stale edit leaves the bytes unchanged.
A real edit locks the file, compares the current bytes and inode with the read copy, preserves the mode,
and replaces it atomically. An edit keeps an authored `reason`, `optIn`, and consumer `exclusionCodes`
at every level; `enable` clears the first two only when the rule was off. `--dry-run` prints a unified
diff before any lock or temporary file exists.

## Migration

`unslop migrate` reads a version 1 catalog through the descriptor, so it works before any version 2
file exists. It moves `scopes`, `ignore`, and `tagVocabulary` to their version 2 fields, keeps explicit
applicability, options, docs, and tags, and maps the four whole-tree setting sections to their rule ids.
The layout moves to a separate file and requires `--layout-out` when the input has one. An engine limit
that differs from the rule metadata is refused instead of discarded.

The pair is written without overwriting: canonical parent paths, sibling locks, staged temporary files,
and no-clobber hard links. Layout commits first and the configuration last. If the second commit fails,
only the layout inode created by that invocation is removed. If cleanup cannot complete, the command
exits `1` and reports the exact surviving paths; it never reports a successful partial pair. The output
is compiled before it is written, so a value that is legal in version 1 but illegal in version 2 is
refused with no file created.

### Whole-tree hosts today

Until Phase 232 Step 5 adds the version 2 adapter, a whole-tree host still reads a legacy catalog.
`unslop config print` emits one with the `wholeTree` section, so a migrated project can keep its checks
running:

```sh
deno task unslop config print > catalog.json
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --catalog=catalog.json --rule=unused-exports
```

The same hint prints after a migration. Phase 232 Step 5 replaces this bridge with a compiled-settings
adapter, so the separate catalog is temporary.

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
- **Every rule is known to Deno.** A rule that is off, not selected, out of scope, or not named by the
  configuration stays registered and reports nothing, so its ignore comments are never
  `ban-unknown-rule-code`.
- **Deno's rule configuration wins.** `lint.rules.exclude` and `--rules-exclude` turn a plugin rule off.
  The configuration and `<NAME>_LINT_RULES` only narrow the run further.
- **Built-in configuration stays yours.** `unslop-ts` never writes or presets `lint.rules`. Choose the
  built-ins that fit your project, for example `no-explicit-any` with `no-typeof-escape`,
  `ban-ts-comment`, and `ban-unused-ignore`, which are in the recommended set.

## Layout

- `src/engine/` — catalog parsing, path classification, the rule registry, the plugin factory, and the
  test runner helper.
- `src/rules/` — rule implementations, option schemas, metadata, and the two packs. `src/rules/deno/`
  holds the Deno pack. Every pack entry carries the rule's `meta`.
- `src/rules/whole_tree/` — the six whole-tree checks, their option schemas, and `WHOLE_TREE_CHECKS`
  descriptors (metadata, controls, host command). The Deno-only entry `@dostark/unslop-ts/whole-tree`
  exports the duplicate, constant-restatement, optional-parameter, unused-export, and magic-literal
  checkers so a host script can call them in-process.
- `src/config/` — the version 2 schema, descriptor contracts, pure compiler and presets, JSON Schema,
  migration and projection, project factory, and the pure edit functions.
- `src/cli/` — the CLI dispatcher, local module loader, selection, read and write routes, migration
  command, safe writer, diff, and output. The older `rule_report.ts`, `whole_tree.ts`, and
  `rule_ceiling.ts` entry points remain for one-rule reports and whole-tree hosts.
- `examples/` — a descriptor, a version 2 configuration, and a plugin entry for any Deno project.
- `docs/style_guide.md` — the generic TypeScript style rules and their metadata notes.

## Add a rule

1. Implement `create(context, ctx)` in `src/rules/<rule>.ts` and add the rule to `TYPESCRIPT_RULE_PACK`
   or `DENO_RULE_PACK` (`src/rules/mod.ts`) with its `meta`: description (at most 120 characters),
   category, guide anchor, preset membership, and limits.
1. Add its option schema to `TYPESCRIPT_OPTION_SCHEMAS` or `DENO_OPTION_SCHEMAS` in
   `src/rules/rule_options.ts`.
1. Add the anchor and the rule table row to `docs/style_guide.md`, and let the preset membership or an
   explicit project setting enable it. Do not add project data to the engine.
1. Add named valid and invalid cases in `tests/<rule>_test.ts`, and a case in
   `tests/deno_builtin_overlap_test.ts`. Run `tests/rule_meta_test.ts` and `tests/style_guide_claims_test.ts`.

## Development

`deno task test`, `deno task lint`, `deno task check`, and `deno fmt --check` run in this repository
alone. The engine tests import the package by relative path. `deno task unslop` runs the CLI from the
checkout; add `:write` for edits, and use `unslop:report` for `report`.

The conformance data in `tests/cases/conformance.json` is the single source of the named cases. A new
rule needs one entry before its host tests can pass. The host suites live in `tests_node/` and the
shared runners in `tests/hosts/`; they run through npm or Bun, as the matrix above shows.

## Rule ownership and guide links

The TypeScript pack owns generic checks, including configurable import-boundary zones and opt-in
interface conventions. Consumer names, paths, severities, and rule options belong in the project's
configuration. Default type-safety hints link to [the engine guide](docs/style_guide.md#strict-type-safety)
through the rule metadata; an explicit rule `docs` value replaces that link.

The Deno-only whole-tree entry exports the duplicate-type, duplicate-constant, and repeated-literal
checkers. A host script calls them in-process with compiled settings. These checks are library
functions, not per-file plugin rules, and their host modes remain authoritative.

## Reports and consumer adoption

`unslop report` runs the real lint host and reports per-rule observed coverage, callback outcomes,
selected and foreign findings, and explicit unavailable coverage. It accepts `--format=table` (the
default), `json`, `markdown`, or `sarif`; the SARIF output validates against the vendored OASIS 2.1.0
schema. Tracing is opt-in through the plugin trace environment variable. Source fingerprints come
from captured operand bytes, and a changed diagnosed source makes the report failed. The report uses
absolute operands, supports `--` for a leading-dash path, and refuses `--out` unless the write task is
used. Authored `limits` is optional: omission keeps the owner limit, and an empty string is preserved
through migration and edits.

## Option validation

A regular expression option is checked when the catalog is parsed (version 1) or the configuration is
compiled (version 2). A pattern that does not compile, a repeated or unknown flag, and a pattern that
fails with its own flags are `CatalogError`/`ConfigError`s that name the field. The whole-tree command
reports the same error and exits with code 2. The fields are the `specifiers` of
`allowDynamicImports`, the `pattern` and `flags` of each `ephemeral-comment` phrase, the `pattern` of
`ephemeral-filename`, and `testScaffoldPattern` of the magic-literals options.

The version 1 catalog form:

```json
{
  "rules": {
    "demo/ephemeral-comment": {
      "engine": "plugin",
      "severity": "error",
      "scope": "all",
      "tags": ["demo"],
      "options": { "phrases": [{ "pattern": "\\btried\\b", "flags": "gi", "hint": "State the fact." }] }
    }
  },
  "wholeTree": { "magicLiterals": { "checkNumbers": false, "testScaffoldPattern": "^scaffold-" } }
}
```

The version 2 configuration form puts the same options in rule entries:

```json
{
  "version": 2,
  "plugin": "demo",
  "rules": {
    "demo/ephemeral-comment": {
      "level": "error",
      "options": { "phrases": [{ "pattern": "\\btried\\b", "flags": "gi", "hint": "State the fact." }] }
    },
    "magic-literals": {
      "level": "error",
      "options": { "checkNumbers": false, "testScaffoldPattern": "^scaffold-" }
    }
  }
}
```

The flags `g` and `y` are accepted. Each comment is tested from the start of the pattern, so an earlier
match never hides a later one. In a host, `checkNumbers: false` turns number checks off when no command
line flag is present. A host flag such as `--no-numbers` also turns them off, and no flag turns them on.

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

## Overlaps

This table is generated from `IPluginRule.overlaps` by `scripts/generate_overlap_table.mjs`.

<!-- BEGIN GENERATED OVERLAPS -->

| unslop rule                         | Ecosystem         | Foreign rule                    | Kind      | Guidance                                                                       |
| ----------------------------------- | ----------------- | ------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `unslop/no-chained-type-assertions` | typescript-eslint | `no-unnecessary-type-assertion` | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/no-explicit-unknown`        | typescript-eslint | `no-explicit-any`               | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/no-unsafe-dictionary`       | typescript-eslint | `no-explicit-any`               | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/no-typeof-escape`           | typescript-eslint | `no-explicit-any`               | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/no-pass-through-type-alias` | typescript-eslint | `no-unnecessary-type-assertion` | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/no-runtime-typeof`          | eslint            | `valid-typeof`                  | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/max-cyclomatic-complexity`  | eslint            | `complexity`                    | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/max-class-size`             | eslint            | `max-classes-per-file`          | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/ts-suppression-pragmas`     | typescript-eslint | `ban-ts-comment`                | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/max-params`                 | eslint            | `max-params`                    | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/exported-interface-naming`  | typescript-eslint | `naming-convention`             | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/ignore-needs-reason`        | eslint-comments   | `require-description`           | duplicate | Turn one of the two off; `typescript-eslint-compat` turns the unslop rule off. |
| `unslop/no-forbidden-lint-ignore`   | eslint-comments   | `no-unlimited-disable`          | related   | Both may run; the unslop rule is narrower and states the reason.               |

<!-- END GENERATED OVERLAPS -->
