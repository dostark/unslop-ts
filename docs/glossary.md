# Glossary

Each term has one meaning in this documentation. The reference pages use these terms unchanged.

| Term                       | Definition                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Host**                   | The linter that runs the rules: `deno lint`, ESLint, or Oxlint.                                                     |
| **Runtime**                | The process a host runs in: Deno, Node.js, or Bun.                                                                  |
| **Descriptor**             | The project module that names the plugin, its packs, the config location, and consumer script and whole-tree hosts. |
| **Catalog**                | The version 1 form of the resolved rule set. `unslop config print` emits it.                                        |
| **Compiled configuration** | The version 2 configuration after presets, overrides, and validation produce the effective rules.                   |
| **Plugin rule**            | A per-file rule that runs inside a host and reports diagnostics. Its id is `<plugin>/<rule>`.                       |
| **Whole-tree check**       | A project-wide check that runs outside the per-file plugin, such as unused exports or duplicate code.               |
| **Rule pack**              | A named group of plugin rules and their metadata. The package ships the TypeScript and Deno packs.                  |
| **Preset**                 | A named selection of rules, such as `unslop:recommended`. A project extends one or more presets.                    |
| **Scope**                  | The path class a rule applies to: `prod`, `test`, or `all`.                                                         |
| **Profile**                | A named selector list used with `--profile` for one call.                                                           |
| **Selection variable**     | The `<NAME>_LINT_RULES` environment variable that selects a subset; `selectionEnvName(name)` returns its name.      |
| **Active**                 | The rule is enabled and selected.                                                                                   |
| **Parked**                 | The rule is off and opt-in; selecting it runs it and makes its finding an error.                                    |
| **Off**                    | The rule is off and cannot be selected on.                                                                          |
| **Not selected**           | A selection excludes the rule for this call.                                                                        |
| **Diagnostic**             | One finding from a host: rule id, message, line, and column.                                                        |
| **Health report**          | The schema 2 measurement report from `unslop health`, with formula `unslop-health-v2`.                              |
| **Ceiling**                | The maximum count a package allows for one rule, used by the size and complexity gates.                             |
| **Parity**                 | The property that the same rule produces the same id, message, and location on every host.                          |
