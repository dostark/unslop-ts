/**
 * @module ProjectDescriptorTest
 * @path tests/project_descriptor_test.ts
 * @description The example descriptor loads without compiling or reading a version 2 configuration, including when that file is missing or malformed.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [examples/unslop.project.ts, tests/example_project_test.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runDeno } from "./helpers/demo_project.ts";

const V1_CATALOG = {
  version: "1",
  scopes: { test: ["**/*_test.ts"], fixture: ["**/tests/fixtures/**"] },
  tagVocabulary: { "type-safety": { description: "Rules that keep type evidence." } },
  rules: {
    "demo/no-chained-type-assertions": {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: ["type-safety"],
    },
  },
};
const CHECK_SCRIPT =
  'import { descriptor } from "./examples/unslop.project.ts";\nconsole.log(`${descriptor.pluginName} ${descriptor.packs.length}`);\n';
const MALFORMED_CONFIG = '{ "version": 2, "plugin": "demo", ';

async function projectConfig(): Promise<string> {
  const own = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
  return JSON.stringify({
    imports: { "@dostark/unslop-ts": new URL("../mod.ts", import.meta.url).href, zod: own.imports.zod },
  });
}

async function descriptorProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "descriptor_project_" });
  await Deno.mkdir(join(dir, "examples"));
  await Deno.copyFile(
    new URL("../examples/unslop.project.ts", import.meta.url),
    join(dir, "examples", "unslop.project.ts"),
  );
  await Deno.writeTextFile(join(dir, "deno.json"), await projectConfig());
  await Deno.writeTextFile(join(dir, "check.ts"), CHECK_SCRIPT);
  return dir;
}

async function loadDescriptor(dir: string): Promise<void> {
  const result = await runDeno(["run", "--config", "deno.json", "check.ts"], dir);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stdout.trim(), "demo 1");
}

Deno.test("descriptor_import_does_not_compile_or_read_config", async () => {
  const v1Only = await descriptorProject();
  try {
    await Deno.writeTextFile(join(v1Only, "examples", "catalog.json"), JSON.stringify(V1_CATALOG));
    await loadDescriptor(v1Only);
  } finally {
    await Deno.remove(v1Only, { recursive: true });
  }

  const malformed = await descriptorProject();
  try {
    await Deno.writeTextFile(join(malformed, "examples", "unslop.config.json"), MALFORMED_CONFIG);
    await loadDescriptor(malformed);
  } finally {
    await Deno.remove(malformed, { recursive: true });
  }
});
