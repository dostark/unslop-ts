---
title: "check_code_style.ts — Error Tag Reference"
description: Complete reference for all error and warning tags emitted by packages/lint-rules/src/exaix/check_code_style.ts
agent_priority: reference
copilot_knowledge_base: true
version: 1.0
capabilities: [error_tags, boundary_rules, import_rules]
links:
  - "packages/lint-rules/src/exaix/check_code_style.ts"
  - "CODE_STYLE.md"
  - "ARCHITECTURE.md"
---

# `check_code_style.ts` — Error Tag Reference

This document is the companion reference for `packages/lint-rules/src/exaix/check_code_style.ts`.
It lists every error and warning tag the script emits, the rule that governs
it, and where to read the full definition.

Run the checker:

```bash
deno run -A packages/lint-rules/src/exaix/check_code_style.ts          # scan whole repo
deno run -A packages/lint-rules/src/exaix/check_code_style.ts packages/ # scan a subtree
deno run -A packages/lint-rules/src/exaix/check_code_style.ts --convert-warnings-to-errors
```

---

<!-- BEGIN GENERATED RULE REFERENCE -->

## Rule reference

| Rule                                       | Engine | Severity | Scope | Tags                             | Limits                                                                                     |
| ------------------------------------------ | ------ | -------- | ----- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `cli-boundary-config`                      | script | error    | all   | `boundary`, `cli`                | —                                                                                          |
| `cli-boundary-services`                    | script | error    | all   | `boundary`, `cli`                | —                                                                                          |
| `concrete-cross-domain`                    | script | warn     | prod  | `boundary`, `di`                 | —                                                                                          |
| `core-boundary-cli-helpers`                | script | error    | all   | `boundary`, `cli`, `package`     | —                                                                                          |
| `core-boundary-tui-helpers`                | script | error    | all   | `boundary`, `tui`, `package`     | —                                                                                          |
| `decorative-comment`                       | script | warn     | all   | `comments`                       | —                                                                                          |
| `deno-lint-no-explicit-any`                | script | error    | all   | `type-safety`                    | —                                                                                          |
| `dynamic-import`                           | script | warn     | all   | `imports`                        | —                                                                                          |
| `edition-conditional-outside-composer`     | script | error    | prod  | `edition`, `boundary`            | —                                                                                          |
| `edition-leak`                             | script | error    | prod  | `edition`, `boundary`            | Reads source text; check:edition-graph is its resolved-graph double check.                 |
| `ephemeral-comment`                        | script | warn     | all   | `comments`                       | —                                                                                          |
| `exaix/no-any-escape`                      | plugin | off      | all   | `type-safety`, `deslop`          | The typeof target is compared as source text; only test files may use an allowed target.   |
| `exaix/no-boolean-assert`                  | plugin | off      | test  | `test-quality`, `deslop`         | Only a direct call subject is matched; a message argument does not clear the report.       |
| `exaix/no-chained-type-assertions`         | plugin | error    | all   | `type-safety`, `deslop`          | Imported aliases are not resolved; only syntactic assertions in this file are seen.        |
| `exaix/no-conditional-empty-object-spread` | plugin | off      | prod  | `type-safety`, `deslop`          | Only a conditional with an empty object branch is checked.                                 |
| `exaix/no-explicit-unknown`                | plugin | off      | all   | `type-safety`, `deslop`          | Imported aliases are not resolved; only syntactic shapes in this file are seen.            |
| `exaix/no-object-parameters`               | plugin | off      | all   | `type-safety`, `deslop`          | A union member or a local alias of object is resolved; an imported alias is not.           |
| `exaix/no-pass-through-type-alias`         | plugin | off      | all   | `type-safety`, `deslop`          | Only aliases that name another top-level local alias are reported.                         |
| `exaix/no-runtime-typeof`                  | plugin | off      | prod  | `type-safety`, `deslop`          | An existence probe against "undefined" is allowed.                                         |
| `exaix/no-unsafe-dictionary`               | plugin | off      | all   | `type-safety`, `deslop`          | Only the literal value type is checked; a value alias from another module is not resolved. |
| `exaix/require-safety-comment`             | plugin | off      | prod  | `type-safety`, `deslop`          | Only non-const assertions in production files are checked.                                 |
| `exported-interface-naming`                | script | error    | all   | `di`                             | —                                                                                          |
| `exported-interface-placement`             | script | error    | all   | `di`, `module-structure`         | —                                                                                          |
| `import-inside-statement`                  | script | error    | all   | `imports`                        | —                                                                                          |
| `import-placement`                         | script | error    | all   | `imports`, `module-structure`    | Line-based; a multi-line type re-export can be read as a type definition.                  |
| `inline-type-import`                       | script | error    | all   | `imports`                        | —                                                                                          |
| `layer-constant-leak`                      | script | warn     | prod  | `boundary`                       | AST-based over this file only; dynamic imports and re-exports are not followed.            |
| `long-comment`                             | script | warn     | all   | `comments`                       | —                                                                                          |
| `magic-union-type`                         | script | error    | prod  | `magic-values`                   | —                                                                                          |
| `max-params`                               | script | error    | all   | `complexity`, `module-structure` | —                                                                                          |
| `module-header`                            | script | warn     | all   | `module-structure`               | —                                                                                          |
| `module-header-tag`                        | script | error    | all   | `module-structure`               | —                                                                                          |
| `no-interface-rename-on-import`            | script | error    | all   | `imports`, `di`                  | —                                                                                          |
| `package-boundary`                         | script | error    | prod  | `package`, `boundary`            | —                                                                                          |
| `package-canonical-import`                 | script | error    | prod  | `package`, `imports`             | —                                                                                          |
| `package-concrete-logger-type`             | script | warn     | prod  | `package`, `di`                  | —                                                                                          |
| `package-entrypoint-root-src-reexport`     | script | error    | all   | `imports`, `package`             | —                                                                                          |
| `package-instantiates-event-logger`        | script | error    | prod  | `package`, `di`                  | —                                                                                          |
| `package-related-files-boundary`           | script | error    | prod  | `package`, `boundary`            | —                                                                                          |
| `package-src-boundary`                     | script | error    | prod  | `package`, `boundary`            | —                                                                                          |
| `package-subpath-promotion`                | script | error    | prod  | `package`, `boundary`            | —                                                                                          |
| `package-testing-import`                   | script | error    | test  | `package`, `test-quality`        | —                                                                                          |
| `package-uses-config-reader`               | script | warn     | prod  | `package`, `di`                  | —                                                                                          |
| `promise-response-alias`                   | script | error    | all   | `type-safety`                    | —                                                                                          |
| `promise-response-return`                  | script | error    | all   | `type-safety`                    | —                                                                                          |
| `re-export-imported`                       | script | error    | all   | `imports`                        | —                                                                                          |
| `script-placement`                         | script | error    | all   | `scripts`                        | —                                                                                          |
| `script-shebang`                           | script | error    | all   | `scripts`                        | —                                                                                          |
| `script-usage`                             | script | error    | all   | `scripts`                        | —                                                                                          |
| `test-inline-multiline-fixture`            | script | warn     | test  | `test-quality`                   | —                                                                                          |
| `ts-suppression-pragmas`                   | script | error    | all   | `type-safety`                    | —                                                                                          |
| `tui-boundary-cli`                         | script | error    | all   | `boundary`, `tui`                | —                                                                                          |
| `tui-boundary-config`                      | script | error    | all   | `boundary`, `tui`                | —                                                                                          |
| `tui-boundary-helpers`                     | script | error    | all   | `boundary`, `tui`                | —                                                                                          |
| `tui-boundary-services`                    | script | error    | all   | `boundary`, `tui`                | —                                                                                          |

