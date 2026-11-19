# API reference

The package publishes nine subpaths. Each section names the import, the main symbols, and the
errors it can throw. JSR renders the per-symbol signatures from the source comments.

## Root: `@dostark/unslop-ts`

The engine API. It imports only `zod`, so it runs on every host.

```ts
import { compileConfig, parseCatalog, PRESETS } from "@dostark/unslop-ts";
```

| Symbol                                                  | Purpose                                   | Returns            | Throws                        |
| ------------------------------------------------------- | ----------------------------------------- | ------------------ | ----------------------------- |
| `parseCatalog(input, options)`                          | Parse a version 1 catalog.                | `ICatalog`         | `CatalogError`                |
| `compileConfig(input, descriptor)`                      | Compile a version 2 configuration.        | `ICompiledConfig`  | `ConfigError`                 |
| `migrateCatalog(v1, descriptor)`                        | Convert a version 1 catalog to version 2. | `IMigrationResult` | `CatalogError`, `ConfigError` |
| `createRuleRegistry(packs)`                             | Build a registry from rule packs.         | `IRuleRegistry`    | `RuleRegistryError`           |
| `configJsonSchema()`                                    | Return the structural JSON Schema.        | `JsonValue`        | —                             |
| `PRESETS`, `PRESET_IDS`                                 | Preset definitions and ids.               | `Record` / array   | —                             |
| `ConfigV2Schema`, `RuleSettingSchema`                   | Zod schemas for validation.               | Zod schema         | —                             |
| `enableRule`, `disableRule`, `setOption`, `unsetOption` | Pure configuration edits.                 | New configuration  | `EditRefusalError`            |

## Deno: `@dostark/unslop-ts/deno`

The `deno lint` entry. It carries the Deno globals, so the ESLint and Oxlint entries never import
it.

```ts
import { createUnslopProject } from "@dostark/unslop-ts/deno";

const project = createUnslopProject({ descriptor, config });
export default project.plugin;
```

| Symbol                       | Purpose                                                    | Returns          |
| ---------------------------- | ---------------------------------------------------------- | ---------------- |
| `createUnslopProject(input)` | Compile a configuration into a `Deno.lint.Plugin` project. | `IUnslopProject` |

## ESLint: `@dostark/unslop-ts/eslint`

The flat-config plugin for ESLint 9 and later, below 11, on Node.js and Bun.

```ts
import { createEslintPlugin } from "@dostark/unslop-ts/eslint";

const plugin = createEslintPlugin([TYPESCRIPT_RULE_PACK]);
```

| Symbol                               | Purpose                           | Returns         | Throws               |
| ------------------------------------ | --------------------------------- | --------------- | -------------------- |
| `createEslintPlugin(packs, options)` | Build the plugin and its presets. | `IEslintPlugin` | `EslintAdapterError` |

A path-sensitive rule needs `settings.unslop` with its globs; the adapter refuses to guess.

## Report: `@dostark/unslop-ts/report`

Collect a host run into findings and coverage, and read or write the health report.

```ts
import { collectHealth, HealthReportSchema } from "@dostark/unslop-ts/report";
```

| Symbol                                              | Purpose                                             |
| --------------------------------------------------- | --------------------------------------------------- |
| `collectRunReport(input)`                           | Collect a host run into findings and rule coverage. |
| `collectHealth(input)`                              | Measure a project into a schema 2 health report.    |
| `HealthReportSchema`                                | Zod schema for the report.                          |
| `parseLcov(text)`                                   | Parse an LCOV file. Throws `LcovError`.             |
| `maintainabilityIndexOf`, `crapOf`, `healthScoreOf` | The metric functions.                               |

## Metrics: `@dostark/unslop-ts/metrics`

The complexity metric core.

```ts
import { createMeasurementContext, functionUnits } from "@dostark/unslop-ts/metrics";
```

| Symbol                             | Purpose                                                               |
| ---------------------------------- | --------------------------------------------------------------------- |
| `createMeasurementContext(source)` | Build the parser context for a source file. Throws `MetricCoreError`. |
| `functionUnits(context)`           | List the measurable function units.                                   |
| `measureFunction(unit)`            | Return cyclomatic, cognitive, and line metrics.                       |

## Whole-tree: `@dostark/unslop-ts/whole-tree`

The whole-tree entry exports the in-process implementations of the duplicate and unused checks, the magic-literal
detector, and the cycle report types. The package root exports `WHOLE_TREE_CHECKS` and `parseWholeTreeSettings`. Every
check also runs through the whole-tree CLI, and the cycle check runs only through that CLI.

```ts
import { parseWholeTreeSettings, WHOLE_TREE_CHECKS } from "@dostark/unslop-ts";
import type { ICycleFinding } from "@dostark/unslop-ts/whole-tree";
```

`WHOLE_TREE_CHECKS` maps each check id to its metadata, option schema, controls, and host command.

## CLI: `@dostark/unslop-ts/cli`

The `unslop` command entry. It parses arguments, loads a local project, and dispatches the read and
write routes. Once the registry release is published, install it with
`deno install --global ... jsr:@dostark/unslop-ts/cli`; until then, install `../../src/cli/unslop.ts`
with `--config=deno.json`.

## CLI ceiling: `@dostark/unslop-ts/cli/rule_ceiling`

The per-package rule ceiling evaluation used by the repository's own size and complexity gates.

| Symbol                         | Purpose                       |
| ------------------------------ | ----------------------------- |
| `evaluateCeilings(input)`      | Compare counts with ceilings. |
| `ICeilingDelta`, `IEvaluation` | The comparison result shapes. |

## Deno policy: `@dostark/unslop-ts/deno-policy`

Build an offline Deno lint policy directory from a version 2 configuration.

```ts
import { buildDenoPolicy } from "@dostark/unslop-ts/deno-policy";

const report = await buildDenoPolicy({ config: "unslop.config.json", packs: ["typescript"], out: "policy" });
```

| Symbol                                     | Purpose                              | Throws            |
| ------------------------------------------ | ------------------------------------ | ----------------- |
| `buildDenoPolicy(options)`                 | Write the policy files and manifest. | `DenoPolicyError` |
| `IDenoPolicyManifest`, `IDenoPolicyReport` | Manifest and result shapes.          | —                 |

## Errors and exit codes

The error classes are listed in [Troubleshooting](../troubleshooting.md). The CLI exit codes are
`0` success, `1` invalid content or a failed write, and `2` usage or a refused destination.
