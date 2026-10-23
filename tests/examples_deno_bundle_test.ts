/**
 * @module ExamplesDenoBundleTest
 * @path tests/examples_deno_bundle_test.ts
 * @description Checks the release bundles, their checksums, and `deno lint` through the bundled plugin.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/bundle.ts, examples/node-project]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const ENGINE = join(DIST, "unslop_engine.js");
const PLUGIN = join(DIST, "deno_plugin.js");
const SAMPLE = join(ROOT, "examples/node-project/sample.ts");

async function ensureBundle(): Promise<void> {
  try {
    await Deno.stat(ENGINE);
    await Deno.stat(PLUGIN);
  } catch {
    const result = await new Deno.Command("deno", {
      args: ["task", "bundle"],
      cwd: ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  }
}

async function checksumOf(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function lint(args: readonly string[], cwd: string): Promise<readonly string[]> {
  const result = await new Deno.Command(Deno.execPath(), { args: [...args], cwd, stdout: "piped", stderr: "piped" })
    .output();
  const diagnostics = (JSON.parse(new TextDecoder().decode(result.stdout)) as {
    diagnostics: readonly { code: string | null }[];
  }).diagnostics;
  return diagnostics.map((diagnostic) => diagnostic.code ?? "");
}

Deno.test("the release bundle and its checksum files match", async () => {
  await ensureBundle();
  for (const path of [ENGINE, PLUGIN]) {
    const recorded = (await Deno.readTextFile(`${path}.sha256`)).split(/\s+/)[0];
    assertEquals(await checksumOf(path), recorded, path);
  }
  const plugin = await Deno.readTextFile(PLUGIN);
  assertStringIncludes(plugin, 'from "./unslop_engine.js"');
  assertEquals(plugin.includes("parseCatalog("), true);
});

Deno.test("the bundled plugin leaves Deno's own diagnostics identical", async () => {
  await ensureBundle();
  const dir = await Deno.makeTempDir({ prefix: "unslop_bundle_" });
  try {
    await Deno.copyFile(ENGINE, join(dir, "unslop_engine.js"));
    await Deno.copyFile(PLUGIN, join(dir, "deno_plugin.js"));
    const source = (await Deno.readTextFile(SAMPLE)).replace(/^\/\/ deno-lint-ignore-file.*\n/, "");
    await Deno.writeTextFile(join(dir, "sample.ts"), source);
    const baseline = await lint(["lint", "--no-config", "--json", "sample.ts"], dir);
    await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify({ lint: { plugins: ["./deno_plugin.js"] } }));
    const withPlugin = await lint(["lint", "--json", "sample.ts"], dir);
    assertEquals(withPlugin.filter((code) => !code.startsWith("demo/")), baseline);
    assertEquals(withPlugin.includes("demo/no-chained-type-assertions"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
