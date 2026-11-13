# Command line

## Command line

Run the CLI from a checkout with `deno task unslop`, or as the package subpath `@dostark/unslop-ts/cli`.

| Command                                                                        | Effect                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `unslop rules list [--category=] [--status=] [--format=table\|json]`           | Every resolved rule with status, level, category, controls, and host modes.       |
| `unslop rules show <id> [--format=table\|json]`                                | One rule with configured/effective/default options and per-field sources.         |
| `unslop rules enable <id> [--level=error\|warn] [--dry-run]`                   | Set a supported level and clear obsolete off fields.                              |
| `unslop rules disable <id> --reason=<text> [--opt-in] [--dry-run]`             | Set the level to off with a reason, optionally parking the rule for selection.    |
| `unslop rules set <id> <option>=<json> [--dry-run]`                            | Set one supported option and preserve every other effective setting.              |
| `unslop rules unset <id> <option> [--dry-run]`                                 | Remove one option override and use its engine default.                            |
| `unslop presets list [--format=table\|json]`                                   | Every preset with the ids its memberships enable for the registered packs.        |
| `unslop presets show <name> [--format=table\|json]`                            | One preset's expansion.                                                           |
| `unslop config validate [--descriptor=<entry>]`                                | Read the file from disk and compile it against the descriptor.                    |
| `unslop config print [--resolved] [--descriptor=<entry>]`                      | The emitted catalog, or the catalog plus the resolved index with `--resolved`.    |
| `unslop config schema`                                                         | The generated structural JSON Schema.                                             |
| `unslop migrate --descriptor=<entry> --from=<v1> --out=<path> [--layout-out=]` | Migrate a version 1 catalog without overwriting an input or existing destination. |
| `unslop deno-policy --config=<file> --out=<dir> [--packs=typescript[,deno]]`   | Build an offline Deno lint policy directory from a version 2 configuration.       |
| `unslop health [--format=text\|json] [--descriptor=] [--root=]`                | Measure the project and print the schema 2 health report.                         |
| `unslop report [--format=table\|json\|markdown\|sarif] [--out=] [--] <paths>`  | Run a real lint host and report per-rule coverage and findings.                   |

Use `deno task unslop` for read commands and dry runs. Use `deno task unslop:write` for a real edit, a
migration, or any command that locks, stages, and writes files. The read task grants no write access,
because the CLI imports trusted project code with its own permissions. `deno task cli:write` is the
equivalent write-enabled CLI alias.

### Get the `unslop` command

The package publishes a module, not a binary. While the registry release is pending, install the
command from the checkout root:

```sh
deno install --global --name unslop --allow-read --allow-env --config=deno.json ./src/cli/unslop.ts
```

Once the release is published, install `jsr:@dostark/unslop-ts/cli` instead. Add `--allow-write`
for edits and `--allow-run=deno` for `unslop report`. Then run
`unslop rules list`. In a checkout, `deno task unslop` and `deno task unslop:write` run the same
entry with the same permissions.

### Command examples

These examples run from the repository root in a checkout of this repository. Each line uses the
task whose permissions it needs. The `demo/...` lines select the example plugin with `--plugin`;
`config schema` is static and takes no plugin. The `migrate` example assumes a version 1 project and writes a separate output name so it cannot
clobber a live version 2 file.

```sh
deno task unslop rules list --format=json
deno task unslop rules show demo/max-params --plugin=./examples/lint_plugin.ts --format=json
deno task unslop rules enable demo/no-boolean-assert --plugin=./examples/lint_plugin.ts --dry-run
deno task unslop rules disable demo/no-chained-type-assertions --plugin=./examples/lint_plugin.ts --reason=unused --dry-run
deno task unslop rules set demo/max-params max=4 --plugin=./examples/lint_plugin.ts --dry-run
deno task unslop rules unset demo/max-params max --plugin=./examples/lint_plugin.ts --dry-run
deno task unslop presets list --format=json
deno task unslop presets show unslop:strict --format=json
deno task unslop config validate --plugin=./examples/lint_plugin.ts
deno task unslop config print --plugin=./examples/lint_plugin.ts
deno task unslop config schema
deno task unslop:write rules set demo/max-params max=3 --plugin=./examples/lint_plugin.ts
deno task unslop:write migrate --descriptor=examples/unslop.project.ts --from=catalog.json --out=unslop.migrated.config.json --layout-out=layout.json
deno task unslop:report report --format=json src
deno task unslop:report report --format=markdown src
deno task unslop:report report --format=sarif src
deno task unslop:report:write report --format=json --out=report.json src
```

Query and edit routes accept `--plugin=<entry>` to select a local plugin entry. Without it, discovery
walks to the nearest JSON `deno.json` and uses its single configured plugin; several plugins require
`--plugin`. `--select=<tokens>` and `--profile=<name>` replace the selection variable for that call and
cannot be combined. An unknown selector, profile, category, status, format, command, or entry is a
usage error.

Exit codes:

- `0`: success.
- `1`: invalid file content, a failed compilation or validation, or a failed write.
- `2`: unknown or unsupported usage, a refused destination, a non-local entry, or a JSONC refusal.

The CLI accepts filesystem paths and local `file:` URLs only. It rejects `data:`, remote, and registry
schemes before import, and it refuses a JSONC lint configuration instead of parsing it. Local entries
and their transitive imports are trusted executable project code, not a sandbox; the CLI itself does
not request, store, or print credentials.
