# Whole-tree checks

## Check reference

| Id                     | Preset      | Detects                                                                    |
| ---------------------- | ----------- | -------------------------------------------------------------------------- |
| `duplicate-type`       | recommended | An interface or object type with the same name and members in two files.   |
| `duplicate-constant`   | recommended | A top-level constant with the same name and static value in two files.     |
| `magic-literals`       | strict      | A repeated string or number above the configured threshold.                |
| `constant-restatement` | opt-in      | A test that restates a constant's value instead of importing the constant. |
| `unused-exports`       | opt-in      | An export that no other production file imports.                           |
| `unused-files`         | opt-in      | A production file that no entry point reaches.                             |
| `optional-params`      | opt-in      | An optional parameter whose optionality does not match its call sites.     |
| `duplicate-code`       | opt-in      | Code duplication above the configured percentage in a scan group.          |
| `import-cycles`        | opt-in      | A set of files that import each other in a cycle.                          |

## Import cycles {#import-cycles}

`--rule=import-cycles` reports every strongly connected component (SCC) of the import graph that reaches the
configured minimum size. A cycle here is a real group of files, not a count: each finding names its member files,
its internal edges, its kind, and one shortest cycle that starts and ends at the smallest member. The check reads
the `wholeTree.importCycles` section:

```json
{ "minFiles": 2, "includeSelf": false, "includeTypeOnly": true }
```

`minFiles`, `includeSelf`, and `includeTypeOnly` are optional and default to the values shown. `baseline` names a
committed baseline file, or is absent. The check does not need a scan group and it starts no child process.

Run it on a project the compiled descriptor names:

```sh
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --descriptor=<project descriptor> --rule=import-cycles
```

| Flag                         | Source | Default | Effect                                                          |
| ---------------------------- | ------ | ------- | --------------------------------------------------------------- |
| `--format=text\|json\|sarif` | both   | `text`  | Report renderer.                                                |
| `--min-files=<n>`            | both   | `2`     | The smallest SCC that counts as a cycle.                        |
| `--include-self`             | both   | `false` | Report a one-file self-import.                                  |
| `--include-type-only`        | both   | `true`  | Report type-only and mixed cycles as advisory findings.         |
| `--top=<n>`                  | CLI    | `50`    | Display rows only. The totals always count the full population. |
| `--trace=<path>`             | CLI    | off     | Show only the cycles that contain the file.                     |
| `--baseline=<path>`          | CLI    | setting | The committed baseline; a flag wins over the catalog setting.   |
| `--fail-on-new`              | CLI    | `true`  | Exit 1 on a runtime cycle the baseline does not list.           |
| `--fail-on-stale`            | CLI    | `false` | Exit 1 on a baseline entry that no longer exists.               |
| `--update-baseline`          | CLI    | off     | Rewrite the baseline file; needs `--allow-write`.               |
| `--fail`                     | CLI    | off     | Exit 1 when a runtime cycle exists.                             |

A command-line flag wins over the catalog setting. A bad value exits `2` before any report.

**Kinds.** Each union-graph SCC is projected onto the runtime edges and then onto the type edges. The cycle is
`runtime` when the runtime projection alone stays strongly connected, so runtime initialization can loop. It is
`type-only` when only the type projection stays connected, because TypeScript erases those imports. A `mixed` cycle
needs both a runtime path and a type path, so it can loop at runtime but needs a type edge to stay closed.

**Output.** The text report counts runtime, type-only, and mixed cycles, then lists each finding with its members,
its shortest path, and every internal edge. The JSON report carries the same data under `version`, `truncated`,
`totals`, `graph`, and `cycles`. `graph.complete` is false when an unresolved specifier or a parse failure can hide
an edge; the report then names each unresolved reference, bounded to the first 100. Each cycle has a stable
`cyc-` id that hashes the sorted member paths, so a line move keeps the id and a change of membership changes it.

