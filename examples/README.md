# Examples

Each example is an input you can copy. Run the Deno example from the repository root. The Node and
Bun examples run from their own directory and resolve `eslint`, `typescript-eslint` and `zod` from
the host test install, linked once from the repository root.

| Path                       | Runtime   | Shows                                                                                   |
| -------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `unslop.config.json`       | Any       | A small version 2 configuration with a preset and rule overrides.                       |
| `unslop.project.ts`        | Deno      | The project descriptor: plugin name, packs, config location, scripts, whole-tree hosts. |
| `lint_plugin.ts`           | Deno      | The plugin entry that compiles the configuration and default-exports `project.plugin`.  |
| `eslint/eslint.config.mjs` | Node, Bun | A flat ESLint configuration that spreads the `recommended` preset.                      |
| `oxlint/.oxlintrc.json`    | Node      | An Oxlint configuration that loads the ESLint plugin through `jsPlugins`.               |
| `node-project/`            | Node      | A complete Node setup with ESLint and Oxlint, a sample file, and a plugin entry.        |
| `bun-project/`             | Bun       | The same setup for Bun.                                                                 |

## Deno quick start

```sh
deno task unslop rules list
deno lint --config=deno.json
```

## Node quick start

```sh
npm ci --prefix hosts --ignore-scripts
node hosts/link_node_modules.mjs
cd examples/node-project
npx eslint sample.ts
```

## Bun quick start

```sh
bun install --frozen-lockfile --ignore-scripts --cwd hosts
node hosts/link_node_modules.mjs
cd examples/bun-project
bunx eslint sample.ts
```
