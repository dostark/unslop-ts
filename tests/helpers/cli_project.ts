/**
 * @module CliProjectTestHelper
 * @path tests/helpers/cli_project.ts
 * @description Writes a temporary version 2 project with two consumer script rules and runs the public CLI in it.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [src/cli/unslop.ts, tests/cli_rules_read_test.ts, tests/cli_config_test.ts, tests/cli_presets_test.ts]
 */

import { fromFileUrl, join } from "@std/path";
import { runDeno } from "./demo_project.ts";

/** The absolute path of the CLI entry that the tests spawn. */
export const CLI_PATH = fromFileUrl(new URL("../../src/cli/unslop.ts", import.meta.url));

const DESCRIPTOR_SOURCE = `import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("../", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("examples/unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("examples/lint_plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {
    "project-check": {
      meta: { description: "A consumer script check.", category: "scripts", docs: "#consumer-guide", preset: "opt-in", limits: null },
      optionSchema: null,
      controls: { editable: ["level"], fixedLevel: null, fixedScope: null, fixedInclude: null, fixedExclude: null, hostModes: { default: "warn" } },
      command: ["deno", "task", "check:project"],
    },
    "extra/no-explicit-unknown": {
      meta: { description: "A second script rule with an overlapping key.", category: "scripts", docs: "#consumer-guide", preset: "opt-in", limits: null },
      optionSchema: null,
      controls: { editable: ["level"], fixedLevel: null, fixedScope: null, fixedInclude: null, fixedExclude: null, hostModes: { default: "warn" } },
      command: ["deno", "task", "check:extra"],
    },
  },
  wholeTreeHosts: {},
};
`;

const PLUGIN_SOURCE = `import { createUnslopProject } from "@dostark/unslop-ts";
import { descriptor } from "./unslop.project.ts";
import config from "./unslop.config.json" with { type: "json" };

export const project = createUnslopProject({ descriptor, config });

export default project.plugin;
`;

const CONFIG = {
  version: 2,
  plugin: "demo",
  extends: ["unslop:recommended"],
  docsBase: "https://guide.test/",
  paths: {
    test: ["**/*_test.ts"],
    fixture: ["**/tests/fixtures/**"],
  },
  tags: {
    "project-choice": { description: "A tag this project chose." },
  },
  profiles: {
    comments: ["tag:comments"],
    parked: ["demo/exported-interface-naming"],
  },
  rules: {
    "demo/no-explicit-unknown": "error",
    "demo/exported-interface-naming": {
      level: "off",
      optIn: true,
      reason: "Opt-in naming convention.",
    },
    "demo/require-module-header": {
      level: "off",
      reason: "This project records headers in its own way.",
    },
    "demo/max-params": {
      level: "error",
      options: { max: 2 },
      tags: ["project-choice"],
    },
    "constant-restatement": [
      "error",
      { constantModules: ["src/constants.ts"], testRoots: ["tests"], minRestatedElements: 2 },
    ],
    "project-check": ["warn", {}],
  },
};

const CONFIG_PATH = "examples/unslop.config.json";

function projectDenoConfig(engineUrl: string, zodSpecifier: string, plugins: readonly string[]): string {
  return JSON.stringify(
    {
      imports: { "@dostark/unslop-ts": engineUrl, zod: zodSpecifier },
      lint: { plugins },
    },
    null,
    2,
  );
}

/** Writes the project, runs `body` in it, and removes it. */
export async function withCliProject(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_cli_" });
  try {
    await Deno.mkdir(join(dir, "examples"));
    const own = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url)));
    const engineUrl = new URL("../../mod.ts", import.meta.url).href;
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      projectDenoConfig(engineUrl, own.imports.zod, ["./examples/lint_plugin.ts"]),
    );
    await Deno.writeTextFile(join(dir, "examples", "unslop.project.ts"), DESCRIPTOR_SOURCE);
    await Deno.writeTextFile(join(dir, "examples", "lint_plugin.ts"), PLUGIN_SOURCE);
    await Deno.writeTextFile(join(dir, CONFIG_PATH), JSON.stringify(CONFIG, null, 2));
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs the CLI with only read and env permissions. */
export async function runCliAt(
  cwd: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runDeno(["run", "--allow-read", "--allow-env", CLI_PATH, ...args], cwd, env);
}

/** Runs the report CLI with read, env, and scoped Deno run permissions. */
export async function runReportCliAt(
  cwd: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runDeno(
    ["run", "--allow-read", "--allow-env", "--allow-run=deno", CLI_PATH, "report", ...args],
    cwd,
    env,
  );
}

/** Runs the report CLI in the project root. */
export async function runReportCli(
  dir: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runReportCliAt(dir, args, env);
}

/** Runs the report CLI with write permission for `--out`. */
export async function runReportWriteCli(
  dir: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runDeno(
    ["run", "--allow-read", "--allow-write", "--allow-env", "--allow-run=deno", CLI_PATH, "report", ...args],
    dir,
    env,
  );
}

/** Runs the CLI in the project root. */
export async function runCli(
  dir: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runCliAt(dir, args, env);
}

/** The config file path inside a written project. */
export function configPath(dir: string): string {
  return join(dir, CONFIG_PATH);
}