`--format=sarif` writes SARIF 2.1.0 with one `unslop/import-cycle` result per cycle. A runtime cycle is an
`error`, a mixed cycle a `warning`, and a type-only cycle a `note`. Each result locates every member file and
carries the cycle id in `properties.cycleId` and in `partialFingerprints["unslop-cycle/v1"]`, so a code-scanning
view groups the runs of one cycle.

**Bounds.** The report prints at most `--top` rows (50 by default) and never more than 1000 rows, and any renderer
stops before 8 MiB. The totals always count the full population. When a bound applies, the JSON and the SARIF run
set `truncated: true` and the text report says so in one line. No renderer prints source text.

**Tracing.** `--trace=<path>` keeps the cycles that contain one file and leaves the totals unchanged. A path
outside the project root is a usage error, and a file outside every cycle is an empty result with exit code 0.

**Baseline.** Set `baseline` to a repository path and `--update-baseline` writes the measured runtime cycles with
their stable ids and sorted member files. The file holds `{ version, allowed_unresolved, cycles }` and carries no
timestamp and no tool version, so a regeneration is a reviewable diff. The write resolves under the project root,
rejects a `..` escape and a symlink that leaves the root, caps the file at 1 MiB and 10,000 cycles, and replaces
the file through a sibling temporary file. It keeps the reviewed allowlist from the previous file. A malformed
baseline is a failure; a path outside the root is a usage error. `--update-baseline` needs `--allow-write`, and
every other run stays read-only.

**Gate.** With a baseline, each measured runtime cycle is matched by its stable id and its member set. A cycle the
baseline does not list is `new`; a cycle that shares a file with an unmatched entry is `changed`, because a changed
member set is a new risk; a baseline entry that no longer exists is `stale`. New and changed cycles fail the run by
default, and `failOnNew: false` makes them advisory. A stale entry is advisory unless `failOnStale` or
`--fail-on-stale` turns it into a failure.

The gate also fails on an incomplete graph: an unresolved reference that `allowed_unresolved` does not list, by
specifier and source file, fails the run and is named. An allowlisted reference passes, and the list may shrink but
not grow without a reviewed edit to the committed file. A baseline that lists more than the measured unresolved
count still passes only when every measured reference appears on the list. `gateRoots` limits the gate to cycles
whose files all sit under a listed prefix, so a test-only cycle stays advisory while it is still reported.

Exit codes: `0` passes; `1` means a new or changed runtime cycle, an incompleteness the allowlist does not cover, a
malformed baseline or a missing `--allow-write`; `2` means a usage error, an out-of-root path or an unsupported
flag.

**Limits.** The graph resolves relative imports and the `imports` maps of the project configs, like the health
report does. A computed dynamic import, a `tsconfig` path alias, and a package export resolve to no edge, and the
report states that the graph is incomplete instead of claiming a cycle-free run. Files that the catalog classifies
as fixtures and the paths that its `ignore` list names are not measured, as for the other whole-tree checks.

## Unused exports {#unused-exports}

`--rule=unused-exports` lists exported declarations that no module imports. It has six reports. They differ in
how an import is matched to an export, and in what they leave out on purpose.

| Report              | Flags                                     | An import matches an export by                  | Use                                                                 |
| ------------------- | ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Trusted             | none                                      | the bare name                                   | the gate: applies the exemption lists, warns for types              |
| Broad               | `--all`                                   | the bare name                                   | a survey: drops the exemptions that only the trusted report applies |
| Parity              | `--parity`                                | the module that defines it                      | the fallow-aligned audit                                            |
| Parity with enums   | `--parity --enum-members`                 | the module that defines it                      | adds unused enum members, advisory                                  |
| Parity with members | `--parity --enum-members --class-members` | the module that defines it                      | adds unused enum and class members, advisory                        |
| Production          | `--parity --production`                   | the module that defines it, from non-test files | separates unused code from code that only tests use, advisory       |

```sh
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --descriptor=<project descriptor> --rule=unused-exports
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --descriptor=<project descriptor> --rule=unused-exports --parity --fail
```

