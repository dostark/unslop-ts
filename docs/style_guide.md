---
title: "Package Style Guide"
description: Generic TypeScript style rules for @exaix/lint-rules, moved out of CODE_STYLE.md
agent_priority: mandatory
copilot_knowledge_base: true
capabilities: [linting_rules, naming_conventions]
links:
  - "packages/lint-rules/docs/style_rules.md"
---

> The generic TypeScript style rules. `CODE_STYLE.md` keeps the Exaix-specific rules and
> links here for these sections. Rule ids and severities come from
> `scripts/config/style_rule_catalog.json`.

## 1. Strict Type Safety {#strict-type-safety}

- **Every** variable, parameter, return value, and data structure **must** have an
  explicit type annotation. Never rely on implicit inference to avoid writing a
  type.
- **No `any`.** Explicit `any` and implicit `any` (from missing annotations) are
  forbidden. Use generics (`<T>`), named interfaces, or Zod-inferred types.
- **No `as any` casting.** Do not bypass the type system; use proper guards,
  narrowing, or define the correct type instead.
- **No `as typeof var` casting.** This is equivalent to `any` and defeats
  safety – define explicit interfaces or use proper inference.
- **No `unknown` as a stored type.** `unknown` may only appear briefly inside a
  `catch (e: unknown)` block or during runtime narrowing. It must **never** be
  used as a parameter type, return type, field type, or alias. Name the shape
  with an interface or a type alias instead.
- **No double casting (`... as unknown as ...`).** This pattern hides bugs and is
  prohibited. Use type guards or structural typing to narrow correctly.
- **No TypeScript suppression pragmas.** Never use `@ts-expect-error`,
  `@ts-ignore`, `@ts-nocheck`, or similar comments to bypass the compiler. All
  type errors must be resolved by writing correct types or refactoring the
  code; suppressing them defeats the purpose of TypeScript and is strictly
  prohibited. (This rule applies equally in test code.)
- **No lint ignores for `any`.** Never add
  `// deno-lint-ignore no-explicit-any` to silence problems. Address the root
  cause with proper typing.
- **No `Promise<Response>` return types.** Using `Promise<Response>` as a
  function return type is prohibited because it hides the actual response
  structure. Instead, define a specific interface describing the expected
  response shape and return `Promise<YourResponseType>`. This ensures callers
  have proper type information and prevents runtime errors from unexpected
  response formats.
- **No aliasing raw `unknown` or `Promise<Response>`.** Do not create type
  aliases that merely rename a weak type, such as `type UnknownValue = unknown;`
  or `type MockFetch = () => Promise<Response>;`. These fake aliases disguise
  poor typing and make it harder to reason about actual data shapes. Define the
  real structure explicitly with a named interface or type alias, or use runtime
  validation and narrow from `unknown` at the point of access.
- **No deceptive type aliases for mocks.** Do not create type aliases like
  `type MockFetch = () => Promise<Response>` to hide weak typing. This pattern
  is deceptive because it gives the appearance of strong typing while still
  obscuring the actual response structure. Instead:
  - Use `as typeof globalThis.fetch` when mocking fetch in tests – this
    preserves the actual fetch signature and is the recommended approach
  - Define interfaces with specific response types for custom mocks
  - Use dependency injection with properly typed interfaces
- **No `as typeof <var>` casting in production code.** Casting via
  `as typeof variable` is treated as an 'any' escape and is forbidden in
  production code. Exception: `as typeof globalThis.fetch` is allowed in test
  code for mocking the fetch API, as this preserves the correct type signature.
- **Intersection type extensions.** Casting that includes an intersection (e.g., `as typeof Deno & { ... }`) is permitted to extend global or core namespaces with additional properties.
- **Always name it.** If a type doesn't exist yet, create one explicitly. When
  the keys are known, prefer specific interfaces over `Record<string, …>`.
- **No `Record<string, any>`.** This type is extremely weak and effectively
  re-introduces `any` for every property. Define a precise interface or type
  alias describing the expected shape.

- **No `Record<string, unknown>` or `{ [key: string]: unknown }`.** Both are prohibited. Instead:
  - Define a specific interface describing the expected shape
  - Use a type alias for known structures (but not as a mask for `Record<string, unknown>` or `{ [key: string]: unknown }`)
  - Use generics with constraints when the structure varies
  - When the structure is truly dynamic, use a runtime schema validator (e.g., Zod) and narrow from `unknown` at the point of access

- **No masking type aliases.** Do not create type aliases that simply mask or rename `Record<string, unknown>` or `{ [key: string]: unknown }` (e.g., `type CopilotObject = Record<string, unknown>`). This is strictly prohibited. Always define a specific interface or use runtime validation and proper narrowing.

