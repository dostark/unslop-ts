# User guide

This guide takes you from an empty project to unslop-ts findings in CI. It is the narrative path;
the reference pages hold the field-by-field details. For why the package exists, read
[Why unslop-ts exists](concepts/motivation.md).

## Who this is for

You maintain a TypeScript project and want one set of rules that behaves the same under
`deno lint`, ESLint, and Oxlint. You do not need to read the engine internals.

## Before you start

- Deno 2.9, Node.js 24, or Bun 1.4, depending on the host you choose.
- A `deno.json` for the Deno host, or an ESLint or Oxlint configuration for the others.
- The package name is `@dostark/unslop-ts`.

## 1. Install

The registry release is pending. From the checkout root, install the CLI:

```sh
deno install --global --name unslop --allow-read --allow-env --config=deno.json ./src/cli/unslop.ts
```

Use `jsr:@dostark/unslop-ts/cli` instead of the path once the release is published. Add
`--allow-write` for edits and `--allow-run=deno` for `unslop report`.

For ESLint or Oxlint, install the package in that project. For the Deno host, add the package to
the project's import map or use the release plugin bundle described in
[Hosts and runtimes](how-to/hosts.md).

## 2. Configure

Create a version 2 configuration. This is the smallest useful one:

```json
{
  "version": 2,
  "plugin": "myproject",
  "extends": ["unslop:recommended"],
  "paths": {
    "test": ["**/*_test.ts"],
    "fixture": ["**/tests/fixtures/**"]
  },
  "rules": {
    "myproject/max-params": ["error", { "max": 5 }]
  }
}
```

- `extends` selects a preset. `unslop:recommended` is the small set; `unslop:strict` adds the
  stricter rules.
- `rules` enables, disables, or configures one rule. A bare id such as `unused-exports` names a
  whole-tree check; a prefixed id names a plugin rule.
- `paths` classifies test and fixture files so path-sensitive rules behave correctly.
- `docsBase` points a finding at your own guide.

Validate the file before you run a host:

```sh
unslop config validate
```

The message names the field that failed. The full field list is in
[Configuration](reference/config.md).

## 3. Run in your host

- **Deno:** write the descriptor and plugin entry, register the entry in `deno.json` under
  `lint.plugins`, then run `deno lint`. See [Hosts and runtimes](how-to/hosts.md).
- **ESLint:** import `createEslintPlugin`, spread a preset after your baseline, then run ESLint.
  Use `--max-warnings 0` in a gate that must fail on warnings.
- **Oxlint:** add the plugin to `jsPlugins` and set `settings.unslop`; the integration is
  experimental and pinned.

The rules, messages, and suppression model are shared, so a finding means the same thing on every
host. See [Compatibility](compatibility.md) for the supported versions.

## 4. Run a selected set of rules

Selection narrows a run to the rules you name. It never enables a rule the configuration turned
off, except an opt-in rule you name explicitly.

Find the ids first:

```sh
unslop rules list --status=parked       # opt-in rules you can select
unslop presets show unslop:recommended  # the ids a preset enables
```

### Deno host

Set `<PLUGIN>_LINT_RULES`, where `<PLUGIN>` is the configuration's `plugin` value in upper case. The
value is a comma-separated list of full ids, unambiguous bare keys, or `tag:<tag>` tokens:

```sh
# two rules by bare key
DEMO_LINT_RULES="max-params,no-explicit-unknown" deno lint

# full ids, including a whole-tree check
DEMO_LINT_RULES="demo/max-params,unused-exports" deno lint

# every rule tagged "comments"
DEMO_LINT_RULES="tag:comments" deno lint
```

An empty value means no selection: every configured rule keeps its own level.

### CLI queries and edits

`--select` and `--profile` replace the selection variable for one CLI call:

```sh
unslop rules list --select=max-params,unused-exports
unslop rules show max-params
unslop rules list --profile=ci
```

A profile is a named selector list in the configuration:

```json
"profiles": { "ci": ["tag:comments", "max-params"] }
```

`unslop report` passes the same selection to the host it runs.

### ESLint and Oxlint

Those adapters read rule levels from their own configuration, so select there:

