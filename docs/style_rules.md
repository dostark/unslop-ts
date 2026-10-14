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

## Type Safety

| Tag                           | Severity | Rule (CODE_STYLE.md) | What it detects                                             |
| ----------------------------- | -------- | -------------------- | ----------------------------------------------------------- |
| `[explicit-any-array]`        | error    | §1                   | `: any[]` type annotation                                   |
| `[explicit-unknown]`          | error    | §1                   | `: unknown` as a stored type (outside `catch`)              |
| `[explicit-unknown-array]`    | error    | §1                   | `: unknown[]` type annotation                               |
| `[unknown-type-alias]`        | error    | §1                   | Type alias that renames raw `unknown`                       |
| `[promise-response-alias]`    | error    | §1                   | Type alias that masks `Promise<Response>`                   |
| `[promise-response-return]`   | error    | §1                   | `Promise<Response>` as a return type                        |
| `[ts-suppression-pragmas]`    | error    | §1                   | `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` pragmas     |
| `[deno-lint-no-explicit-any]` | error    | §1                   | `// deno-lint-ignore no-explicit-any` comment               |
| `[explicit-any-cast]`         | error    | §1                   | `as any` cast (production files only)                       |
| `[typeof-cast]`               | error    | §1                   | `as typeof <var>` cast (except `globalThis.fetch` in tests) |
| `[record-any]`                | error    | §1                   | `Record<string, any>` type                                  |
| `[record-unknown]`            | error    | §1                   | `Record<string, unknown>` type                              |
| `[index-signature-unknown]`   | error    | §1                   | `{ [key: string]: unknown }` index signature                |

---

## Import Rules

| Tag                                      | Severity | Rule | What it detects                                                            |
| ---------------------------------------- | -------- | ---- | -------------------------------------------------------------------------- |
| `[import-inside-statement]`              | error    | §3   | `import(...)` nested inside a function, condition, or loop                 |
| `[dynamic-import]`                       | warn     | §3   | `import(...)` without a rationale comment above it                         |
| `[inline-type-import]`                   | error    | §3   | `import("./foo").IFoo` inside a type annotation                            |
| `[re-export-imported]`                   | error    | §3   | Re-exporting an imported entity outside `mod.ts` / `index.ts`              |
| `[package-entrypoint-root-src-reexport]` | error    | §3   | Package entrypoint (`mod.ts`) re-exporting from retired root `src/*` paths |
| `[no-interface-rename-on-import]`        | error    | §3   | Aliasing an `I`-prefixed interface on import (e.g., `IFoo as Foo`)         |
| `[import-placement]`                     | error    | §7   | Import declared after an interface/type or after functional code           |

---

## Magic Values

| Tag                  | Severity | Rule | What it detects                                                    |
| -------------------- | -------- | ---- | ------------------------------------------------------------------ |
| `[magic-union-type]` | error    | §2   | Inline string literal union (e.g. `"a" \| "b"`) in production code |