These rules are referenced by multiple existing checklists (pre‑commit, CI,
etc.). Enforcement differs by rule:

- **Gates (`severity: error`):** `exaix/no-chained-type-assertions`,
  `exaix/no-pass-through-type-alias`, and the style-checker rules
  `ts-suppression-pragmas`, `deno-lint-no-explicit-any`, `promise-response-alias`,
  and `promise-response-return`.
- **Parked (`severity: off`, opt-in):** `exaix/no-explicit-unknown`,
  `exaix/no-any-escape`, `exaix/no-unsafe-dictionary`, and
  `exaix/no-object-parameters`. The rule-ceiling ratchet holds each one at a
  measured count, so the count can only fall. Each rule becomes a gate when its
  count reaches zero.

### Automated Enforcement

A dedicated AST-based script (`packages/lint-rules/src/exaix/check_magic_values.ts`) scans the entire
codebase using the TypeScript compiler API to detect repeated literals that
should be extracted into named constants or enums. It is invoked as part of the
pre-commit gates via `deno task check:magic` (or directly:
`deno run -A packages/lint-rules/src/exaix/check_magic_values.ts`).

**Detection thresholds** (the script's actual defaults — keep this table in sync with
`packages/lint-rules/src/exaix/check_magic_values.ts` `--local-*-threshold` / `--global-*-threshold`):

| Scope  | String literals | Number literals |
| ------ | --------------- | --------------- |
| Module | > 3 occurrences | > 4 occurrences |
| Global | > 5 occurrences | > 6 occurrences |

**Whitelisted values (never flagged):**

- Strings: `""`, `" "`, `"\n"`, `"\t"`, `"true"`, `"false"`, `"null"`,
  `"undefined"`
- Numbers: `0`, `1`, `-1`, `100`, `1000`
- Strings shorter than 3 characters that don't start with a lowercase letter
  (e.g., `"ID"`, `"OK"` are allowed; `"ab"` is not flagged)

- **Magic string unions.** Avoid inline string literal unions (e.g., `"a" | "b"`)
  directly in functional code. These are difficult to maintain and track.
  Instead, define a TypeScript `enum` in the appropriate package or a shared named type alias.
  This rule is enforced as an error in production code.

### No Re-exporting

Exporting entities imported from other modules is prohibited. Each module must only export the entities it definitionally contains (classes, functions, interfaces, etc., defined within the file). This maintains clear module boundaries and avoids "barrel" files which can obfuscate the origin of symbols and complicate dependency analysis.

**Prohibited:**

```ts
export { Foo } from "./bar.ts"; // ❌ Inline re-export
export * from "./bar.ts"; // ❌ Wildcard re-export

import { Baz } from "./qux.ts";
export { Baz }; // ❌ Explicit re-export
```

**Allowed exception:** package entrypoint files like `mod.ts` or `index.ts` may re-export public interfaces, types, or values defined in other modules within the same package to expose the package's public API. This is only allowed for same-package modules owned by that package root surface; re-exporting from external packages, repo root retired `src/*` paths, or another package's source directories remains prohibited. This restriction is enforced as `[src-barrel-re-export]` for barrel files under the retired `src/`.

**Canonical subpackage boundary:** if the root import map exposes an exact canonical subpackage alias such as `@exaix/core/status` or `@exaix/ai/providers`, the parent package entrypoint must not promote that subpackage's exports through `@exaix/core` or `@exaix/ai`. Keep the boundary explicit: consumers import subpackage-owned symbols from the canonical subpackage barrel, not from the parent package barrel.

**Root-owned surface exception:** a package may still expose symbols from modules that define the parent package's primary root API even if the import map also offers a convenience grouping alias for that root-owned surface. In this repository, `@exaix/core/types` is treated as a root-owned grouping, so `@exaix/core` may continue to export those contracts.

```ts
// packages/core/mod.ts
export type { IToolRegistry } from "./src/interfaces/i_tool_registry.ts";
export type { IActivityRecord } from "./src/types/database.ts";
export { PortalOperation } from "./src/enums.ts";
```

**Prohibited in parent package entrypoints when a canonical subpackage barrel exists:**

```ts
// packages/core/mod.ts
export * from "./src/status/mod.ts"; // ❌ Import from @exaix/core/status instead
export { RetryPolicy } from "./src/request/retry_policy.ts"; // ❌ Import from @exaix/core/request instead
```

**Prohibited in package entrypoints:**

```ts
export * from "../../apps/other_app/src/some_export.ts";
```

Package entrypoints must only expose package-local source exports, not direct imports from other packages' source trees.

<a id="no-prod-tests-dependency"></a>

### Multi-line Named Imports

The style checker does not enforce a specific format for named imports. Use your judgment to balance readability and conciseness. `deno fmt` will automatically format imports according to its configured line width.

**Example:**