The project configuration must enable the check: add the whole-tree rule to the configuration with
a `level` and its options. A project that enables no whole-tree rule has no `wholeTree` section, and
the command exits `2` with a message naming it.

| Flag                     | Effect                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--all`                  | Broad report. Drops the trusted-only exemptions, and prints the directories with the most findings.                                                             |
| `--parity`               | Resolved report. `--all` has no effect with it.                                                                                                                 |
| `--enum-members`         | Adds the enum members that no `Enum.Member` reference reaches. Needs `--parity`.                                                                                |
| `--class-members`        | Adds the class members that nothing reads (see Class members). Needs `--parity`.                                                                                |
| `--production`           | Test files stop being sources of uses, and each finding says whether only tests use it. Needs `--parity`. Combines with `--enum-members` and `--class-members`. |
| `--severity=warn\|error` | Sets every class to a warning or an error for this run.                                                                                                         |
| `--relaxed`              | Same as `--severity=warn`.                                                                                                                                      |
| `--fail`                 | Exits with 1 when the run holds an error finding. A warning never fails the run. `--strict` is an older name.                                                   |

A finding prints as `WARN [unwired-export] path:line – 'name' …` or, with `--fail`, `ERROR …`, and a summary line
counts the errors and the warnings. The exit code is 0 unless `--fail` meets an error, and 2 for a usage error such
as a catalog without a `wholeTree.unusedExports` section.

#### The trusted report

The trusted report matches by name: an export counts as used when any walked file, tests included, imports that
name, re-exports it, reads it as `namespace.name`, or binds it from a destructured `await import(…)`. It then exempts
exports that a bare-name match cannot judge. These exemptions apply to the trusted and to the broad report:

- a `configurable(…)` registration, a name with the `__test_` prefix, and a declaration with a pragma (see Markers);
- a name that starts with `I` and a capital letter, a file that carries a `@public` JSDoc tag, and a file that matches
  `mainEntrypointSuffixes`.

Only the trusted report adds these, and `--all` drops them:

- a name that a package entry file re-exports, a file that matches `entrypointSuffixes`, and a path under
  `strictSkipPrefixes` or `strictSkipSegments`;
- the provider metadata constants, test double names such as `…Mock`, `…Stub`, and `mock…`, and entry point names such
  as `run…`, `start…`, and `main…`;
- a name that a script under `scriptRoot` imports.

An unused interface or type alias is a warning that `--fail` ignores. It is exempt when it sits in an entry file, in a
skipped path, or when a script imports it.

#### The parity report

The parity report asks which export each import reaches, and it lists an export site that nothing reaches. It exists
to match a resolving tool such as fallow. A name that another module exports and imports does not hide an unused
export, which the name match cannot see.

- **Resolution.** An import resolves through relative paths and through the `imports` map of every `deno.json` below the
  root. An exact key matches only itself, and a key with a trailing slash is a prefix. A specifier that resolves to no
  scanned file is ignored.
- **Chains.** Named re-exports and `export *` carry a use down to the definition. An import through a barrel uses the
  barrel entry and the definition behind it.
- **A re-export is not a consumer.** A named re-export (`export { x } from "<module>"`) does not use `x`. A barrel entry that nobody
  imports through the barrel is reported. A file that imports a name and exports it again from a local list is
  reported when nobody imports it from there, while its own import still uses the definition.
- **Import forms.** A named or default import uses that export. `import * as ns` uses the members that the file reads
  as `ns.member`, and every export when `ns` is passed on or indexed. A destructured `await import(…)` uses the names
  it binds, and a property read on its result uses that property. Any other dynamic import uses every export.
- **An unread binding is not a use.** An import whose local binding the file never reads uses nothing. The idiom
  `import { type helper as _helper }`, which only silences an unused-import warning, does not keep `helper` alive. A
  read in a type position or in an export list counts as a read.
- **Default exports.** A default export is a site like any other and is used by a default import. `export * from`
  does not carry it, because the language does not re-export a default through a star.
- **Where a use may come from.** Any walked file counts, including tests and scripts. A file that imports from itself
  does not.
- **Public API.** The files that a manifest hands to consumers outside the walk are consumed as a whole: `exports`
  and `lint.plugins` of a `deno.json`, and `main`, `module`, `bin`, and `exports` of a `package.json`. So are the files
  that match the `publicEntries` globs, which is the place for a bundle entry or a fixture that a tool loads by name.
  Everything a public file forwards is public too.
- **Types in signatures.** An exported interface or type alias that another exported declaration of the same file
  names stays: removing its export would leave a private type in a public signature.
- **Scope.** The report scans the files under `productionRoots` and under `scriptRoot`, and skips `/fixtures/`. Every
  walked file is still a source of uses.
- **Exemptions.** `configurable(…)` registrations, `__test_` names, and declarations with the pragma are skipped.

Each finding is one site: the same name in two files gives two findings when both are unused.

#### Enum members

`--parity --enum-members` adds a finding for each enum member that no reference reaches. The name of the finding is
`Enum.Member`. A reference is `Enum.Member`, `Enum["Member"]`, `ns.Enum.Member`, or `Enum.Member` in a type position,
and it resolves through imports, aliases, and barrels like an export does. A bare member name inside an initializer of
its own enum reads a sibling.

An enum used as a whole value uses every member, because the code can reach any of them: `Object.values(Enum)`,
`z.nativeEnum(Enum)`, `keyof typeof Enum`, `Enum[key]`, `Enum` passed as an argument, an export under another name, a
default export, and an enum as the key type of `Record`, `Partial`, `Required`, `Omit`, `Pick`, `Exclude`, `Extract`,
or a mapped type. An enum named only as a type (`mode: Mode`) uses no member. A membership test with a literal key
(`"Fast" in Mode`) names that one member, and a computed key (`key in Mode`) uses every member.

A manifest export does not make an enum public, because the workspace packages of a repository are often consumed only
inside it. A `publicEntries` file does, and so does a pragma. The pragma exempts a member when it sits above the member.
Above the enum declaration it exempts the whole enum, which is the answer for a closed set such as protocol codes or
stored statuses whose values arrive as data. The report is advisory by design: deleting a member that data can still
carry can break a cast or the parse of a stored value.

#### Class members

`--parity --class-members` adds a finding for each class member that nothing reads. The name of the finding is
`Class.member`. The check has no types, so it treats private and public members differently.

- **Private members.** A `private` member, a `#name` member, and a private constructor parameter property are checked
  inside the class body, where TypeScript confines them. A member is unused when the class never reads it. A field
  that the class only assigns (`this.x = value`) counts as unused.
