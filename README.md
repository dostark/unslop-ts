# unslop-ts

A TypeScript lint rule engine that runs the same rules under `deno lint`, ESLint 9 and later, and
Oxlint, on Deno, Node.js, and Bun. The rule set, the messages, and the suppression model are shared,
so a finding means the same thing in every host.

For `deno lint`, the engine compiles a validated version 2 configuration into a `Deno.lint.Plugin`
that runs inside `deno lint`. For ESLint and Oxlint, it exports a flat-config plugin and presets that
add the same rules to an existing configuration without changing a foreign diagnostic. A small CLI
lists and explains rules, edits supported settings, migrates a version 1 catalog, and exports a host
fragment.

The engine ships two rule packs. `TYPESCRIPT_RULE_PACK` holds 37 rules for type evidence, imports,
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

| Host                             | Entry                                                                     | Runtime      | Status       |
| -------------------------------- | ------------------------------------------------------------------------- | ------------ | ------------ |
| `deno lint`                      | `@dostark/unslop-ts/deno` in `lint.plugins`, or the release plugin bundle | Deno         | supported    |
| ESLint 9.0.0 and later, below 11 | `@dostark/unslop-ts/eslint` as a plugin                                   | Node.js, Bun | supported    |
| Oxlint 1.88                      | the same ESLint plugin through `jsPlugins`                                | Node.js      | experimental |

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
- A generated fragment registers the plugin under the configuration's `plugin` name, so its rule ids
  use that same prefix. A test-scoped rule with `include` runs only where both patterns match; the
  generator rejects test scope without `paths.test` globs.
- The adapter reports on TypeScript files. Ordinary `.js`, `.jsx`, `.mjs`, and `.cjs` files parsed by
  ESLint's default parser produce no unslop findings.

### Oxlint

- Add the plugin module to `jsPlugins`, enable the `unslop/...` rules you want, and set
  `settings.unslop`. Rules that classify test or fixture paths read `testGlobs`, `fixtureGlobs`, and
  `ignoreGlobs` from that object. A missing settings object fails with a named `EslintAdapterError`;
  this is deliberate, so a path-sensitive rule never guesses.
- Generate a starting config with
  `unslop config export --host=oxlint --out=.oxlintrc.json`, then merge the fragment into your existing
  config. The CLI refuses an existing file unless you pass `--overwrite`, and refuses a symlink.
- Oxlint warns without failing and fails on an `error` level.
- Generated `exclude` patterns use Oxlint's `excludeFiles` override field. Test scope with `include`
  cannot be represented without widening, so export fails with the rule id instead.
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
1. The plugin reports only `unslop/...` ids.
1. A preset sets no parser and no foreign rule.
1. Plugin rules are `error` or `off`; `warn` becomes `error` in `deno lint`.
1. Suppression follows the dialect the host understands.

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

### Bundling for an embedded lint check

A host that runs the plugin in a restricted child process can carry a verified copy instead of the
source tree:

- `unslop_engine.js` is the engine bundle. Its `.sha256` file is written by `deno task bundle` and
  checked before the bundle is used.
- `unslop deno-policy --config=<file> --out=<dir>` builds the whole directory from one version 2
  configuration: the engine bundle, `catalog.json`, a `plugin.ts` entry, a `deno.json` that loads it,
  and a `manifest.json` with each file's size and SHA-256 hash. The command needs read, write, env,
  and `--allow-run=deno,git` permissions. The git permission only records the engine commit. The
  directory replaces an empty directory or a previous build, and never another directory. A consumer
  verifies that manifest before it loads anything, then runs
  `deno lint --deny-import --config <dir>/deno.json --rules-tags= --json <files>`.
- The child runs offline: a host that starts it with `--deny-import` and a proxy-free environment
  must ship every module it needs, because remote imports cannot resolve.