## Tag index

| Tag                | Description                                                    | Rules                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boundary`         | Cross-boundary import rules.                                   | `edition-conditional-outside-composer`, `edition-leak`, `tui-boundary-cli`, `tui-boundary-services`, `tui-boundary-config`, `tui-boundary-helpers`, `core-boundary-tui-helpers`, `cli-boundary-services`, `cli-boundary-config`, `core-boundary-cli-helpers`, `package-boundary`, `package-src-boundary`, `package-related-files-boundary`, `package-subpath-promotion`, `concrete-cross-domain`, `layer-constant-leak` |
| `cli`              | CLI isolation boundary (CODE_STYLE.md 9).                      | `cli-boundary-services`, `cli-boundary-config`, `core-boundary-cli-helpers`                                                                                                                                                                                                                                                                                                                                             |
| `comments`         | Comment discipline (CODE_STYLE.md 16).                         | `long-comment`, `ephemeral-comment`, `decorative-comment`                                                                                                                                                                                                                                                                                                                                                               |
| `complexity`       | Function and method size limits (CODE_STYLE.md 11).            | `max-params`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `deslop`           | Rule idea taken from maharshi365/deslop or dmmulroy/anti-slop. | `exaix/no-boolean-assert`, `exaix/require-safety-comment`, `exaix/no-runtime-typeof`, `exaix/no-conditional-empty-object-spread`, `exaix/no-explicit-unknown`, `exaix/no-unsafe-dictionary`, `exaix/no-any-escape`, `exaix/no-pass-through-type-alias`, `exaix/no-object-parameters`, `exaix/no-chained-type-assertions`                                                                                                |
| `di`               | Dependency injection and interfaces (CODE_STYLE.md 5).         | `no-interface-rename-on-import`, `exported-interface-naming`, `exported-interface-placement`, `package-instantiates-event-logger`, `package-concrete-logger-type`, `package-uses-config-reader`, `concrete-cross-domain`                                                                                                                                                                                                |
| `edition`          | Edition tier import boundary.                                  | `edition-conditional-outside-composer`, `edition-leak`                                                                                                                                                                                                                                                                                                                                                                  |
| `imports`          | Import shape and placement rules (CODE_STYLE.md 3).            | `import-inside-statement`, `dynamic-import`, `inline-type-import`, `re-export-imported`, `package-entrypoint-root-src-reexport`, `no-interface-rename-on-import`, `import-placement`, `package-canonical-import`                                                                                                                                                                                                        |
| `magic-values`     | No magic numbers or strings (CODE_STYLE.md 2).                 | `magic-union-type`                                                                                                                                                                                                                                                                                                                                                                                                      |
| `module-structure` | Module headers and placement (CODE_STYLE.md 7).                | `import-placement`, `module-header`, `module-header-tag`, `exported-interface-placement`, `max-params`                                                                                                                                                                                                                                                                                                                  |
| `package`          | Package structure and purity.                                  | `package-entrypoint-root-src-reexport`, `core-boundary-tui-helpers`, `core-boundary-cli-helpers`, `package-boundary`, `package-src-boundary`, `package-related-files-boundary`, `package-subpath-promotion`, `package-testing-import`, `package-canonical-import`, `package-instantiates-event-logger`, `package-concrete-logger-type`, `package-uses-config-reader`                                                    |
| `scripts`          | Utility script headers (CODE_STYLE.md 12).                     | `script-shebang`, `script-usage`, `script-placement`                                                                                                                                                                                                                                                                                                                                                                    |
| `test-quality`     | Rules on test code and fixtures.                               | `exaix/no-boolean-assert`, `package-testing-import`, `test-inline-multiline-fixture`                                                                                                                                                                                                                                                                                                                                    |
| `tui`              | TUI isolation boundary (CODE_STYLE.md 8).                      | `tui-boundary-cli`, `tui-boundary-services`, `tui-boundary-config`, `tui-boundary-helpers`, `core-boundary-tui-helpers`                                                                                                                                                                                                                                                                                                 |
| `type-safety`      | Rules that keep type evidence (CODE_STYLE.md 1).               | `exaix/require-safety-comment`, `exaix/no-runtime-typeof`, `exaix/no-conditional-empty-object-spread`, `exaix/no-explicit-unknown`, `exaix/no-unsafe-dictionary`, `exaix/no-any-escape`, `exaix/no-pass-through-type-alias`, `exaix/no-object-parameters`, `promise-response-alias`, `promise-response-return`, `ts-suppression-pragmas`, `deno-lint-no-explicit-any`, `exaix/no-chained-type-assertions`               |

## Analysis boundaries

| Rule                                       | Limits                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `edition-leak`                             | Reads source text; check:edition-graph is its resolved-graph double check.                 |
| `exaix/no-any-escape`                      | The typeof target is compared as source text; only test files may use an allowed target.   |
| `exaix/no-boolean-assert`                  | Only a direct call subject is matched; a message argument does not clear the report.       |
| `exaix/no-chained-type-assertions`         | Imported aliases are not resolved; only syntactic assertions in this file are seen.        |
| `exaix/no-conditional-empty-object-spread` | Only a conditional with an empty object branch is checked.                                 |
| `exaix/no-explicit-unknown`                | Imported aliases are not resolved; only syntactic shapes in this file are seen.            |
| `exaix/no-object-parameters`               | A union member or a local alias of object is resolved; an imported alias is not.           |
| `exaix/no-pass-through-type-alias`         | Only aliases that name another top-level local alias are reported.                         |
| `exaix/no-runtime-typeof`                  | An existence probe against "undefined" is allowed.                                         |
| `exaix/no-unsafe-dictionary`               | Only the literal value type is checked; a value alias from another module is not resolved. |
| `exaix/require-safety-comment`             | Only non-const assertions in production files are checked.                                 |
| `import-placement`                         | Line-based; a multi-line type re-export can be read as a type definition.                  |
| `layer-constant-leak`                      | AST-based over this file only; dynamic imports and re-exports are not followed.            |

<!-- END GENERATED RULE REFERENCE -->

---

## Exclusion Comments

Warnings (not errors) may be suppressed with a `// style-exclude:<CODE> - <rationale>` comment
on the line immediately above the flagged line. Valid codes are listed in each rule's
`exclusionCodes` entry in `scripts/config/style_rule_catalog.json`. Errors cannot be suppressed this way.

---

## Exemptions

The following locations are permanently exempt from specific package boundary rules:

| Exempt path            | Reason                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core/`       | Defines the runtime entities (`EventLogger`, `ConfigService`) that other packages must not use |
| `packages/mcp/server/` | Declared bridge zone — concrete runtime wiring between package contracts and the MCP server    |
| `tests/helpers/`       | Root testing compatibility shims — exempt from `re-export-imported` rule                       |
