# unslop-ts

A TypeScript lint rule engine that runs the same rules under `deno lint`, ESLint 9 and later, and
Oxlint, on Deno, Node.js, and Bun. The rule set, the messages, and the suppression model are shared,
so a finding means the same thing in every host.

For `deno lint`, the engine compiles a validated version 2 configuration into a `Deno.lint.Plugin`
that runs inside `deno lint`. For ESLint and Oxlint, it exports a flat-config plugin and presets that
add the same rules to an existing configuration without changing a foreign diagnostic. A small CLI
lists and explains rules, edits supported settings, migrates a version 1 catalog, and exports a host
fragment.

The engine ships two rule packs. `TYPESCRIPT_RULE_PACK` holds 40 rules for type evidence, imports,
module layout, comments, interface conventions, test assertions, and size limits. `DENO_RULE_PACK`
holds 4 rules about `deno-lint-ignore` comments and Deno script headers. Every rule declares its
description, category, guide anchor, preset membership, and overlaps in code. A project can add its
own rule packs and script checks, so project-specific rules stay in the project.

## Install

```sh
deno install --global --name unslop --allow-read --allow-env jsr:@dostark/unslop-ts/cli
```

## Documentation

- [User guide](docs/user-guide.md) — install, configure, run, and read findings.
- [Tutorial](docs/tutorial.md) — a first end-to-end run.
- [Hosts and runtimes](docs/how-to/hosts.md) — Deno, ESLint, Oxlint, Biome.
- [Configuration](docs/reference/config.md) — every version 2 field.
- [Command line](docs/reference/cli.md) — every command group and flag.
- [Rules and presets](docs/reference/rules.md) — rule ids, presets, options.
- [Whole-tree checks](docs/reference/whole-tree-checks.md) — the eight checks.
- [Report schema](docs/reference/report-schema.md) — report and health fields.
- [API reference](docs/reference/api.md) — package subpaths and signatures.
- [Architecture](docs/concepts/architecture.md) — the pipeline and module boundaries.
- [Comparison with other linters](docs/concepts/comparison.md) — overlaps and when to use it.
- [Migration](docs/how-to/migration.md) — version 1 to version 2.
- [Editing](docs/how-to/editing.md) — read and write routes.
- [Lockfiles](docs/how-to/lockfiles.md) — lockfile behavior.
- [Troubleshooting](docs/troubleshooting.md) — error classes and fixes.
- [Compatibility](docs/compatibility.md) — supported versions.
- [Contributing](CONTRIBUTING.md) — setup and rule authoring.
- [Security](SECURITY.md) — reporting and trust model.
- [Changelog](CHANGELOG.md) — released changes.

## Preserved anchors

## Unused exports {#unused-exports}

See [Whole-tree checks](docs/reference/whole-tree-checks.md#unused-exports).

## Unused files from the manifests {#unused-files-manifest}

See [Whole-tree checks](docs/reference/whole-tree-checks.md#unused-files-manifest).

## License

MIT
