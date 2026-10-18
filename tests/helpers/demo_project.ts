/**
 * @module DemoProjectTestHelper
 * @path packages/lint-rules/tests/helpers/demo_project.ts
 * @description Writes a temp project that loads the engine rule packs as a lint plugin, and runs `deno lint` over it.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-rules/tests/deno_builtin_overlap_test.ts, packages/lint-rules/tests/plugin_selection_test.ts]
 */

import { join } from "@std/path";
import { DENO_RULE_PACK, type JsonValue, TYPESCRIPT_RULE_PACK } from "../../mod.ts";

export interface ILintReport {
  readonly diagnostics?: readonly { readonly filename?: string; readonly code?: string }[];
  readonly errors?: readonly JsonValue[];
}

export interface IDemoProjectOptions {
  readonly files: Readonly<Record<string, string>>;
  /** Built-in rule settings under `lint.rules`. The recommended set is the default. */
  readonly lintRules?: { readonly include?: readonly string[]; readonly exclude?: readonly string[] };
}

export interface IDeno {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const DEMO_PLUGIN_NAME = "demo";
export const DEMO_TAG = "demo";
const ENGINE_ALIAS = "engine";
const PLUGIN_FILE = "plugin.ts";
const CONFIG_FILE = "deno.json";
const DEMO_OPTIONS: Readonly<Record<string, Record<string, number>>> = {
  "max-cyclomatic-complexity": { max: 1 },
  "max-class-size": { minClassLines: 1, threshold: 1 },
};

/** Every bare rule key of the TypeScript and Deno packs. */
export function packRuleKeys(): string[] {
  return [...Object.keys(TYPESCRIPT_RULE_PACK.rules), ...Object.keys(DENO_RULE_PACK.rules)];
}

/** A catalog that turns every pack rule on under the demo plugin name. */
export function demoCatalog(): Record<string, JsonValue> {
  const rules: Record<string, JsonValue> = {};
  for (const key of packRuleKeys()) {
    rules[`${DEMO_PLUGIN_NAME}/${key}`] = {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: [DEMO_TAG],
      ...(key in DEMO_OPTIONS ? { options: DEMO_OPTIONS[key] } : {}),
    };
  }
  return {
    version: "1",
    scopes: { test: ["**/*_test.ts"], fixture: ["**/tests/fixtures/**"] },
    tagVocabulary: { [DEMO_TAG]: { description: "Rules of the demo project." } },
    rules,
  };
}

function pluginSource(): string {
  return [
    `import { createLintPlugin, createRuleRegistry, DENO_RULE_PACK, parseCatalog, TYPESCRIPT_RULE_PACK } from "${ENGINE_ALIAS}";`,
    "const packs = [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK];",
    `const registry = createRuleRegistry(${JSON.stringify(DEMO_PLUGIN_NAME)}, packs);`,
    `const catalog = parseCatalog(${JSON.stringify(demoCatalog())}, { scriptRuleSchemas: null, registry });`,
    `export default createLintPlugin(${JSON.stringify(DEMO_PLUGIN_NAME)}, catalog, { rulePacks: packs });`,
    "",
  ].join("\n");
}

async function configSource(options: IDemoProjectOptions): Promise<string> {
  const rootConfig = JSON.parse(await Deno.readTextFile(new URL("../../../../deno.json", import.meta.url)));
  return JSON.stringify({
    imports: { [ENGINE_ALIAS]: new URL("../../mod.ts", import.meta.url).href, zod: rootConfig.imports.zod },
    lint: { plugins: [`./${PLUGIN_FILE}`], rules: { tags: ["recommended"], ...options.lintRules } },
  });
}

/** Runs the Deno binary. `env` adds to the inherited environment, and the selection variable is cleared first. */
export async function runDeno(args: readonly string[], cwd: string, env: Record<string, string> = {}): Promise<IDeno> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [...args],
    cwd,
    env: { [`${DEMO_PLUGIN_NAME.toUpperCase()}_LINT_RULES`]: "", ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
}

/** Writes the project to a fresh temp dir, runs `body` in it, and removes the dir. */
export async function withDemoProject<T>(
  options: IDemoProjectOptions,
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "demo_project_" });
  try {
    await Deno.writeTextFile(join(dir, CONFIG_FILE), await configSource(options));
    await Deno.writeTextFile(join(dir, PLUGIN_FILE), pluginSource());
    for (const [name, source] of Object.entries(options.files)) await Deno.writeTextFile(join(dir, name), source);
    return await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Lints the named files of a demo project and returns the JSON report. */
export async function lintJson(
  dir: string,
  files: readonly string[],
  env: Record<string, string> = {},
): Promise<ILintReport> {
  const result = await runDeno(["lint", "--json", "--config", CONFIG_FILE, ...files], dir, env);
  return JSON.parse(result.stdout) as ILintReport;
}