```ts
// Single-line for a few imports
import { BarService, FooService } from "./services.ts";

// Multi-line for many imports (optional, for readability)
import { BarService, BazService, FooService, QuuxService, QuxService } from "./services.ts";
```

### Dynamic Imports

Dynamic imports with `await import()` are **discouraged**. If you must use a dynamic import (for example, to load a large optional module, for conditional loading, or to break a circular dependency), you **must** document the rationale in a comment immediately above the import statement explaining why a static import is not possible or not desirable.

**Good:**

```ts
// Dynamic import required to break circular dependency between X and Y.
const { Y } = await import("./y.ts");
```

**Bad:**

```ts
// No explanation for dynamic import
const { join } = await import("@std/path");
```

The code style checker will strictly enforce that all imports appear at the top level. Dynamic imports should only be used when absolutely necessary and always provide a justification comment.

### No Inline Type Imports

Using `import(...)` inside a type annotation or return type — instead of a top-level `import type` statement — is **prohibited**. All imports, including type-only imports, must be explicit top-level declarations.

**Prohibited:**

```ts
// ❌ Inline import inside a type annotation
function foo(): Promise<import("./bar.ts").IBar | null> { ... }

// ❌ Inline import in a method return type
getKnowledge(alias: string): Promise<import("../shared/schemas/portal_knowledge.ts").IPortalKnowledge | null> { ... }
```

**Required:**

```ts
// ✅ Top-level import declaration
import type { IBar } from "./bar.ts";
import type { IPortalKnowledge } from "../shared/schemas/portal_knowledge.ts";

function foo(): Promise<IBar | null> { ... }
getKnowledge(alias: string): Promise<IPortalKnowledge | null> { ... }
```

The style checker enforces this as an **error** (`inline-type-import` rule).

### No Aliasing Interfaces on Import

Renaming interfaces during import (using the `as` keyword) to remove the `I` prefix or otherwise change their name is prohibited. Exported interfaces must be used with their original defined names to maintain consistency and clarity across the codebase.

**Prohibited:**

```ts
import { ILogEntry as LogEntry } from "./logger.ts"; // ❌ Removing I prefix
import { IRequest as UserRequest } from "./request.ts"; // ❌ Renaming interface
```

**Allowed:**

```ts
import { ILogEntry } from "./logger.ts";
import { IRequest } from "./request.ts";
```

If a naming conflict occurs, it is better to refactor the local names or the conflicting modules than to alias the interfaces.

**Exception:** Aliasing is permitted in `packages/core/src/parsing/markdown.ts` when used for backward compatibility shims or interface compatibility bridges.

Good:

```ts
import { join } from "@std/path";
import { MyService } from "./service.ts";

export class MyClass { ... }
```

Bad:

```ts
export class MyClass {
  async method() {
    const { join } = await import("@std/path");
    // …
  }
}
```

## 11. Function & Method Complexity {#complexity-rules}

- **Parameter Limit:** Functions and methods **must not** exceed **7 parameters**.
- If a method requires 8 or more parameters, it **must** be refactored to use:
  - A structured **Parameter Object** (a dedicated interface for the arguments).
  - A shared context object (like `IApplicationContext`).
  - Smaller, more focused methods.
- This rule applies to constructors, regular functions, and class methods alike. Refactoring into a parameter object improves readability, maintainability, and makes it easier to add optional parameters in the future.

### REDUNDANT_OPTIONAL — param is `?` but all callers pass it

A parameter declared optional that **every** production caller supplies a value
for should be required. The `?` misleads readers into thinking the caller has a
choice when in practice no caller ever omits it.

```ts
// ❌ REDUNDANT — all callers pass `logger`, so it's never truly optional
function doSomething(task: string, logger?: ILogger) { ... }
// call site: doSomething("x", logger)  ← always passes logger

// ✅ Correct — required parameter
function doSomething(task: string, logger: ILogger) { ... }
```

### UNUSED_OPTIONAL — param is `?`, used in body, but no caller passes it

The most dangerous pattern. A parameter is marked optional, referenced in the
function body (so changing it would change behavior), yet **zero** production
callers supply a value. This is either:

1. **A wiring gap** — the value was meant to be injected but never connected.
1. **Dead code** — the parameter is consumed by default-value logic that always
   fires. Either way, the `?` is a red flag.

```ts
// 🔴 UNUSED — body uses `delegateProviderEnv` but no caller passes it
async launch(launch: ISessionLaunch, traceId: string, delegateProviderEnv?: Record<string, string>) {
  const childEnv = delegateProviderEnv ? mergeDelegateEnv(sanitizedEnv, delegateProviderEnv) : sanitizedEnv;
  // ...
}
// all callers: launcher.launch(launch, traceId)  ← never passes delegateProviderEnv
```

