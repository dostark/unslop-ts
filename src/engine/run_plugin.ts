/**
 * @module RunLintPlugin
 * @path packages/lint-rules/src/engine/run_plugin.ts
 * @description In-process test helper that runs a lint plugin under Deno.lint.runPlugin.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/mod.ts]
 */

/** Runs `plugin` over one source unit and returns its diagnostics. */
export function runPlugin(
  plugin: Deno.lint.Plugin,
  filename: string,
  source: string,
): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(plugin, filename, source);
}