- **Public and protected methods and accessors.** A member is listed only when no access of its name can reach its
  class in the walked files, tests included. An access is `.name`, `?.name`, `["name"]`, a destructured `{ name }`, or
  `Type["name"]`. A call inside the class counts. The check ties an access to a class from the syntax of its receiver:
  `this` and `super`; a `new Class()` expression; a name that a parameter, a variable, or a field declares with a class
  type or a `new` initializer; the return type of a method; `Class.member` for a static; a cast `x as Class`; and a
  destructuring source. A type or a base also reaches its ancestors and its subclasses, because a call can run an
  override, and an `instanceof` check narrows to a subclass. A receiver of any other shape, such as a callback
  parameter without a type, a result of a plain function, or a value typed as an interface, can be any class, so
  its name hides the member in every class. A class declared in a test file is matched by name alone, because a test
  double is cast to the class it replaces.
- **Public fields are not listed.** Serialization, equality checks, and `Object.keys` can read a field without naming it.

A member that a caller can reach without naming it is a contract and is never listed:

- a member that an `implements` interface or an `extends` base declares, and a member that carries `override`,
  `abstract`, or a decorator. The interface or base resolves through imports and barrels like an enum does, together
  with its own heritage;
- every public member of a class whose interface or base cannot be resolved to a walked declaration, such as a class
  that implements `Disposable` or extends a class from an npm package, because the external contract is unknown;