### Guidelines

1. **Prefer required by default.** A parameter should only be `?` when there is
   at least one known production call site that omits it. Speculative
   "future-proofing" with `?` is the leading cause of both anti-patterns.

1. **Defaults are not optionality.** When a parameter has a default value but
   every production caller provides it anyway, remove the `?` and make it
   required. The default adds noise when it never triggers.

1. **`| undefined` is not optionality.** Writing `param: T | undefined` instead
   of `param?: T` does not make the parameter optional — callers must still
   pass `undefined` explicitly. Use `?` for true optionality, and add `Opt`
   to document why.

1. **Reveal root cause, don't use `?` as a Band-Aid.** If a function has too
   many parameters and you're tempted to mark some optional, refactor to a
   parameter object instead (see §11 parameter limit).

## 16. Comment Discipline {#comment-discipline}

Code must be self-explanatory in the vast majority of cases: clear naming,
small functions, and obvious control flow do the job a comment would
otherwise have to do. Insert a comment only when the code's quality would
genuinely be worse without it — a non-obvious invariant, a subtle
constraint, or a workaround for a specific bug, not a restatement of what
the next line already says.

- **No multiline in-module comments longer than three lines.** A block
  comment (`/* … */`, `/** … */`) or a run of consecutive `//` lines that
  spans more than three physical lines, anywhere past the module's own
  header comment, is a violation. If an explanation genuinely needs more
  than three lines, it belongs in the module's own documentation (a
  README, `ARCHITECTURE.md`, or the relevant `exaix-dev-docs/` doc) — not
  inline in the source.
- **No ephemeral implementation history.** A comment must not reference a
  plan phase/step number, a specific GAP identifier (e.g. `GAP-1`, `GAP #2`),
  pre/post-gap analysis notes, narrate what was tried and abandoned, or explain
  what previously didn't work. That belongs in the commit message and the
  phase-plan doc, which are the durable record of _why_; the code itself is
  only a record of _what it does now_. This does not apply to the module's
  own header comment, whose Implementation Plan reference is a distinct,
  mandatory field under §7.
- **No plan-phase numbers in test file names.** A test file's own name
  (`*_test.ts` / `*.test.ts`, or any file under a `tests/` directory) must
  not embed a numbered plan-phase reference (`phase147_...`,
  `phase_2_...`) — the same ephemeral-history problem as in a comment,
  just moved into the path. Name the file after the behavior it verifies;
  the phase-plan doc is the durable record of which phase introduced it.
  This does **not** apply to the bare word "phase" or to "step" in any
  form (with or without a number) — "step" is an established domain term
  in this codebase (flow/execution steps, `PhaseStepManifestParser`, step
  durability) independent of plan-phase numbering, and banning it would
  flag dozens of correctly-named files.
- **No calendar dates in any comment.** Dates are ephemeral context and must
  not survive in code comments in numeric, ISO, compact, named-month,
  month/year, quarter/year, or date-time form. Put time-specific history in
  version control or project documentation. Unlike the other in-module
  comment-discipline rules, this applies to inline comments and the module's
  own header comment as well as standalone line and block comments. Date-shaped
  runtime strings and other executable data are not comments and remain valid.
- **No document-section references.** A comment must not cite a section
  number via the `§` symbol — neither a phase-plan/spec section (e.g. `§5.9`,
  `(§6.1, F12)`) nor a section of this file or another project doc (e.g.
  `CODE_STYLE.md §15`). Restate the rule or rationale in the comment's own
  words instead of pointing at a section number, which drifts silently as
  documents are restructured.
- **No decorative comment separators.** A comment line must not use a run
  of repeated punctuation as a banner or wrapper — `// ============`,
  `// ---------------`, `// ─────────────`, or text wrapped in dashes like
  `// ===== Section =====`. These add characters without adding meaning.
  Write a plain, undecorated comment for a section label (`// Helpers`)
  instead of dressing it up.
- **Long or stale comments must be cut, not kept.** When a comment grows
  past what these rules allow, either delete it — most code is clear
  without it — or rewrite it as a short, concrete statement of the one
  non-obvious fact a reader needs.
- **Comment prose follows ASD-STE100 and Exaix STE Extension v1.** Write
  line/block comments, module headers, and JSDoc descriptions as concise,
  result-first prose under the shared Issue 9 limits: at most 20 words per
  sentence, no semicolons in eligible prose, and at most six descriptive
  sentences per paragraph.
  Preserve directives, JSDoc tags, identifiers, commands, one-line literal
  spans, and exact quotations. Keep necessary invariants and rationale;
  omit self-reflection and facts already clear from the code. Bullets are
  allowed when they make steps easier to scan, within the existing
  three-line limit. Documentation-file exemptions do **not** exempt
  source-comment prose.
