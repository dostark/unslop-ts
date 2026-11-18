# Tutorial: add unslop to a Deno project

Goal: run one unslop rule under `deno lint` and see a finding.

Prerequisites: Deno 2.9, a project with a `deno.json`, and a copy of the `examples/` directory.

## Steps

1. Write a version 2 configuration. `../examples/unslop.config.json` is a small one. It names the plugin,
   extends a preset, and sets rule overrides. Rule ids are `<plugin name>/<rule key>` for plugin rules
   and bare ids for whole-tree checks and consumer scripts.
1. Write the project descriptor. `../examples/unslop.project.ts` exports the plugin name, the rule packs,
   the configuration location, and any consumer script or whole-tree host descriptors. It reads no
   configuration file, so it stays importable when the configuration is absent or invalid.
1. Write the plugin entry. `../examples/lint_plugin.ts` imports `createUnslopProject` from
   `@dostark/unslop-ts/deno`, compiles the configuration with
   `createUnslopProject({ descriptor, config })`, and default-exports `project.plugin`.
1. Register the entry in the project's `deno.json`, add the package to its import map, and run
   `deno lint`:

   ```json
   {
     "imports": {
       "@dostark/unslop-ts": "<path to the checkout>/mod.ts",
       "@dostark/unslop-ts/deno": "<path to the checkout>/deno.ts"
     },
     "lint": { "plugins": ["./examples/lint_plugin.ts"] }
   }
   ```

   The registry release is pending, so the import map points at a checkout. Replace both entries with
   `jsr:@dostark/unslop-ts` and `jsr:@dostark/unslop-ts/deno` once the package is published.
1. To run a subset locally, export `<NAME>_LINT_RULES`, where `<NAME>` is the plugin name in upper case
   (`demo` gives `DEMO_LINT_RULES`). The value is a list of full ids, unambiguous bare keys, or
   `tag:<tag>` selectors. The CLI `--select` and `--profile` options replace that variable for one call.
   `selectionEnvName(name)` returns the variable name. For example, `DEMO_LINT_RULES="max-params" deno lint` runs only the `max-params` rule for that call.

## Verify

Run `unslop rules list` from the example project, with the CLI installed as described in the
[user guide](./user-guide.md#1-install). The rules your configuration enables show as `active`, and
the preset members you did not enable show as `parked` or `off`.

Run `deno lint` on the sample file. A finding prints the rule id and the source location. If no
finding appears, the rule is not selected: check the preset expansion with `unslop presets show
unslop:recommended`, or pass `--select=<rule id>` for one run.

## Next

- [Configuration](./reference/config.md) — change a level, an option, or a path glob.
- [Hosts and runtimes](./how-to/hosts.md) — run the same rules under ESLint or Oxlint.
- [Troubleshooting](./troubleshooting.md) — map a startup error to its cause.