- the members that a subclass of a built-in error inherits (`name`, `message`, `cause`, `stack`, `toString`);
- the names that the runtime calls on any object (`toString`, `toJSON`, `valueOf`, `then`, `next`, `return`, `throw`),
  and any member with a computed name such as `[Symbol.iterator]`;
- every member of a class that appears in `keyof Class` or `keyof typeof value`.

As for enums, a manifest export does not make a class public. A `publicEntries` file does, and so does a pragma
above a member or above the class. The report is advisory by design.

#### Production mode

The reports above count a use from a test file as a use, as fallow does. A function that only its own unit test calls
then stays, although no product code runs it. `--parity --production` asks the other question: which code does the
non-test code use?

- **Sources of uses.** A file that matches `testSegments` or `testSuffixes` is not a source of uses. Its imports,
  re-exports, member accesses, and enum references are ignored. Files under `scriptRoot` are production code.
- **Scope.** A declaration in a test file is test code and is never listed. The files are the same as in the parity
  report otherwise, and `publicEntries`, pragmas, and contracts work as before.
- **Two labels.** The report runs once with test uses and once without them. A finding that both runs list is
  `used by nothing`. A finding that only the second run lists is `used only by test files`. The message says which, and the
  summary counts both. The second class is the new one: the ordinary parity report never shows it.
- **Name matching sharpens.** A test that calls `.open()` on one class no longer hides a dead `open` on another class,
  because the call is not a source of uses.
- **Advisory.** The report lists more than the ordinary one by design, since a test double or a test seam is test-only
  on purpose. It is not a gate.

Read the output in this order:

1. A test double or helper defined in production source (a `Mock…` class, a `…ForTest` function): move it to a test
   helper folder.
2. A barrel entry that only tests import: remove the entry, or import from the defining file.
3. Production code that only tests reach: wire it in, or delete it with its tests. Each one is either a feature that is
   not connected yet or dead code.
4. A test seam that exists so a test can inspect state (a `get…` or `is…` accessor, or an export of a script helper):
   keep it and mark it with a pragma, or test through behavior.

#### Options

The `unused-exports` rule takes these options. Every project sets the required ones, and none has a default.

| Option                                     | Used by             | Meaning                                                                                           |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------- |
| `productionRoots`                          | all                 | Path prefixes whose files are scanned for exports.                                                |
| `testSegments`, `testSuffixes`             | trusted, production | Path parts and file name endings that mark a test file, which is not scanned for exports.         |
| `entrypointSuffixes`                       | trusted             | File name endings of package entry files, such as a barrel file name.                             |
| `mainEntrypointSuffixes`                   | trusted             | File name endings of program entry files, such as a main file name.                               |
| `scriptRoot`                               | all                 | The directory of wiring scripts. Trusted mode exempts the names they import. Parity scans it.     |
| `walkSkipPatterns`                         | all                 | Regular expressions for the paths that the walk never enters. They match the absolute path.       |
| `strictSkipPrefixes`, `strictSkipSegments` | trusted             | Paths whose exports the trusted report leaves out.                                                |
| `severity`                                 | all                 | `type`, `value`, and `parity`, each `warning` or `error`. The `parity` class covers enum members. |
| `publicEntries`                            | parity              | Optional globs of files that a tool consumes, so their exports are public API.                    |

#### Markers

| Marker                                           | Where                              | Effect                                                                                                        |
| ------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `// unslop-ignore-next-line unused-export`       | above a declaration                | Exempts the declaration. `unused-type` and `unused-interface` are the same marker, so use the name that fits. |
| `// unslop-ignore-next-line unused-enum-member`  | above a member, or above the enum  | Exempts one member, or all members.                                                                           |
| `// unslop-ignore-next-line unused-class-member` | above a member, or above the class | Exempts one member, or all members.                                                                           |
| `@public`                                        | in a JSDoc tag of a file           | The trusted report skips the file.                                                                            |
| `configurable(…)`                                | initializer of a constant          | Registers the constant by key, so its export is never reported.                                               |
| `__test_`                                        | name prefix                        | Marks a test seam, which is never reported.                                                                   |

