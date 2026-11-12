# Troubleshooting

Each entry names the error class, where it is raised, the usual cause, and the fix. Every class
extends `Error` and carries a field path or a refusal reason when one applies.

| Error                | Raised by                                                           | Usual cause                                                                                                                       | Fix                                                                                                     |
| -------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ConfigError`        | Version 2 configuration compilation (`../src/config/`)              | An invalid field, an unknown rule id, a plugin-prefix mismatch, a missing reason for `off` or `optIn`, or a level the host fixes  | Run `unslop config validate`; the message names the field. Compare it with the configuration reference. |
| `CatalogError`       | Version 1 catalog parsing (`../src/engine/catalog.ts`)              | An unknown tag, a missing implementation, invalid rule options, or a plugin severity other than `error` or `off`                  | Correct the catalog field named in the message.                                                         |
| `RuleRegistryError`  | Registry construction (`../src/engine/registry.ts`)                 | A duplicate or unknown rule id in a pack                                                                                          | Make every rule id unique and register the pack that owns it.                                           |
| `EditRefusalError`   | `rules enable`, `disable`, `set`, `unset` (`../src/config/edit.ts`) | A control the named host does not read, a plugin `warn` level, a missing reason, or an `unset` whose option has no engine default | Change the request to a supported control, or edit the configuration directly.                          |
| `EslintAdapterError` | ESLint and Oxlint adapter (`../eslint.ts`)                          | A path-sensitive rule runs without `settings.unslop` and its globs                                                                | Add `settings.unslop` with `testGlobs`, `fixtureGlobs`, and `ignoreGlobs`.                              |
| `SelectorError`      | Selection resolution (`../src/config/selectors.ts`)                 | An unknown rule id, tag selector, or profile token                                                                                | Check `unslop rules list`, the preset expansion, or the configured profiles.                            |
| `HostConfigError`    | Host fragment generation (`../src/config/to_host_config.ts`)        | A rule that the target host cannot represent, such as test scope for Oxlint                                                       | Narrow the rule for that host, or export the fragment for a supported host.                             |
| `DenoPolicyError`    | `unslop deno-policy` (`../src/cli/commands/deno_policy.ts`)         | A configuration or output directory the command cannot use                                                                        | Check the `--config` and `--out` paths and the requested packs.                                         |
| `WriteRefusalError`  | Write routes (`../src/cli/safe_write.ts`)                           | A refused destination, an existing file without overwrite, or a symlink                                                           | Choose a new output path, or pass the documented overwrite flag.                                        |
| `PartialWriteError`  | Migration pair write (`../src/cli/safe_write.ts`)                   | The second commit of a pair failed                                                                                                | The message names the surviving paths; remove only the files that invocation created.                   |
| `LcovError`          | LCOV parsing (`../src/report/lcov.ts`)                              | A malformed coverage record                                                                                                       | Regenerate the LCOV file, or run without `--coverage`.                                                  |
| `SnapshotError`      | Source capture (`../src/report/snapshot.ts`)                        | A source file changed or became unreadable during a report                                                                        | Re-run the report on a stable tree.                                                                     |
| `BoundedReadError`   | Bounded file read (`../src/report/bounded_io.ts`)                   | A file or subprocess output exceeded the byte or time limit                                                                       | Raise the documented limit, or narrow the scanned scope.                                                |
| `TraceProtocolError` | Trace parsing (`../src/engine/trace.ts`)                            | A malformed trace line from a host run                                                                                            | Re-run with tracing enabled; keep the failing line for a report.                                        |
| `MetricCoreError`    | Metric evaluation (`../src/metrics/estree.ts`)                      | A source shape the metric core cannot measure                                                                                     | Report the file and the rule; the report marks the signal unavailable.                                  |
| `CliError`           | CLI usage (`../src/cli/error.ts`)                                   | An unknown command, selector, profile, category, status, format, or entry                                                         | Read `unslop --help` and correct the argument.                                                          |

## Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| `0`  | Success.                                                                                    |
| `1`  | Invalid file content, a failed compilation or validation, or a failed write.                |
| `2`  | Unknown or unsupported usage, a refused destination, a non-local entry, or a JSONC refusal. |

The CLI accepts filesystem paths and local `file:` URLs only. It rejects `data:`, remote, and
registry schemes before import, and refuses a JSONC lint configuration instead of parsing it.

## First checks

1. Run `unslop config validate` and fix the field the message names.
2. Run `unslop rules list` and confirm the rule id and status.
3. Run the command with `--format=json` to see the structured error.
4. If the failure is a host adapter, compare the host version with
   [Compatibility](compatibility.md).