```js
// eslint.config.mjs
{ rules: { "unslop/max-params": "error", "unslop/no-explicit-unknown": "off" } }
```

```json
// .oxlintrc.json
{ "rules": { "unslop/max-params": "error" } }
```

A preset sets `warn`; a later object overrides it. Selection narrows a run; it never widens a
configuration that disabled a rule.

## 5. Use the CLI

| You want to                         | Command                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| See every rule and its status       | `unslop rules list`                                                      |
| Inspect one rule and its options    | `unslop rules show <id>`                                                 |
| Turn a rule on or off               | `unslop rules enable <id>` / `unslop rules disable <id> --reason=<text>` |
| Change one option                   | `unslop rules set <id> <option>=<json>`                                  |
| Remove one override                 | `unslop rules unset <id> <option>`                                       |
| See what a preset enables           | `unslop presets show unslop:recommended`                                 |
| Validate or print the configuration | `unslop config validate` / `unslop config print --resolved`              |
| Measure the project                 | `unslop health`                                                          |
| Check per-rule coverage             | `unslop report --format=markdown src`                                    |
| Convert a version 1 catalog         | `unslop migrate --descriptor=<entry> --from=<v1> --out=<path>`           |

Read commands and dry runs need no write permission. A real edit, a migration, or `unslop report`
needs the write or run permission the [Command line](reference/cli.md) page lists.

## 6. Read and act on a finding

A finding carries a rule id, a message, an optional hint, and a source location. Fix the code, or
suppress the finding with a reason. A suppression without a reason is itself a finding.

| Host   | One line                                       | Whole file                                  |
| ------ | ---------------------------------------------- | ------------------------------------------- |
| Deno   | `// deno-lint-ignore <code> -- reason`         | `// deno-lint-ignore-file <code> -- reason` |
| ESLint | `// eslint-disable-next-line <rule> -- reason` | `/* eslint-disable <rule> -- reason */`     |
| Oxlint | `// oxlint-disable-next-line <rule> -- reason` | `/* oxlint-disable <rule> -- reason */`     |

A rule that is `parked` is off until you select it; `off` means it cannot be selected on. The
statuses and the selection rules are in [Rules and presets](reference/rules.md).

## 7. Add it to CI

Run the host command in CI and let its exit code gate the build:

```sh
deno lint
npx eslint .
npx oxlint
```

ESLint exits `0` when it reports only warnings; add `--max-warnings 0` to fail on them. For the
CLI, exit code `1` means invalid content or a failed write, and `2` means a usage or destination
refusal.

Keep the configuration validated in CI too:

```sh
unslop config validate
```

## 8. Measure and report

`unslop health` prints the schema 2 report with complexity, maintainability, CRAP, duplication,
history, and class-design signals. Use `--min-score` to gate the project score, and `--coverage`
with an LCOV file when coverage is available.

`unslop report` runs a real host and reports per-rule coverage, so you can see which rules actually
fired. Use `--format=markdown` for a pull-request comment or `--format=sarif` for a code-scanning
upload.

## 9. Migrate from version 1

Run `unslop migrate` with the project descriptor and the version 1 catalog. The command writes a
new version 2 file and a separate layout file; it never overwrites an input or an existing
destination. The mapping and the rollback conditions are in [Migration](how-to/migration.md).

## 10. Troubleshoot

Most startup failures are a configuration field, a refused edit, or a host adapter setting. The
error class and the fix are in [Troubleshooting](troubleshooting.md).

## Where to go next

- [Tutorial](tutorial.md) — the shortest end-to-end run.
- [Configuration](reference/config.md) — every field, default, and validation rule.
- [Command line](reference/cli.md) — every command group and flag.
- [Rules and presets](reference/rules.md) — the rule ids and preset memberships.
- [Whole-tree checks](reference/whole-tree-checks.md) — the eight project-wide checks.
- [API reference](reference/api.md) — the programmatic surface.
- [Architecture](concepts/architecture.md) — how a rule reaches a diagnostic.
- [Comparison with other linters](concepts/comparison.md) — where it overlaps one and when to
  prefer it.
