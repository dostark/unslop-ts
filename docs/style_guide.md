# Style guide

The generic TypeScript and Deno style rules that the engine checks. A project that loads the engine
chooses which rules run, at what severity, and with which options in its version 2 configuration.

- Rule ids in this guide are bare keys, such as `import-placement`. The configuration lists a plugin rule
  under the plugin name of the project, such as `<plugin>/import-placement`.
- A rule blocks the build only when its effective level is `error`. A rule marked opt-in is off until the
  project turns it on.
- Each section ends with the rules that check it. A rule can check part of a section. Sections that
  describe a convention without a rule say so.
- Every rule declares its description, category, guide anchor, preset membership, and limits in code.
  The CLI reads that metadata, and [the metadata section](#rule-metadata) explains statuses and hosts.

## Strict Type Safety {#strict-type-safety}

Keep type evidence. A type that names the real shape lets the compiler find mistakes. A weak type, a cast,
or a suppression hides them.

### Annotate and name every type

- Give every variable, parameter, return value, and data structure an explicit type. Do not use inference to
  avoid writing a type.
- When a type does not exist yet, create it. When the keys of an object are known, write an interface
  instead of `Record<string, …>`.

### No `any`

- Do not write `any`, explicit or implicit. Use a generic (`<T>`), a named interface, or a type inferred from
  a schema such as Zod.
- Do not cast with `as any`. Use a type guard, narrow the value, or define the correct type.
- Do not silence the built-in `no-explicit-any` rule with a `deno-lint-ignore` comment. Fix the type.

### No `unknown` as a stored type

`unknown` is for values you have not checked yet. It must not describe data that your code keeps.

- Use `unknown` only for a `catch` binding, the subject of a type-predicate function, and a generic
  constraint.
- Do not use `unknown` for a parameter, a return type, a field, or an alias. Name the shape with an
  interface or a type alias.
- When the shape is truly dynamic, validate the value with a runtime schema at the point of access and
  narrow it there.
- Do not rename `unknown` with an alias such as `type UnknownValue = unknown`. The alias hides the weak type
  without making it stronger.

### No weak dictionaries

Do not use `Record<string, any>`, `Record<string, unknown>`, `{ [key: string]: unknown }`, or a `Map` with
a value type of `any`, `unknown`, `object`, or `{}`. Each one lets every property escape type checking.

- Define an interface that lists the expected members.
- Use a generic with a constraint when the shape varies.
- A generic constraint, such as `T extends Record<string, unknown>`, is allowed.
- Do not hide a weak dictionary behind an alias such as `type Payload = Record<string, unknown>`.

### Type assertions

- Do not use `as typeof <variable>`. It copies a type that you did not state and acts like `any`. The only
  default exception is `as typeof globalThis.fetch` in test code that mocks `fetch`. The catalog can allow
  other targets.
- An assertion that adds members through an intersection, such as `as typeof Deno & { … }`, is not a
  `typeof` escape and is allowed.
- Do not chain assertions, as in `value as unknown as User`. A chain discards what the compiler knows. Parse
  the value at its boundary, or use a type guard. Test code may use two mock shapes by default,
  `as Partial<T> as T` and `as never as T` (or `as any as T`). Each exception is an option.
- Where a single assertion is unavoidable in production code, state the invariant in a
  `// SAFETY: <reason>` comment before it. The marker word is an option.
- Do not compare `typeof x === "string"` to narrow a value by shape. Use a type guard function. A
  comparison with `"undefined"` and a comparison inside a type guard are allowed.
- Do not spread a conditional with an empty-object branch, such as `...(flag ? { key } : {})`. It hides a
  missing field. Build the object explicitly.

### Aliases and weak types

- Do not create an alias that only renames another alias of the same file. It adds indirection without
  adding meaning.
- Do not use `Promise<Response>` as a return type. Define an interface that describes the response and
  return `Promise<YourResponse>`. Callers then know what the body holds.
- Do not mask `Promise<Response>` behind an alias, such as `type MockFetch = () => Promise<Response>`. To
  mock `fetch`, cast with `as typeof globalThis.fetch` in test code, define an interface for the custom mock,
  or inject a typed dependency.
- Do not type a parameter as `object`. It names no shape. Declare the members that the function reads.

### Suppressions

- Do not use `@ts-ignore`, `@ts-expect-error`, or `@ts-nocheck`. Fix the type error. This applies to test
  code as well.
- Every `deno-lint-ignore` comment for a rule of the project plugin needs a reason after the separator
  (`--` by default).

### Rules

| Rule                                 | Reports                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `no-explicit-unknown`                | `unknown` outside a catch binding, a type-predicate subject, or a generic parameter (opt-in)  |
| `no-unsafe-dictionary`               | `Record`, `Map`, or an index signature with a weak value type (opt-in)                        |
| `no-typeof-escape`                   | An `as typeof <variable>` assertion outside the allowed targets (opt-in)                      |
| `no-chained-type-assertions`         | Two or more assertions in a chain                                                             |
| `require-safety-comment`             | A non-`const` assertion without a `SAFETY:` comment (opt-in)                                  |
| `no-runtime-typeof`                  | A `typeof` comparison used to narrow a value (opt-in)                                         |
| `no-conditional-empty-object-spread` | A spread of a conditional with an empty-object branch (opt-in)                                |
| `no-pass-through-type-alias`         | An alias that names another top-level alias of the same file                                  |
| `promise-response-return`            | `Promise<Response>` as a type annotation (opt-in)                                             |
| `promise-response-alias`             | An alias that masks `Promise<Response>`                                                       |
| `no-object-parameters`               | A parameter typed `object` (opt-in)                                                           |
| `ts-suppression-pragmas`             | A `@ts-*` pragma that carries a description. The built-in `ban-ts-comment` reports the rest.  |
| `no-forbidden-lint-ignore`           | A `deno-lint-ignore` comment for a forbidden rule. `no-explicit-any` is forbidden by default. |
| `ignore-needs-reason`                | A `deno-lint-ignore` comment for a project rule that has no reason                            |

An entry in `forbiddenRules` that ends with `/*`, such as `demo/*`, forbids every rule whose id starts
with the text before the star, including `no-forbidden-lint-ignore` itself. A file-wide
`deno-lint-ignore-file` comment is reported only for the rules it names, and Deno applies it before
any plugin rule runs. A host that must not allow file-wide suppression rejects that comment itself.

## Imports {#imports}

Imports show where code comes from. Keep them static, explicit, and at the top of the file.

### Imports at the Top {#imports-at-the-top}

Put every import declaration at the top of the file, before any type declaration or functional code. An
import call must not sit inside another statement, such as a function, a condition, or a loop.

```ts
if (condition) {
  await import("./foo.ts"); // ❌ nested in a condition
}

function loadModule() {
  return import("./bar.ts"); // ❌ nested in a function
}
```

A type definition must come after the last import. A static import must come before functional code.

| Rule                      | Reports                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `import-inside-statement` | An import call nested in a function, a block, or a loop                              |
| `import-placement`        | A type definition above the last import, or an import below functional code (opt-in) |

### Dynamic Imports {#dynamic-imports}

Avoid `await import()`. Use it only to load a large optional module, to load a module under a condition, or
to break a circular dependency. Record the reason in the place where the rule can read it: a
`deno-lint-ignore` comment with a reason, or an allowance in the catalog.

```ts
// ✅ The reason is part of the ignore comment
// deno-lint-ignore <plugin>/dynamic-import -- breaks the cycle between the registry and the loader
const { Loader } = await import("./loader.ts");

// ❌ No reason
const { join } = await import("@std/path");
```

| Rule                      | Reports                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `dynamic-import`          | Any dynamic import that has no allowance in the catalog and no ignore comment |
| `import-inside-statement` | A dynamic import nested in a function, a block, or a loop                     |

An allowance in the catalog names the files that may use dynamic imports and, optionally, the specifiers that
they may load.

### No Inline Type Imports {#no-inline-type-imports}

Do not name a type through an import expression inside a type annotation, as in the example below. Declare an
`import type` at the top of the file. A `typeof` query on an import expression is allowed.

```ts
// ❌ Inline import in a type annotation
function read(): Promise<import("./bar.ts").IBar | null> {}

// ✅ Top-level import declaration
import type { IBar } from "./bar.ts";
function read(): Promise<IBar | null> {}
```

| Rule                 | Reports                                                  |
| -------------------- | -------------------------------------------------------- |
| `inline-type-import` | An import type with a member access in a type annotation |

### No Re-exporting {#no-re-exporting}

A module exports only what it defines. Do not forward a name that another module defines. Re-exports hide the
origin of a symbol and make dependencies harder to trace.

```ts
export { Foo } from "./bar.ts"; // ❌ forwards a name
export * from "./bar.ts"; // ❌ forwards every name

import { Baz } from "./qux.ts";
export { Baz }; // ❌ exports an imported name
```

Import a name from the module that defines it. A project can exempt its package entry points, such as `mod.ts`,
so that a package can expose its public interface from one place.

| Rule                 | Reports                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `re-export-imported` | `export … from`, `export *`, and an export of an imported name (opt-in) |

### Named Imports

The engine has no rule for the layout of named imports. Let the formatter wrap them.

## No Magic Values {#no-magic-values}

A value that carries meaning needs a name.

- Do not write a numeric literal or a string constant in production or test code when it stands for a
  timeout, a status, a provider name, or a similar value. Give it a descriptive constant.
- Put a constant that one module owns in a constants file of that module, and group related values.
- Define a fixed set of strings, such as statuses, types, and providers, as an enum or a frozen object in the
  module that owns the concept. Compare with `Status.PENDING`, never with the literal string.
- Name an inline union of string literals (`"a" | "b"`) with a type alias or an enum.
- Keep one owner for a constant. A constant with the same name and the same value in two files is a duplicate.
- Keep one owner for a type. An interface or object type with the same name and members in two files is a
  duplicate.

### How the detector counts

The `magic-literals` check counts repeated string and number literals and reports a value that repeats more
often than a threshold. A report ranks higher when a constants file already holds the value.

| Scope                  | Strings          | Numbers          |
| ---------------------- | ---------------- | ---------------- |
| Module (within a file) | more than 3 uses | more than 4 uses |
| Global (across files)  | more than 5 uses | more than 6 uses |

These are the defaults. The catalog changes them. The detector skips these values:

- Numbers: `0`, `1`, `-1`, any number with an absolute value below 100, HTTP status codes (100–599), and
  multiples of 50 up to 1000.
- Strings: strings shorter than 4 characters, empty and whitespace strings, `true`, `false`, `null`,
  `undefined`, the names that `typeof` returns, words in upper case, UUIDs, semantic versions, paths and file
  names, command-line flags, MIME types, e-mail addresses, and ids that end in a number. The catalog adds
  project words and status words.
- Positions: property names, values of descriptive properties (`description`, `title`, `label`,
  `placeholder`), lists of structural names (`required`, `args`, `enum`), enum members, the value of an
  upper-case constant, import and export paths, decorator arguments, JSX attribute values, template literal
  parts, literal types, and element-access keys.
- Files that end in `constants.ts` or `enums.ts` define values. They never count as uses.
- In test files, strings that match the scaffold pattern, such as `test-…` and `mock-…`.

### Rules

| Check                | Reports                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `magic-literals`     | A string or number that repeats above the threshold (whole-tree check)  |
| `magic-union-type`   | An inline union of string literals outside a named type alias (opt-in)  |
| `duplicate-constant` | A top-level constant with the same name and static value in two files   |
| `duplicate-type`     | An interface or object type with the same name and members in two files |

## Interface Conventions {#interface-conventions}

These rules are opt-in. They describe a naming convention that a project chooses.

- **Prefix:** start the name of every exported interface with a capital `I`, such as `IUserService`. The
  letter after the prefix must not be lowercase, so `Item` does not count as prefixed. The `prefix` option
  changes the letter. The prefix shows at a glance that a symbol is an interface and not a class or an alias.
- **Placement:** declare exported interfaces at the top of the module, after the imports and the header
  comment and before any class, function, or variable. A reader then sees the API surface first.
- **No rename on import:** import an interface under its own name. A rename such as `IFoo as Foo` hides the
  interface. If two names collide, rename the local code or the other module.

```ts
import { ILogEntry } from "./logger.ts"; // ✅
import { ILogEntry as LogEntry } from "./logger.ts"; // ❌ hides the interface
```

| Rule                            | Reports                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `exported-interface-naming`     | An exported interface without the prefix                                |
| `exported-interface-placement`  | An exported interface below a constant, a function, or a class (opt-in) |
| `no-interface-rename-on-import` | An import specifier that renames a prefixed interface (opt-in)          |

## Import Boundaries {#import-boundaries}

A project describes which files may not import which code. Each description is a zone. A zone names:

- the files it covers (`files`) and the files it excepts (`except`), as globs;
- the imports it denies (`deny`). Each deny entry has a message and at least one condition.

A deny entry can use three conditions:

- `specifier`: a regular expression that must match the text of the import specifier;
- `target`: globs that must match the path the specifier resolves to. A relative specifier resolves against
  the importing file. Any other specifier is matched as written;
- `outside`: globs that the resolved path must not match.

An import is denied only when every condition of an entry holds. The message can use `{specifier}` and
`{target}`. The rule reads static imports and re-exports, including a clause that spans several lines.
Malformed regular expressions fail when the catalog is parsed.

| Rule                | Reports                                     |
| ------------------- | ------------------------------------------- |
| `import-boundaries` | An import that a zone of the catalog denies |

## Module Order {#module-order}

Every module follows the same order.

1. **Header comment:** a short description of the module. It starts within the first lines of the file. The
   `maxStartLine` option sets how many (5 by default).
1. **Imports:** all import declarations.
1. **Exported types:** interfaces, types, and enums.
1. **Functional code:** classes, functions, and variable initializations.

| Rule                           | Reports                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `require-module-header`        | A module that does not start with a header comment                        |
| `import-placement`             | A type definition above the last import, or an import below code (opt-in) |
| `exported-interface-placement` | An exported interface below functional code (opt-in)                      |

## Test Fixtures {#test-fixtures}

Put a multi-line structured input, such as YAML, Markdown, JSON, or a TOML document, in a fixture file that
the test loads. Do not write it as an inline template string.

The `test-inline-multiline-fixture` check reports a template string in a test file when one of these holds:

- it is assigned to a variable with a name such as `markdown`, `yaml`, `json`, `input`, `payload`, `text`, or
  `content`, it has no interpolation, and it has at least 7 lines;
- it starts a document, such as a TOML table header or a `schema_version:` key;
- it has no interpolation, has at least 7 lines, and its first line starts with `---` or `#`.

The minimum line count, the variable names, and the fixture directory in the message are options.

## Test Assertions {#test-assertions}

Write assertions that show the failing value.

- Do not wrap a string or array check in a boolean assertion. Use a dedicated assertion, such as
  `assertStringIncludes(text, part)` or `assertArrayIncludes(list, [item])`, instead of
  `assert(text.includes(part))`.
- Do not repeat an assertion on the same call in two adjacent statements. Assert once on the result, or assert
  on the value that differs.
- Do not assert on a substring that restates an imported constant as a literal. Assert on the value of the
  constant, or on the behavior that uses it.

| Rule                           | Reports                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `no-boolean-assert`            | `assert(x.includes(y))` and `assertEquals(x.includes(y), true)` (opt-in)   |
| `no-repeated-assert-call`      | Two adjacent assertions that take the same call as first argument (opt-in) |
| `no-constant-substring-assert` | A substring assertion that restates an imported constant (opt-in)          |

## Deno Scripts {#deno-scripts}

- A runnable script starts with the Deno shebang `#!/usr/bin/env -S deno run -A` on line 1, before the header
  comment. The `shebang` option changes the line.
- The header of a script has a `Usage:` section with at least one example command. The section must appear in
  the first 15 lines of the file by default.

| Rule                   | Reports                                               |
| ---------------------- | ----------------------------------------------------- |
| `require-deno-shebang` | A file whose first line is not the shebang            |
| `require-script-usage` | A script with a header but without a `Usage:` section |

## Function & Method Complexity {#complexity-rules}

Keep functions and classes small enough to read in one pass.

- **Parameters:** a function, method, or constructor takes at most 7 parameters. For more, pass a parameter
  object (an interface that describes the arguments), pass a shared context object, or split the function.
- **Cyclomatic complexity:** a function scores 1 plus one for each `if`, loop, `catch`, conditional
  expression, `case` with a test, and `&&` or `||` operator. The default limit is 15. Nested functions are
  scored on their own.
- **Class size:** a class of at least 200 lines gets a score from its method count, constructor parameters,
  length, longest method, imports, and fields. A score of 60 or more is a god object. Split it into focused
  classes.

| Rule                        | Reports                                                 |
| --------------------------- | ------------------------------------------------------- |
| `max-params`                | A function with more parameters than the limit (opt-in) |
| `max-cyclomatic-complexity` | A function whose complexity exceeds the limit           |
| `max-class-size`            | A class whose size score reaches the threshold (opt-in) |

## Optional Parameters {#optional-parameters}

A `?` on a parameter says that a caller may leave it out. When the call sites disagree, the `?` misleads the
reader or hides a wiring gap. The whole-tree `optional-params` check compares each optional parameter with
every call site that has the same name.

### Redundant optional

The parameter is optional, but every caller passes it. Make it required.

```ts
// ❌ Every caller passes logger
function run(task: string, logger?: ILogger) {}

// ✅ Required
function run(task: string, logger: ILogger) {}
```

### Unused optional

The parameter is optional and the body reads it, but no caller passes it. This is the most dangerous case.
Either the value was meant to be injected and the wiring is missing, or the default branch is dead code.
Find which one and fix it.

### Marked, not optional

The parameter uses the optional wrapper, described below, but has neither `?` nor a default value. The wrapper
then states something false. A wrapped parameter that a required parameter follows is fine, because `?` cannot
precede a required parameter.

### Bare optional

The parameter is optional through a bare `?` or `| undefined`, without the wrapper. The wrapper records why
the parameter is optional. The full-tree check reports this case as advice. The staged-file mode of the check enforces it, and the
opt-in `require-optional-wrapper` rule finds it during linting.

### The optional wrapper

A project can define a wrapper type, `Opt` by default, that takes the parameter type and a reason from a
closed set: `Opt<T, Reason.X>`. The wrapper is `T | undefined` at run time. A wrapped parameter is exempt from
the call-site checks, because the reason shows that someone reviewed the choice.

### Guidelines

1. **Prefer required.** Mark a parameter optional only when at least one known production call site omits it.
   Optionality added for the future is the main cause of the two dangerous cases.
1. **A default is not optionality.** When a parameter has a default and every caller passes a value, remove
   the default and the `?`.
1. **`| undefined` is not optionality.** `param: T | undefined` still forces every caller to pass a value.
   Use `param?: T` for a real option, wrapped as above.
1. **Do not use `?` to hide size.** When a function takes too many parameters, use a parameter object
   instead of making some of them optional. See [Function & Method Complexity](#complexity-rules).

| Check or rule              | Reports                                         |
| -------------------------- | ----------------------------------------------- |
| `optional-params`          | The four cases above (whole-tree check)         |
| `require-optional-wrapper` | A bare `?` or `\| undefined` parameter (opt-in) |

## Comment Discipline {#comment-discipline}

Clear names, small functions, and simple control flow replace most comments. Write a comment only when the code
would be worse without it: a non-obvious invariant, a subtle constraint, or a workaround for a specific
bug. Do not restate what the next line says.

- **Keep in-module comments short.** A block comment or a run of `//` lines longer than three lines is a
  violation, after the module header. Put a longer explanation in the documentation of the module.
- **Leave out implementation history.** A comment must not narrate what was tried and abandoned, or what did
  not work. The commit message and the plan document record why. The code records what it does now. A
  project can add phrases to check, such as plan phase numbers, issue identifiers, or section numbers.
- **Do not cite a document section by number.** Section numbers drift when documents change. Restate the rule
  in the comment's own words.
- **Leave out calendar dates.** Dates are ephemeral. The rule checks numeric, ISO, compact, named-month, and
  quarter forms, in every comment including the module header. Date-like strings in executable code are not
  comments and stay valid.
- **Do not decorate.** A comment must not use a run of repeated punctuation as a banner, such as
  `// ======` or `// ----- Section -----`. Write a plain label, such as `// Helpers`.
- **Name test files after behavior.** A test file name must not contain a numbered plan phase, such as
  `phase147_…`. The words "phase" and "step" without a number are fine, because they are domain terms.
- **Cut long or stale comments.** Delete the comment, or rewrite it as one short statement of the non-obvious
  fact.

| Rule                 | Reports                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `long-comment`       | A comment longer than the line limit, after the header (opt-in)                                                                  |
| `ephemeral-comment`  | A calendar date, or a phrase from the configured list (opt-in). The default phrases name prior attempts: "tried", "didn't work". |
| `decorative-comment` | A comment line with repeated-punctuation separators                                                                              |
| `ephemeral-filename` | A test file name that contains a numbered plan phase                                                                             |

## Metadata, status, and hosts {#rule-metadata}

Every rule and whole-tree check declares its description, category, guide anchor, preset membership, and
stated limits in the engine. `unslop rules list` and `unslop rules show` read that metadata. This keeps
the guide and the CLI aligned: every metadata anchor resolves here, and the stated rule ids and default
limits are checked against the option schemas.

A query status describes the configuration only. `active`, `parked`, `off`, and `not-selected` say
whether the current selection enables a rule. They never change how a host runs it. Whole-tree checks
keep their host modes: `unused-exports` reports the trusted set by default (`--all` widens it) and fails only
with `--fail`; an unused exported interface reports as a warning that `--fail` ignores, and the
`// unslop-ignore-next-line unused-type` pragma exempts a deliberate one. A `configurable(…)`
registration, a `__test_*` export, and a name bound by a destructured `await import(…)` are never
reported: the wrapper, the test prefix, and the binding are the exemption markers because a string
key, a test seam, and a dynamic binding consume them. `--parity` runs the fallow-aligned report:
re-exports, entry points, tests, scripts, default exports, and namespaces are reported. The
`severity` option sets each class (`type`, `value`, `parity`) to `warning` or `error`;
`--severity=warn|error` and `--relaxed` override it for one run. `configurable(…)` registrations and
`__test_*` hooks stay exempt, and `// unslop-ignore-next-line unused-export` marks an intentional
value export. `unused-files` and
`optional-params` warn until
`--fail` or `--staged`. A script rule's configured level does not override a fixed host flag. The CLI
prints the editable controls and the host modes, so the enforcement owner stays visible.

## Rule authoring for every host {#rule-authoring}

Every engine rule runs on `deno lint`, ESLint, and Oxlint, so a rule obeys these rules:

1. A rule module uses no runtime global. It does not read `Deno`, `process`, or `Bun`; the host entry
   passes the paths it needs.
2. A rule reads only the `IRuleContext` subset: `sourceCode.text`, `report`, `filename`, and the
   normalized `options`. Host-specific state does not reach a rule.
3. A rule declares `meta`, `requiresTestGlobs`, and `overlaps`. The presets, the README overlap table,
   and the compatibility overlay read that metadata.
4. A rule emits the bare message and an optional hint. The host entry adds the plugin id and the docs
   link, so a message never names a host.
5. A rule's cases live in `unslop-ts/tests/cases/conformance.json`. The conformance suite runs the same case on
   every host, so a new rule without a case fails the check.
6. Suppression parsing stays in the shared ignore-directive helper. A rule never parses a
   `deno-lint-ignore`, `eslint-disable`, or `oxlint-disable` comment itself.
7. A rule declares its options with the zod schema. The ESLint adapter derives its JSON schema from
   that declaration; no host gets a hand-written schema.
8. A rule does not branch on the host. The host entry normalizes settings, options, and paths before
   the rule runs, and the conformance suite holds that normalization to one result.

## Named Imports {#prefer-named-imports}

A namespace import (`import * as ns from "…"`) hides which symbols a module consumes. When every use
of `ns` is a static member read such as `ns.load`, import the members by name instead:
`import { load } from "…"`. The import then states the consumer surface, and a rename inside the
namespace cannot silently escape the consumer.

| Check                  | Reports                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `prefer-named-imports` | A namespace import whose members are all read as `ns.member` |

The rule is opt-in and has no options. It skips a namespace that is spread, indexed dynamically,
passed as a whole value, or read without any member, so it never proposes a lossy rewrite. Test
files and helpers follow the same rule. A facade that forwards the namespace stays valid; mark the
intentional case with `// unslop-ignore-next-line prefer-named-imports` above the import.

## Re-export Placement {#barrel-only-reexports}

A module re-export (`export … from "…"`) belongs in a barrel file: a module whose name ends with a
configured suffix, by default a name ending in `mod.ts` or `index.ts`. An ordinary module states its
own surface and
imports what it uses; forwarding another module's symbols from it hides where those symbols live and
adds a second public path that the barrel cannot police. The `barrel-only-reexports` check reports
that placement.

| Option           | Default                    | Meaning                                       |
| ---------------- | -------------------------- | --------------------------------------------- |
| `barrelSuffixes` | `["/mod.ts", "/index.ts"]` | File-name suffixes that mark a barrel         |
| `allowPaths`     | `[]`                       | Repository path prefixes exempt from the rule |

Test files are exempt, so a test helper may forward test support. A star export and a named export,
including `export type { … } from`, are both module re-exports.

The unused-export analysis reports an interface or a type alias as a warning when no file imports it.
Put `// unslop-ignore-next-line unused-type` above the declaration when it is intentional API; the
older `unused-interface` spelling stays accepted for interfaces.