> **Related:** [CODE_STYLE.md §2](../../../CODE_STYLE.md#no-magic-values) also covers
> `configurable()` wrapping guidelines for tunable `DEFAULT_*` constants (in any
> package) and the `check:config-keys` CI gate that prevents duplicate config
> keys across all packages. Use `resolveConfigurableBounds(key)` in schemas
> instead of importing separate MIN/MAX named constants.

---

## Module Structure

| Tag                              | Severity | Rule | What it detects                                                        |
| -------------------------------- | -------- | ---- | ---------------------------------------------------------------------- |
| `[module-header]`                | warn     | §7   | File has no descriptive header comment                                 |
| `[module-header-tag]`            | error    | §7   | Header is missing a mandatory tag (`@module`, `@path`, `@description`) |
| `[exported-interface-naming]`    | error    | §5   | Exported interface name does not start with a capital `I`              |
| `[exported-interface-placement]` | error    | §5   | Exported interface declared after functional code                      |
| `[max-params]`                   | error    | §11  | Function or method with more than 7 parameters                         |

---

## Comment Discipline

| Tag                    | Severity | Rule | What it detects                                                                                                  |
| ---------------------- | -------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `[long-comment]`       | warn     | §16  | Block comment or line-comment run longer than 3 lines outside the header                                         |
| `[ephemeral-comment]`  | warn     | §16  | Comment contains a calendar date or mentions a phase/step number, GAP identifier, pre/post-gap, or prior attempt |
| `[decorative-comment]` | warn     | §16  | Comment line uses a repeated-punctuation separator or dash-wrapped text                                          |

All three escalate to `error` under `--convert-warnings-to-errors`. Date
detection applies to every comment, including inline and module-header
comments; the other checks exempt the module's own leading header comment.

---

## Edition Boundary

| Tag                                      | Severity | What it detects                                                                                                                                                                                                         |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[edition-conditional-outside-composer]` | error    | `edition ===` / `EXAIX_EDITION` outside the edition composer                                                                                                                                                            |
| `[edition-leak]`                         | error    | Lower-edition module imports a higher edition (Solo → Team/Enterprise, Team → Enterprise); exempt only: type-only imports, and `editionType`-guarded dynamic `import("@exaix-team/...")` in `apps/daemon`/`apps/exactl` |

> `[edition-leak]` supersedes the former `[mit-team-import]` rule (which only covered `packages/` → Team).
> It is the enforceable bundle guarantee for the **source-run deploy** — every upper-edition reference
> must be type-only or `editionType`-guarded-dynamic, so a Solo run never loads Team code. (`deno compile`
> binaries still bundle Team code regardless; see CODE_STYLE.md → Edition Tier Import Boundary.)
>
> **Companion graph gate (`scripts/check_edition_graph.ts`, task `check:edition-graph`).** Because
> `[edition-leak]` is a source-text regex rule, a bug in its parsing — a specifier shape it fails to
> match, a guard it mis-reads — could let a real leak through silently. The graph gate is an
> independent, AST-grounded double-check: it resolves the daemon + exactl module graphs via
> `deno info --json` and fails on any **static (non-dynamic) runtime `code` edge** into a higher
> edition tier. It mirrors the static rule's exemptions exactly (edition-gated dynamic edges and
> type-only edges are not leaks), so the two gates agree on a clean tree (verified 0). It runs in
> CI Gate 3b, in `scripts/ci.ts check`, and in the pre-commit hook, right after `check:style`.

---

## Package & Tests Boundary

| Tag                       | Severity | What it detects                                                                 |
| ------------------------- | -------- | ------------------------------------------------------------------------------- |
| [package-tests-boundary]` | error    | A deployable module (`packages/`, `exaix-team/`, `apps/`) imports from `tests/` |

---

## Scripts

| Tag                  | Severity | Rule | What it detects                                              |
| -------------------- | -------- | ---- | ------------------------------------------------------------ |
| `[script-shebang]`   | error    | §12  | Script in `scripts/` missing `#!/usr/bin/env -S deno run -A` |
| `[script-usage]`     | error    | §12  | Script header missing a `Usage:` section                     |
| `[script-placement]` | error    | §12  | Debug/temp script (`debug_*`, `tmp_*`) inside `scripts/`     |

---

## TUI Boundary

| Tag                           | Severity | Rule | What it detects                                                     |
| ----------------------------- | -------- | ---- | ------------------------------------------------------------------- |
| `[tui-boundary-cli]`          | error    | §8   | TUI module importing from `apps/exactl/src/`                        |
| `[tui-boundary-services]`     | error    | §8   | TUI module importing from retired `src/services/` (except adapters) |
| `[tui-boundary-config]`       | error    | §8   | TUI module importing from retired `src/config/`                     |
| `[tui-boundary-helpers]`      | error    | §8   | TUI module importing from retired `src/helpers/`                    |
| `[core-boundary-tui-helpers]` | error    | §8   | Non-TUI module importing from `apps/tui/src/helpers/`               |

---

## CLI Boundary

| Tag                           | Severity | Rule | What it detects                                                                     |
| ----------------------------- | -------- | ---- | ----------------------------------------------------------------------------------- |
| `[cli-boundary-services]`     | error    | §9   | CLI command/handler/formatter importing from retired `src/services/` (not adapters) |
| `[cli-boundary-config]`       | error    | §9   | CLI command/handler/formatter importing from `packages/core/src/config/service.ts`  |
| `[core-boundary-cli-helpers]` | error    | §9   | Non-CLI module importing from `apps/exactl/src/helpers/`                            |

---

## Package Boundaries

These tags enforce that files under `packages/<name>/` remain self-contained.
See [CODE_STYLE.md §4](../../../CODE_STYLE.md#package-test-boundaries) for the test
boundary rules and [§13](../../../CODE_STYLE.md#package-module-purity) for the
module purity rules.

| Tag                                   | Severity | What it detects                                                                                |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `[package-boundary]`                  | error    | Package file importing from `src/`, `tests/`, or another package via relative path             |
| `[package-src-boundary]`              | error    | Package file importing a retired root implementation path                                      |
| `[package-related-files-boundary]`    | error    | Package module `@related-files` header pointing at a retired root path                         |
| `[package-subpath-promotion]`         | error    | Parent package entrypoint (`mod.ts`) re-exporting a canonical subpackage surface               |
| `[package-testing-import]`            | error    | Test file deep-importing from `packages/<name>/tests/` when `@exaix/<name>/testing` exists     |
| `[package-canonical-import]`          | error    | File importing a package path that should use a declared `@exaix/...` alias instead            |
| `[package-instantiates-event-logger]` | error    | Package `src/` file calling `new EventLogger(` (see §13 — package module purity)               |
| `[package-concrete-logger-type]`      | warn     | Package `src/` file importing concrete `EventLogger` class instead of `IEventLogger` (see §13) |
| `[package-uses-config-reader]`        | warn     | Package `src/` file calling `getValidatedEnvOverrides()` or `new ConfigService(` (see §13)     |

---

## Test Quality

| Tag                               | Severity | What it detects                                                                  |
| --------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `[test-inline-multiline-fixture]` | warn     | Inline multiline YAML/Markdown/JSON fixture in a test file (move to `fixtures/`) |

---

## Cross-Domain Dependency Analysis

Two structural AST checks — no hardcoded symbol names. Both use the TypeScript compiler API
to parse imports and walk the AST.

### Concrete class instantiation

| Tag                       | Severity | Rule | What it detects                                                                              |
| ------------------------- | -------- | ---- | -------------------------------------------------------------------------------------------- |
| `[concrete-cross-domain]` | warn     | §15  | File value-imports a class from a different domain package and instantiates it via `new X()` |

Detects when a package-pure file bypasses DI by importing and `new`-ing a concrete class from
another domain package. The fix is to accept an interface via constructor injection instead.

**Current results**: 11 warnings — `ExecutionLoop` (3), `FlowRunner` (3), `RequestProcessor` (3),
`PortalKnowledgeService` (1), `ToolRegistry` (1).

### Bare constant import

| Tag                     | Severity | Rule | What it detects                                                                                            |
| ----------------------- | -------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `[layer-constant-leak]` | warn     | §15  | File value-imports a constant-like symbol from a different domain package (not used as class, enum, or fn) |

Detects raw constants (`DEFAULT_GIT_*`, `GIT_CMD_*`, `DEFAULT_MCP_*`, etc.) imported across
domain boundaries — low-level values that belong behind the service that owns them.

**Current results**: 18 warnings across several files.

### How both checks work

1. Parse all import declarations; build a map of imported names → source packages
2. Names used as `new X(...)` → emit `[concrete-cross-domain]`
3. Names used as `X.Y` (property access) or `X(...)` (function call) → removed from constant set
4. Remaining names → emit `[layer-constant-leak]`

**Exempt packages**: `@exaix/core/*`, `@exaix/schemas`, `@exaix/ai`, `@exaix/cli`, `@exaix/tui`,
`@exaix/testing`.

**Full rule and remediation**: [CODE_STYLE.md §15](../../../CODE_STYLE.md#layer-aware-constant-imports).

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
