# Configuration

## Configuration (version 2)

```json
{
  "version": 2,
  "plugin": "demo",
  "extends": ["unslop:recommended"],
  "docsBase": "docs/style_guide.md",
  "paths": {
    "test": ["**/*_test.ts"],
    "fixture": ["**/tests/fixtures/**"],
    "ignore": [{ "glob": "**/vendor/**", "reason": "Vendored code is not reviewed." }]
  },
  "tags": {
    "project-choice": { "description": "A rule choice of this project.", "requiresScope": ["prod"] }
  },
  "profiles": {
    "comments": ["tag:comments"]
  },
  "rules": {
    "demo/no-runtime-typeof": {
      "level": "error",
      "scope": "prod",
      "options": { "allowInTypeGuards": true }
    },
    "demo/max-params": ["error", { "max": 5 }],
    "demo/exported-interface-naming": {
      "level": "off",
      "optIn": true,
      "reason": "Opt-in naming convention."
    }
  }
}
```

- `version` must be `2`, and `plugin` must match `^[a-z][a-z0-9-]*$`.
- `extends` lists `unslop:recommended` and/or `unslop:strict`. The order is the expansion order, and a
  later entry for the same rule replaces the earlier one completely.
- `docsBase` is prefixed to engine-owned guide anchors. An explicit rule `docs` value always wins, and
  consumer script docs are never prefixed.
- `paths.test` and `paths.fixture` become the classification globs, and each `paths.ignore` entry
  needs a reason.
- `tags` overrides a category description and may restrict its scope. Only tags used by an emitted rule
  enter the compiled vocabulary.
- `profiles` maps a name to a non-empty selector list for `--profile`. Every profile token is validated
  when the configuration is compiled, so a typo fails `config validate` rather than the later user who
  selects that profile.
- `rules` accepts a level, `[level, options]`, or the long form. The long form adds `scope` (default
  `all`), `include`, `exclude`, `options`, `optIn`, `reason`, `docs`, `tags`, and consumer-only
  `exclusionCodes`.

`off` and `optIn: true` require a non-empty reason. Plugin rules accept `error` or `off`; `deno lint`
reports a selected plugin finding as an error. An omitted rule is registered off and opt-in with the
reason `Not enabled by the configuration.`, so its ignore code is known to Deno.

## Option validation

A regular expression option is checked when the catalog is parsed (version 1) or the configuration is
compiled (version 2). A pattern that does not compile, a repeated or unknown flag, and a pattern that
fails with its own flags are `CatalogError`/`ConfigError`s that name the field. The whole-tree command
reports the same error and exits with code 2. The fields are the `specifiers` of
`allowDynamicImports`, the `pattern` and `flags` of each `ephemeral-comment` phrase, the `pattern` of
`ephemeral-filename`, and `testScaffoldPattern` of the magic-literals options.

The version 1 catalog form:

```json
{
  "rules": {
    "demo/ephemeral-comment": {
      "engine": "plugin",
      "severity": "error",
      "scope": "all",
      "tags": ["demo"],
      "options": { "phrases": [{ "pattern": "\\btried\\b", "flags": "gi", "hint": "State the fact." }] }
    }
  },
  "wholeTree": { "magicLiterals": { "checkNumbers": false, "testScaffoldPattern": "^scaffold-" } }
}
```

The version 2 configuration form puts the same options in rule entries:

```json
{
  "version": 2,
  "plugin": "demo",
  "rules": {
    "demo/ephemeral-comment": {
      "level": "error",
      "options": { "phrases": [{ "pattern": "\\btried\\b", "flags": "gi", "hint": "State the fact." }] }
    },
    "magic-literals": {
      "level": "error",
      "options": { "checkNumbers": false, "testScaffoldPattern": "^scaffold-" }
    }
  }
}
```

The flags `g` and `y` are accepted. Each comment is tested from the start of the pattern, so an earlier
match never hides a later one. In a host, `checkNumbers: false` turns number checks off when no command
line flag is present. A host flag such as `--no-numbers` also turns them off, and no flag turns them on.