#### Running it on this repository

The engine checks its own exports with the parity report. `deno task check:unused-exports` fails on any finding, and
`deno task check:unused-enum-members` and `deno task check:unused-class-members` list the unused members, and `deno task check:unused-production` lists the code that only tests use. Both read the `unused-exports` rule of
`../../lint/unslop.config.json`, which scans `src`, `tests`, and `lint`, and lists the bundle entry and the examples as
`publicEntries`.

#### Limits

The checks read syntax only. They build no type program, so they do not follow these shapes:

- an import path that a `tsconfig` `paths` entry, a `package.json` `exports` condition, or a `node_modules` package
  resolves, because only relative paths and `deno.json` import maps resolve;
- a dynamic import with a computed specifier, and a use from a file that is not TypeScript, such as a YAML scenario or
  a generated file;
- `export =`, declaration merging, and an ambient or global declaration;
- a local variable that has the name of an imported binding, because the check does not model scopes;
- an enum value that code reads as a string, such as `"fast"` from a database column;
- a method that code calls by a computed name (`obj[name]()`), and a callback that a framework invokes by name;
- a production object that stands in for a class it does not extend or implement, passed through a cast or a structural
  type, because an access then names the class of the annotation and not the class of the object.

When a result looks wrong, the cause is usually one of these. List the consumer as a `publicEntries` file, add the
pragma, or add the import map entry.

## Unused files from the manifests {#unused-files-manifest}

`--rule=unused-files` starts the walk at the entry points that the manifests declare, and it reports every scanned
file that no entry reaches. The scan runs when the catalog has the `wholeTree.unusedFiles.manifest` section, which has
three fields:

- `walkSkipPatterns`: regular expressions for the absolute paths that the scan never enters.
- `extraEntries`: globs of files that are entry points although no manifest names them.
- `referenceGlobs`: globs of text files, such as scenario YAML and HTML pages, whose path mentions count as references.

The entry points are these:

- `deno.json`: `exports`, the code paths in `tasks`, `lint.plugins`, and the files that `deno test` discovers
  (`*_test.ts`, `*.test.ts`, `test.ts`, limited by `test.include` and `test.exclude`). The nearest manifest that has a
  `test` section or a `deno test` task owns the test scope of the files below it.
- `package.json`: `main`, `module`, `bin`, `exports`, and the code paths in `scripts`.
- A task that runs tests (`deno test`, `node --test`, `bun test`, `vitest`, `jest`, `mocha`) also makes its globs
  entry points. A leading `cd <dir> &&` moves the base directory of the command.

The walk follows static and dynamic imports, re-exports, and the `imports` maps of every `deno.json`. An exact key
matches only itself; a key with a trailing slash is a prefix. It also follows a string literal that reads as a path
to a scanned file, such as the first argument of a `new URL(…, import.meta.url)` call or the path of a spawned script. A mention with a
variable prefix, such as `$SUITE_HOME/scripts/x.ts`, resolves against each ancestor directory of the file that holds it.
The scan reads `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.css` files. A `mod.ts` barrel, a
script, or a file in a `tests` folder is not an entry by name, so an unused one is reported.

A catalog without the `manifest` section keeps the older scan, which treats scripts, barrels, and files in tests folders
as entries. `--conventions` selects that scan on a catalog that has the section, and `--manifest` fails with a usage
error when the section is missing.

The same hint prints after a migration. A compiled-settings bridge replaces this legacy path once the host reads
adapter, so the separate catalog is temporary.

## Duplicate code

