# Hosts and runtimes

## Hosts

| Host                             | Entry                                                                     | Runtime      | Status       |
| -------------------------------- | ------------------------------------------------------------------------- | ------------ | ------------ |
| `deno lint`                      | `@dostark/unslop-ts/deno` in `lint.plugins`, or the release plugin bundle | Deno         | supported    |
| ESLint 9.0.0 and later, below 11 | `@dostark/unslop-ts/eslint` as a plugin                                   | Node.js, Bun | supported    |
| Oxlint 1.88                      | the same ESLint plugin through `jsPlugins`                                | Node.js      | experimental |

The same rule modules run on every host. The conformance suite drives one case table
(`../../tests/cases/conformance.json`) through `deno lint`, ESLint on Node.js, ESLint on Bun, and Oxlint on
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

| Guarantee                                                            | Test                                                                                   | Hosts                                      | Command                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| 39 rules report the same result                                      | `tests_node/conformance.test.mjs`, `../../tests/conformance_test.ts`                   | ESLint/Node, ESLint/Bun, Oxlint/Node, Deno | `npm --prefix hosts run test:node`, `bun run --cwd hosts test:bun`, `deno task test` |
| Adapter works at the supported ESLint range                          | `tests_node/eslint_adapter.test.mjs`                                                   | ESLint 9.0.0, 9.39.5, 10.13.0              | `npm --prefix hosts run test:node`                                                   |
| Presets and fragments are additive                                   | `tests_node/additivity.test.mjs`, `../../tests/additivity_test.ts`                     | Deno, ESLint, Oxlint                       | `deno task test`, `npm --prefix hosts run test:node`                                 |
| Generated configuration matches the golden and refuses unsafe writes | `tests_node/host_config.test.mjs`, `../../tests/cli_config_test.ts`                    | Node.js, Bun, Deno                         | `npm --prefix hosts run test:node`, `deno task test`                                 |
| The real CLIs accept the plugin                                      | `tests_node/examples_integration.test.mjs`, `../../tests/examples_deno_bundle_test.ts` | Node.js, Bun, Deno                         | `npm --prefix hosts run test:node`, `bun run --cwd hosts test:bun`, `deno task test` |
| Both comment-aware rules handle three dialects                       | `tests_node/suppression_dialects.test.mjs`                                             | ESLint, Oxlint, Deno                       | `npm --prefix hosts run test:node`, `deno task test`                                 |
| Duplicate overlaps are declared and disabled                         | `tests_node/overlap.test.mjs`                                                          | ESLint, Oxlint                             | `npm --prefix hosts run test:node`                                                   |
| The package imports outside Deno                                     | `tests_node/runtime_import.test.mjs`, `tests_node/package_pins.test.mjs`               | Node.js, Bun                               | `npm --prefix hosts run test:node`, `bun run --cwd hosts test:bun`                   |

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

## Working with deno lint

`unslop-ts` adds to `deno lint` and does not replace it. These rules hold for every pack:

- **No duplicate diagnostics.** No rule reports what a built-in rule already reports.
  `../../tests/deno_builtin_overlap_test.ts` reads the built-in list of the installed Deno and fails when a
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