- A redeploy to another directory verifies and copies the existing asset set instead of rebuilding,
  because the engine source may be absent. Rebuild only from a source checkout.

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
reports the trusted exemption set by default, `--all` widens the report, and only `--fail` fails the run (see
[Unused exports](#unused-exports) for the reports); `unused-files` warns until `--fail` (it starts the walk at
the entry points of `deno.json` and `package.json`, see [Unused files](#unused-files-manifest)); `optional-params` warns until `--fail` or `--staged`. An exported
interface that no file imports reports as a warning and never fails the run; put
`// unslop-ignore-next-line unused-interface` above it when it is intentional API,
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
| `unslop deno-policy --config=<file> --out=<dir> [--packs=typescript[,deno]]`   | Build an offline Deno lint policy directory from a version 2 configuration.       |

Use `deno task unslop` for read commands and dry runs. Use `deno task unslop:write` for a real edit, a
migration, or any command that locks, stages, and writes files. The read task grants no write access,
because the CLI imports trusted project code with its own permissions. `deno task cli:write` is the
equivalent write-enabled CLI alias.

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
applicability, options, docs, and tags, and maps the six whole-tree setting sections to their rule ids.
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
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --catalog=catalog.json --rule=unused-files
```

### Unused exports {#unused-exports}

`--rule=unused-exports` lists exported declarations that no module imports. It has six reports. They differ in
how an import is matched to an export, and in what they leave out on purpose.

| Report              | Flags                                     | An import matches an export by                  | Use                                                                 |
| ------------------- | ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Trusted             | none                                      | the bare name                                   | the gate: applies the exemption lists, warns for types              |
| Broad               | `--all`                                   | the bare name                                   | a survey: drops the exemptions that only the trusted report applies |
| Parity              | `--parity`                                | the module that defines it                      | the fallow-aligned audit                                            |
| Parity with enums   | `--parity --enum-members`                 | the module that defines it                      | adds unused enum members, advisory                                  |
| Parity with members | `--parity --enum-members --class-members` | the module that defines it                      | adds unused enum and class members, advisory                        |
| Production          | `--parity --production`                   | the module that defines it, from non-test files | separates unused code from code that only tests use, advisory       |

```sh
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --descriptor=<project descriptor> --rule=unused-exports
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --descriptor=<project descriptor> --rule=unused-exports --parity --fail
```

| Flag                     | Effect                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--all`                  | Broad report. Drops the trusted-only exemptions, and prints the directories with the most findings.                                                             |
| `--parity`               | Resolved report. `--all` has no effect with it.                                                                                                                 |
| `--enum-members`         | Adds the enum members that no `Enum.Member` reference reaches. Needs `--parity`.                                                                                |
| `--class-members`        | Adds the class members that nothing reads (see Class members). Needs `--parity`.                                                                                |
| `--production`           | Test files stop being sources of uses, and each finding says whether only tests use it. Needs `--parity`. Combines with `--enum-members` and `--class-members`. |
| `--severity=warn\|error` | Sets every class to a warning or an error for this run.                                                                                                         |
| `--relaxed`              | Same as `--severity=warn`.                                                                                                                                      |
| `--fail`                 | Exits with 1 when the run holds an error finding. A warning never fails the run. `--strict` is an older name.                                                   |

A finding prints as `WARN [unwired-export] path:line – 'name' …` or, with `--fail`, `ERROR …`, and a summary line
counts the errors and the warnings. The exit code is 0 unless `--fail` meets an error, and 2 for a usage error such
as a catalog without a `wholeTree.unusedExports` section.

#### The trusted report

The trusted report matches by name: an export counts as used when any walked file, tests included, imports that
name, re-exports it, reads it as `namespace.name`, or binds it from a destructured `await import(…)`. It then exempts
exports that a bare-name match cannot judge. These exemptions apply to the trusted and to the broad report:

- a `configurable(…)` registration, a name with the `__test_` prefix, and a declaration with a pragma (see Markers);
- a name that starts with `I` and a capital letter, a file that carries a `@public` JSDoc tag, and a file that matches
  `mainEntrypointSuffixes`.

Only the trusted report adds these, and `--all` drops them:

- a name that a package entry file re-exports, a file that matches `entrypointSuffixes`, and a path under
  `strictSkipPrefixes` or `strictSkipSegments`;
- the provider metadata constants, test double names such as `…Mock`, `…Stub`, and `mock…`, and entry point names such
  as `run…`, `start…`, and `main…`;
- a name that a script under `scriptRoot` imports.

An unused interface or type alias is a warning that `--fail` ignores. It is exempt when it sits in an entry file, in a
skipped path, or when a script imports it.

#### The parity report

The parity report asks which export each import reaches, and it lists an export site that nothing reaches. It exists
to match a resolving tool such as fallow. A name that another module exports and imports does not hide an unused
export, which the name match cannot see.

- **Resolution.** An import resolves through relative paths and through the `imports` map of every `deno.json` below the
  root. An exact key matches only itself, and a key with a trailing slash is a prefix. A specifier that resolves to no
  scanned file is ignored.
- **Chains.** Named re-exports and `export *` carry a use down to the definition. An import through a barrel uses the
  barrel entry and the definition behind it.
- **A re-export is not a consumer.** A named re-export (`export { x } from "<module>"`) does not use `x`. A barrel entry that nobody
  imports through the barrel is reported. A file that imports a name and exports it again from a local list is
  reported when nobody imports it from there, while its own import still uses the definition.
- **Import forms.** A named or default import uses that export. `import * as ns` uses the members that the file reads
  as `ns.member`, and every export when `ns` is passed on or indexed. A destructured `await import(…)` uses the names
  it binds, and a property read on its result uses that property. Any other dynamic import uses every export.
- **Where a use may come from.** Any walked file counts, including tests and scripts. A file that imports from itself
  does not.
- **Public API.** The files that a manifest hands to consumers outside the walk are consumed as a whole: `exports`
  and `lint.plugins` of a `deno.json`, and `main`, `module`, `bin`, and `exports` of a `package.json`. So are the files
  that match the `publicEntries` globs, which is the place for a bundle entry or a fixture that a tool loads by name.
  Everything a public file forwards is public too.
- **Types in signatures.** An exported interface or type alias that another exported declaration of the same file
  names stays: removing its export would leave a private type in a public signature.
- **Scope.** The report scans the files under `productionRoots` and under `scriptRoot`, and skips `/fixtures/`. Every
  walked file is still a source of uses.
- **Exemptions.** `configurable(…)` registrations, `__test_` names, and declarations with the pragma are skipped.

Each finding is one site: the same name in two files gives two findings when both are unused.

#### Enum members

`--parity --enum-members` adds a finding for each enum member that no reference reaches. The name of the finding is
`Enum.Member`. A reference is `Enum.Member`, `Enum["Member"]`, `ns.Enum.Member`, or `Enum.Member` in a type position,
and it resolves through imports, aliases, and barrels like an export does. A bare member name inside an initializer of
its own enum reads a sibling.

An enum used as a whole value uses every member, because the code can reach any of them: `Object.values(Enum)`,
`z.nativeEnum(Enum)`, `keyof typeof Enum`, `Enum[key]`, `Enum` passed as an argument, an export under another name, a
default export, and an enum as the key type of `Record`, `Partial`, `Required`, `Omit`, `Pick`, `Exclude`, `Extract`,
or a mapped type. An enum named only as a type (`mode: Mode`) uses no member.

A manifest export does not make an enum public, because the workspace packages of a repository are often consumed only
inside it. A `publicEntries` file does, and so does a pragma. The pragma exempts a member when it sits above the member.
Above the enum declaration it exempts the whole enum, which is the answer for a closed set such as protocol codes or
stored statuses whose values arrive as data. The report is advisory by design: deleting a member that data can still
carry can break a cast or the parse of a stored value.

#### Class members

`--parity --class-members` adds a finding for each class member that nothing reads. The name of the finding is
`Class.member`. The check has no types, so it treats private and public members differently.

- **Private members.** A `private` member, a `#name` member, and a private constructor parameter property are checked
  inside the class body, where TypeScript confines them. A member is unused when the class never reads it. A field
  that the class only assigns (`this.x = value`) counts as unused.
- **Public and protected methods and accessors.** A member is listed only when its name is accessed nowhere in the
  walked files, tests included. An access is `.name`, `?.name`, `["name"]`, a destructured `{ name }`, or
  `Type["name"]`. A call inside the class counts. The match is by name, so an unrelated member with the same name
  hides a dead one. The report never lists a member that a name match finds used.
- **Public fields are not listed.** Serialization, equality checks, and `Object.keys` can read a field without naming it.

A member that a caller can reach without naming it is a contract and is never listed:

- a member that an `implements` interface or an `extends` base declares, and a member that carries `override`,
  `abstract`, or a decorator. The interface or base resolves through imports and barrels like an enum does, together
  with its own heritage;
- every public member of a class whose interface or base cannot be resolved to a walked declaration, such as a class
  that implements `Disposable` or extends a class from an npm package, because the external contract is unknown;
- the members that a subclass of a built-in error inherits (`name`, `message`, `cause`, `stack`, `toString`);
- the names that the runtime calls on any object (`toString`, `toJSON`, `valueOf`, `then`, `next`, `return`, `throw`),
  and any member with a computed name such as `[Symbol.iterator]`;
- every member of a class that appears in `keyof Class` or `keyof typeof value`.

As for enums, a manifest export does not make a class public. A `publicEntries` file does, and so does a pragma
above a member or above the class. The report is advisory by design.

#### Production mode

The reports above count a use from a test file as a use, as fallow does. A function that only its own unit test calls
then stays, although no product code runs it. `--parity --production` asks the other question: which code does the
non-test code use?

- **Sources of uses.** A file that matches `testSegments` or `testSuffixes` is not a source of uses. Its imports,
  re-exports, member accesses, and enum references are ignored. Files under `scriptRoot` are production code.
- **Scope.** A declaration in a test file is test code and is never listed. The files are the same as in the parity
  report otherwise, and `publicEntries`, pragmas, and contracts work as before.
- **Two labels.** The report runs once with test uses and once without them. A finding that both runs list is
  `used by nothing`. A finding that only the second run lists is `used only by test files`. The message says which, and the
  summary counts both. The second class is the new one: the ordinary parity report never shows it.
- **Name matching sharpens.** A test that calls `.open()` on one class no longer hides a dead `open` on another class,
  because the call is not a source of uses.
- **Advisory.** The report lists more than the ordinary one by design, since a test double or a test seam is test-only
  on purpose. It is not a gate.

Read the output in this order:

1. A test double or helper defined in production source (a `Mock…` class, a `…ForTest` function): move it to a test
   helper folder.
2. A barrel entry that only tests import: remove the entry, or import from the defining file.
3. Production code that only tests reach: wire it in, or delete it with its tests. Each one is either a feature that is
   not connected yet or dead code.
4. A test seam that exists so a test can inspect state (a `get…` or `is…` accessor, or an export of a script helper):
   keep it and mark it with a pragma, or test through behavior.

#### Options

The `unused-exports` rule takes these options. Every project sets the required ones, and none has a default.

| Option                                     | Used by             | Meaning                                                                                           |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------- |
| `productionRoots`                          | all                 | Path prefixes whose files are scanned for exports.                                                |
| `testSegments`, `testSuffixes`             | trusted, production | Path parts and file name endings that mark a test file, which is not scanned for exports.         |
| `entrypointSuffixes`                       | trusted             | File name endings of package entry files, such as a barrel file name.                             |
| `mainEntrypointSuffixes`                   | trusted             | File name endings of program entry files, such as a main file name.                               |
| `scriptRoot`                               | all                 | The directory of wiring scripts. Trusted mode exempts the names they import. Parity scans it.     |
| `walkSkipPatterns`                         | all                 | Regular expressions for the paths that the walk never enters. They match the absolute path.       |
| `strictSkipPrefixes`, `strictSkipSegments` | trusted             | Paths whose exports the trusted report leaves out.                                                |
| `severity`                                 | all                 | `type`, `value`, and `parity`, each `warning` or `error`. The `parity` class covers enum members. |
| `publicEntries`                            | parity              | Optional globs of files that a tool consumes, so their exports are public API.                    |

#### Markers

| Marker                                           | Where                              | Effect                                                                                                        |
| ------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `// unslop-ignore-next-line unused-export`       | above a declaration                | Exempts the declaration. `unused-type` and `unused-interface` are the same marker, so use the name that fits. |
| `// unslop-ignore-next-line unused-enum-member`  | above a member, or above the enum  | Exempts one member, or all members.                                                                           |
| `// unslop-ignore-next-line unused-class-member` | above a member, or above the class | Exempts one member, or all members.                                                                           |
| `@public`                                        | in a JSDoc tag of a file           | The trusted report skips the file.                                                                            |
| `configurable(…)`                                | initializer of a constant          | Registers the constant by key, so its export is never reported.                                               |
| `__test_`                                        | name prefix                        | Marks a test seam, which is never reported.                                                                   |

#### Running it on this repository

The engine checks its own exports with the parity report. `deno task check:unused-exports` fails on any finding, and
`deno task check:unused-enum-members` and `deno task check:unused-class-members` list the unused members, and `deno task check:unused-production` lists the code that only tests use. Both read the `unused-exports` rule of
`lint/unslop.config.json`, which scans `src`, `tests`, and `lint`, and lists the bundle entry and the examples as
`publicEntries`.

#### Limits

The checks read syntax only. They build no type program, so they do not follow these shapes:

- an import path that a `tsconfig` `paths` entry, a `package.json` `exports` condition, or a `node_modules` package
  resolves, because only relative paths and `deno.json` import maps resolve;
- a dynamic import with a computed specifier, and a use from a file that is not TypeScript, such as a YAML scenario or
  a generated file;
- `export =`, declaration merging, and an ambient or global declaration;
- a local variable that has the name of an imported binding, because the check does not model scopes;
- an enum value that code reads as a string, such as `"fast"` from a database column;
- a method that code calls by a computed name (`obj[name]()`), and a callback that a framework invokes by name.

When a result looks wrong, the cause is usually one of these. List the consumer as a `publicEntries` file, add the
pragma, or add the import map entry.

### Unused files from the manifests {#unused-files-manifest}

`--rule=unused-files` starts the walk at the entry points that the manifests declare, and it reports every scanned
file that no entry reaches. The scan runs when the catalog has the `wholeTree.unusedFiles.manifest` section, which has
three fields:

- `walkSkipPatterns`: regular expressions for the absolute paths that the scan never enters.
- `extraEntries`: globs of files that are entry points although no manifest names them.
- `referenceGlobs`: globs of text files, such as scenario YAML and HTML pages, whose path mentions count as references.

The entry points are these:

- `deno.json`: `exports`, the code paths in `tasks`, `lint.plugins`, and the files that `deno test` discovers
  (`*_test.ts`, `*.test.ts`, `test.ts`, limited by `test.include` and `test.exclude`). The nearest manifest that has a
  `test` section or a `deno test` task owns the test scope of the files below it.
- `package.json`: `main`, `module`, `bin`, `exports`, and the code paths in `scripts`.
- A task that runs tests (`deno test`, `node --test`, `bun test`, `vitest`, `jest`, `mocha`) also makes its globs
  entry points. A leading `cd <dir> &&` moves the base directory of the command.

The walk follows static and dynamic imports, re-exports, and the `imports` maps of every `deno.json`. An exact key
matches only itself; a key with a trailing slash is a prefix. It also follows a string literal that reads as a path
to a scanned file, such as the first argument of a `new URL(…, import.meta.url)` call or the path of a spawned script. A mention with a
variable prefix, such as `$SUITE_HOME/scripts/x.ts`, resolves against each ancestor directory of the file that holds it.
The scan reads `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.css` files. A `mod.ts` barrel, a
script, or a file in a `tests` folder is not an entry by name, so an unused one is reported.

A catalog without the `manifest` section keeps the older scan, which treats scripts, barrels, and files in tests folders
as entries. `--conventions` selects that scan on a catalog that has the section, and `--manifest` fails with a usage
error when the section is missing.

The same hint prints after a migration. Phase 232 Step 5 replaces this bridge with a compiled-settings
adapter, so the separate catalog is temporary.

### Duplicate code

`duplicate-code` measures token-level duplication with [jscpd](https://github.com/kucherenko/jscpd) and
fails a scan group whose duplicated-token percentage exceeds its threshold. Token comparison finds a
clone even when the names differ, which the declaration checks `duplicate-type` and `duplicate-constant`
cannot. The check starts the pinned jscpd release through `npx`, so it needs Node.js and the npm registry
or a warm npm cache. It reads the `wholeTree.duplicateCode` section:

```json
{
  "jscpdVersion": "5.4.2",
  "minLines": 5,
  "minTokens": 50,
  "groups": [
    { "name": "source", "paths": ["src/"], "ignore": ["**/*.d.ts", "**/tests/**"], "threshold": 2 },
    { "name": "tests", "paths": ["src/"], "pattern": "**/tests/**/*.ts", "threshold": 5 }
  ]
}
```

`jscpdVersion`, `minLines`, and `minTokens` are optional and default to the values shown, and so are
`maxGapLines` (0), `baseline` (none), and `crossGroups` (false), which the paragraphs below describe. A group may
set its own `minLines`, which replaces the shared one for that group only, so production code can keep
a low minimum while test code uses a higher one. A group without `ignore` or `pattern` scans everything
under its `paths`. A group that scans no files is an
error, so a wrong glob never passes at zero percent. Run it with
`deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --catalog=catalog.json --rule=duplicate-code`;
`--verbose` lists every clone, largest first. `--group=<name>` (repeatable) runs only the named scan
groups, and `--top=<n>` caps the rows listed per group. `--by=file` ranks files by the lines that clones
cover, and `--by=block` collapses clone pairs that share a region into blocks with a copy count, the longest copy, and every
location.
The default `--by=pair` lists each clone pair. `--min-lines=<n>` drops clones shorter than `n` lines from
the listing in every view. It changes only what is listed, never the percentage or the threshold check.

Each group line also shows the **involved** share: the lines that any clone touches, counted once across
every copy, as a percentage of the scanned lines. The gate uses jscpd's percentage, which counts each clone
pair once, so the involved share is the larger figure and the one that other detectors report.

**Baseline.** Set `baseline` to a repository path and the check also fails a group that holds a clone the
baseline does not list, even while the group stays under its threshold. The percentage threshold still
applies. Each clone has an id built from its two files and its code, so moving a clone inside its files or
changing whitespace keeps the id. Create or refresh the file with `--update-baseline`, which writes one
line per clone and keeps the entries of groups that the run did not measure. The check prints how many
baseline entries no longer match a clone, so the file can shrink as clones go. The lines are longer than
most formatters allow, so exclude the baseline file from the project formatter.

**Cross-group clones.** Each group runs on its own, so a clone between two groups, such as source and
tests, is never compared. Set `crossGroups` to `true` and the check scans all groups together once more
and keeps the clones whose two copies fall in different groups. A cross-group clone must reach the larger of
the two group minimums. With a baseline, a cross-group clone that it does not list fails the run; without
one the pass only reports them. The pass runs only when two or more groups run.

**Gap merging.** jscpd ends a clone at the first token that differs. `maxGapLines` (shared, with a per-group
override) lets jscpd join clones of one file pair that sit that many unmatched lines apart into one larger
clone. It gives fewer and bigger targets and barely changes the percentage. `--max-gap-lines=<n>` overrides
it for one run.

**Machine-readable output.** `--format=json` prints one JSON document instead of the text report: each
group's figures, its clones with their ids and an `isNew` flag, the cross-group result, and an overall
`passed`. The exit code is the same as in text mode.

**Comparing with other detectors.** Detectors count differently, so their percentages do not compare
directly. jscpd counts a token for each punctuation mark; `fallow` counts roughly half as many tokens for the
same code, so `minTokens: 50` here matches about `--min-tokens 25` there. `fallow` also treats a template or
regex literal as one token whatever its text, so it finds clones that differ only inside one, which jscpd
cannot. Compare involved shares, not the gate percentages.

## Working with deno lint

`unslop-ts` adds to `deno lint` and does not replace it. These rules hold for every pack:

- **No duplicate diagnostics.** No rule reports what a built-in rule already reports.
  `tests/deno_builtin_overlap_test.ts` reads the built-in list of the installed Deno and fails when a
  pack rule key equals a built-in code or a built-in fires on a case that the test does not declare.
  `no-typeof-escape` reports only an `as typeof` cast, and the built-in `no-explicit-any` reports `any`.
  `ban-ts-comment` covers `@ts-ignore` pragmas.
- **A file ignore hides everything.** `// deno-lint-ignore-file` suppresses every diagnostic of the
  file before any plugin rule runs, so no rule can report it, including a file ignore that names the
  rules that guard against ignores. A host that grades code it does not trust must reject
  `deno-lint-ignore-file` comments itself, before it runs the linter.
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
- `src/rules/whole_tree/` — the eight whole-tree checks, their option schemas, and `WHOLE_TREE_CHECKS`
  descriptors (metadata, controls, host command). The Deno-only entry `@dostark/unslop-ts/whole-tree`
  exports the duplicate, duplicate-code, constant-restatement, optional-parameter, unused-export, and
  magic-literal checkers so a host script can call them in-process.
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