`duplicate-code` measures token-level duplication with [jscpd](https://github.com/kucherenko/jscpd) and
fails a scan group whose duplicated-token percentage exceeds its threshold. Token comparison finds a
clone even when the names differ, which the declaration checks `duplicate-type` and `duplicate-constant`
cannot. The check starts the pinned jscpd release through `npx`, so it needs Node.js and the npm registry
or a warm npm cache. It reads the `wholeTree.duplicateCode` section:

```json
{
  "jscpdVersion": "5.4.2",
  "minLines": 5,
  "minTokens": 50,
  "groups": [
    { "name": "source", "paths": ["src/"], "ignore": ["**/*.d.ts", "**/tests/**"], "threshold": 2 },
    { "name": "tests", "paths": ["src/"], "pattern": "**/tests/**/*.ts", "threshold": 5 }
  ]
}
```

`jscpdVersion`, `minLines`, and `minTokens` are optional and default to the values shown, and so are
`maxGapLines` (0), `baseline` (none), and `crossGroups` (false), which the paragraphs below describe. A group may
set its own `minLines`, which replaces the shared one for that group only, so production code can keep
a low minimum while test code uses a higher one. A group without `ignore` or `pattern` scans everything
under its `paths`. A group that scans no files is an
error, so a wrong glob never passes at zero percent. Run it with
`deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --catalog=catalog.json --rule=duplicate-code`;
`--verbose` lists every clone, largest first. `--group=<name>` (repeatable) runs only the named scan
groups, and `--top=<n>` caps the rows listed per group. `--by=file` ranks files by the lines that clones
cover, and `--by=block` collapses clone pairs that share a region into blocks with a copy count, the longest copy, and every
location.
The default `--by=pair` lists each clone pair. `--min-lines=<n>` drops clones shorter than `n` lines from
the listing in every view. It changes only what is listed, never the percentage or the threshold check.

Each group line also shows the **involved** share: the lines that any clone touches, counted once across
every copy, as a percentage of the scanned lines. The gate uses jscpd's percentage, which counts each clone
pair once, so the involved share is the larger figure and the one that other detectors report.

**Baseline.** Set `baseline` to a repository path and the check also fails a group that holds a clone the
baseline does not list, even while the group stays under its threshold. The percentage threshold still
applies. Each clone has an id built from its two files and its code, so moving a clone inside its files or
changing whitespace keeps the id. Create or refresh the file with `--update-baseline`, which writes one
line per clone and keeps the entries of groups that the run did not measure. The check prints how many
baseline entries no longer match a clone, so the file can shrink as clones go. The lines are longer than
most formatters allow, so exclude the baseline file from the project formatter.

**Cross-group clones.** Each group runs on its own, so a clone between two groups, such as source and
tests, is never compared. Set `crossGroups` to `true` and the check scans all groups together once more
and keeps the clones whose two copies fall in different groups. A cross-group clone must reach the larger of
the two group minimums. With a baseline, a cross-group clone that it does not list fails the run; without
one the pass only reports them. The pass runs only when two or more groups run.

**Gap merging.** jscpd ends a clone at the first token that differs. `maxGapLines` (shared, with a per-group
override) lets jscpd join clones of one file pair that sit that many unmatched lines apart into one larger
clone. It gives fewer and bigger targets and barely changes the percentage. `--max-gap-lines=<n>` overrides
it for one run.

**Machine-readable output.** `--format=json` prints one JSON document instead of the text report: each
group's figures, its clones with their ids and an `isNew` flag, the cross-group result, and an overall
`passed`. The exit code is the same as in text mode.

**Comparing with other detectors.** Detectors count differently, so their percentages do not compare
directly. jscpd counts a token for each punctuation mark; `fallow` counts roughly half as many tokens for the
same code, so `minTokens: 50` here matches about `--min-tokens 25` there. `fallow` also treats a template or
regex literal as one token whatever its text, so it finds clones that differ only inside one, which jscpd
cannot. Compare involved shares, not the gate percentages.
