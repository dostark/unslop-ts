/**
 * @module ConfigManagementIntegrationTest
 * @path tests/config_management_integration_test.ts
 * @description End-to-end: the shipped example reaches real lint through a CLI edit, and a v1-only project migrates and then lints.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [src/cli/unslop.ts, examples/lint_plugin.ts, tests/cases/catalog_v1_example.json]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { CLI_PATH } from "./helpers/cli_project.ts";
import { runDeno } from "./helpers/demo_project.ts";

const EXAMPLE_FILES = ["unslop.config.json", "unslop.project.ts", "lint_plugin.ts"];
const V1_DESCRIPTOR_SOURCE = `import { z } from "zod";
import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("../", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("examples/lint_plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {
    "project-check": {
      meta: { description: "A consumer script check.", category: "scripts", docs: "#consumer-guide", preset: "opt-in", limits: "A consumer limit." },
      optionSchema: z.object({ threshold: z.number().int().positive().default(1) }).strict(),
      controls: { editable: ["level", "options"], fixedLevel: null, fixedScope: null, fixedInclude: null, fixedExclude: null, hostModes: { default: "warn" } },
      command: ["deno", "task", "check:project"],
    },
  },
  wholeTreeHosts: {
    "duplicate-type": {
      controls: { editable: ["options"], fixedLevel: "error", fixedScope: "prod", fixedInclude: ["src/**"], fixedExclude: null, hostModes: { default: "error" } },
      command: ["deno", "task", "check:duplicates"],
    },
    "duplicate-constant": {
      controls: { editable: ["options"], fixedLevel: "error", fixedScope: "all", fixedInclude: null, fixedExclude: null, hostModes: { default: "error" } },
      command: ["deno", "task", "check:duplicates"],
    },
  },
};
`;
const V2_PLUGIN_SOURCE = `import { createUnslopProject } from "@dostark/unslop-ts/deno";
import { descriptor } from "./unslop.project.ts";
import config from "../unslop.config.json" with { type: "json" };

export const project = createUnslopProject({ descriptor, config });

export default project.plugin;
`;
const BROKEN_PLUGIN_SOURCE = 'throw new Error("the plugin must not load during migration");\n';
const CHAINED_ASSERTION = "export const value = 1 as never as number;\n";
const TWO_PARAMS = "export function pair(a: number, b: number): number {\n  return a + b;\n}\n";
const ONE_PARAM = "export function single(a: number): number {\n  return a;\n}\n";

interface IRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function lintConfig(engineUrl: string, zodSpecifier: string, plugin: string): string {
  return JSON.stringify(
    {
      imports: { "@dostark/unslop-ts": engineUrl, zod: zodSpecifier },
      lint: { plugins: [plugin] },
    },
    null,
    2,
  );
}

async function runCli(dir: string, args: readonly string[], writes: boolean): Promise<IRun> {
  const permissions = writes
    ? ["run", "--allow-read", "--allow-write", "--allow-env"]
    : ["run", "--allow-read", "--allow-env"];
  return await runDeno([...permissions, CLI_PATH, ...args], dir);
}

function codesOf(stdout: string): (string | undefined)[] {
  return ((JSON.parse(stdout) as { diagnostics?: { code?: string }[] }).diagnostics ?? [])
    .map((diagnostic) => diagnostic.code);
}

async function exampleProject(prefix: string, files: readonly string[], source: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix });
  await Deno.mkdir(join(dir, "examples"));
  for (const name of files) {
    await Deno.copyFile(new URL(`../examples/${name}`, import.meta.url), join(dir, "examples", name));
  }
  const own = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
  await Deno.writeTextFile(
    join(dir, "deno.json"),
    lintConfig(new URL("../mod.ts", import.meta.url).href, own.imports.zod, source),
  );
  return dir;
}

Deno.test("standalone_config_management_cutover", async () => {
  const v2 = await exampleProject("unslop_cutover_v2_", EXAMPLE_FILES, "./examples/lint_plugin.ts");
  try {
    const shown = await runCli(v2, ["rules", "show", "demo/max-params", "--format=json"], false);
    assertEquals(shown.code, 0, shown.stderr);
    assertEquals(
      (JSON.parse(shown.stdout) as { rule: { effectiveOptions: { max: number } } }).rule.effectiveOptions.max,
      2,
    );

    const edited = await runCli(v2, ["rules", "set", "demo/max-params", "max=1"], true);
    assertEquals(edited.code, 0, edited.stderr);
    await Deno.writeTextFile(join(v2, "two.ts"), TWO_PARAMS);
    await Deno.writeTextFile(join(v2, "one.ts"), ONE_PARAM);
    const two = await runCli(v2, ["config", "validate"], false);
    assertEquals(two.code, 0, two.stderr);
    const lintTwo = await runDeno(["lint", "--json", "two.ts"], v2);
    assert(codesOf(lintTwo.stdout).includes("demo/max-params"), lintTwo.stdout);
    const lintOne = await runDeno(["lint", "--json", "one.ts"], v2);
    assertEquals(codesOf(lintOne.stdout).includes("demo/max-params"), false);
  } finally {
    await Deno.remove(v2, { recursive: true });
  }

  const v1 = await Deno.makeTempDir({ prefix: "unslop_cutover_v1_" });
  try {
    await Deno.mkdir(join(v1, "examples"));
    const own = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
    await Deno.writeTextFile(
      join(v1, "deno.json"),
      lintConfig(new URL("../mod.ts", import.meta.url).href, own.imports.zod, "./examples/broken_plugin.ts"),
    );
    await Deno.writeTextFile(join(v1, "examples", "unslop.project.ts"), V1_DESCRIPTOR_SOURCE);
    await Deno.writeTextFile(join(v1, "examples", "broken_plugin.ts"), BROKEN_PLUGIN_SOURCE);
    await Deno.copyFile(new URL("./cases/catalog_v1_example.json", import.meta.url), join(v1, "catalog.json"));

    const migrated = await runCli(v1, [
      "migrate",
      "--descriptor=examples/unslop.project.ts",
      "--from=catalog.json",
      "--out=unslop.config.json",
      "--layout-out=layout.json",
    ], true);
    assertEquals(migrated.code, 0, migrated.stderr);
    assertStringIncludes(migrated.stdout, "unslop.config.json");

    await Deno.writeTextFile(join(v1, "examples", "lint_plugin.ts"), V2_PLUGIN_SOURCE);
    await Deno.writeTextFile(
      join(v1, "deno.json"),
      lintConfig(new URL("../mod.ts", import.meta.url).href, own.imports.zod, "./examples/lint_plugin.ts"),
    );
    const validated = await runCli(v1, ["config", "validate"], false);
    assertEquals(validated.code, 0, validated.stderr);
    await Deno.writeTextFile(join(v1, "violation.ts"), CHAINED_ASSERTION);
    const lint = await runDeno(["lint", "--json", "violation.ts"], v1);
    assert(codesOf(lint.stdout).includes("demo/no-chained-type-assertions"), lint.stdout);
  } finally {
    await Deno.remove(v1, { recursive: true });
  }
});
