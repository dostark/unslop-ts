# Rules and presets

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
[unused exports](whole-tree-checks.md#unused-exports) for the reports); `unused-files` warns until `--fail` (it starts the walk at
the entry points of `deno.json` and `package.json`, see [unused files](whole-tree-checks.md#unused-files-manifest)); `optional-params` warns until `--fail` or `--staged`. An exported
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

## Add a rule

1. Implement `create(context, ctx)` in `src/rules/<rule>.ts` and add the rule to `TYPESCRIPT_RULE_PACK`
   or `DENO_RULE_PACK` (`../../src/rules/mod.ts`) with its `meta`: description (at most 120 characters),
   category, guide anchor, preset membership, and limits.
1. Add its option schema to `TYPESCRIPT_OPTION_SCHEMAS` or `DENO_OPTION_SCHEMAS` in
   `../../src/rules/rule_options.ts`.
1. Add the anchor and the rule table row to `../style_guide.md`, and let the preset membership or an
   explicit project setting enable it. Do not add project data to the engine.
1. Add named valid and invalid cases in `tests/<rule>_test.ts`, and a case in
   `../../tests/deno_builtin_overlap_test.ts`. Run `../../tests/rule_meta_test.ts` and `../../tests/style_guide_claims_test.ts`.

## Rule ownership and guide links

The TypeScript pack owns generic checks, including configurable import-boundary zones and opt-in
interface conventions. Consumer names, paths, severities, and rule options belong in the project's
configuration. Default type-safety hints link to [the engine guide](../style_guide.md#strict-type-safety)
through the rule metadata; an explicit rule `docs` value replaces that link.

The Deno-only whole-tree entry exports the duplicate-type, duplicate-constant, and repeated-literal
checkers. A host script calls them in-process with compiled settings. These checks are library
functions, not per-file plugin rules, and their host modes remain authoritative.

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
| `unslop/max-cognitive-complexity`   | eslint            | `sonarjs/cognitive-complexity`  | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/max-function-lines`         | eslint            | `max-lines-per-function`        | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/max-file-lines`             | eslint            | `max-lines`                     | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/max-class-size`             | eslint            | `max-classes-per-file`          | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/ts-suppression-pragmas`     | typescript-eslint | `ban-ts-comment`                | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/max-params`                 | eslint            | `max-params`                    | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/exported-interface-naming`  | typescript-eslint | `naming-convention`             | related   | Both may run; the unslop rule is narrower and states the reason.               |
| `unslop/ignore-needs-reason`        | eslint-comments   | `require-description`           | duplicate | Turn one of the two off; `typescript-eslint-compat` turns the unslop rule off. |
| `unslop/no-forbidden-lint-ignore`   | eslint-comments   | `no-unlimited-disable`          | related   | Both may run; the unslop rule is narrower and states the reason.               |

<!-- END GENERATED OVERLAPS -->
