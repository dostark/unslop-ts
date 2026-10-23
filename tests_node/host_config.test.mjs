/**
 * @module HostConfigTest
 * @path tests_node/host_config.test.mjs
 * @description Checks the generated host fragments, the skipped rules, and the wrapper's safe writes.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileConfig, DENO_RULE_PACK, HostConfigError, toHostConfig, TYPESCRIPT_RULE_PACK } from "../mod.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER = join(ROOT, "scripts", "to_host_config.mjs");
const GOLDENS = join(ROOT, "tests", "fixtures", "host_config");

function runWrapper(args) {
  return spawnSync(process.execPath, [WRAPPER, ...args], { cwd: ROOT, encoding: "utf8" });
}

async function descriptorPath(dir) {
  const path = join(dir, "descriptor.mjs");
  await writeFile(
    path,
    [
      `import { TYPESCRIPT_RULE_PACK } from ${JSON.stringify(pathToFileURL(join(ROOT, "mod.ts")).href)};`,
      `const rootUrl = ${JSON.stringify(pathToFileURL(ROOT).href)};`,
      `export const descriptor = {`,
      `  pluginName: "demo",`,
      `  rootUrl: new URL(rootUrl),`,
      `  configUrl: new URL("examples/unslop.config.json", rootUrl),`,
      `  lintConfigUrl: new URL("deno.json", rootUrl),`,
      `  pluginUrl: new URL("examples/lint_plugin.ts", rootUrl),`,
      `  packs: [TYPESCRIPT_RULE_PACK],`,
      `  scriptRules: {},`,
      `  wholeTreeHosts: {},`,
      `};`,
      "",
    ].join("\n"),
  );
  return path;
}

test("the wrapper matches the committed golden for both hosts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "unslop-host-config-"));
  try {
    const descriptor = await descriptorPath(dir);
    for (const [host, golden] of [["eslint", "eslint_fragment.mjs"], ["oxlint", "oxlint_fragment.json"]]) {
      const out = join(dir, `${host}.txt`);
      const result = runWrapper([
        `--descriptor=${descriptor}`,
        `--config=${join(ROOT, "examples", "unslop.config.json")}`,
        `--host=${host}`,
        `--out=${out}`,
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /skipped: duplicate-type/);
      assert.equal(await readFile(out, "utf8"), await readFile(join(GOLDENS, golden), "utf8"), host);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the wrapper refuses an existing file without --overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "unslop-host-config-"));
  try {
    const descriptor = await descriptorPath(dir);
    const out = join(dir, "existing.txt");
    await writeFile(out, "keep\n");
    const result = runWrapper([
      `--descriptor=${descriptor}`,
      `--config=${join(ROOT, "examples", "unslop.config.json")}`,
      "--host=eslint",
      `--out=${out}`,
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /the file exists/);
    assert.equal(await readFile(out, "utf8"), "keep\n");
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the wrapper refuses a symlinked output and leaves no temporary file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "unslop-host-config-"));
  try {
    const descriptor = await descriptorPath(dir);
    const target = join(dir, "target.txt");
    await writeFile(target, "keep\n");
    const link = join(dir, "link.txt");
    await symlink(target, link);
    const result = runWrapper([
      `--descriptor=${descriptor}`,
      `--config=${join(ROOT, "examples", "unslop.config.json")}`,
      "--host=eslint",
      `--out=${link}`,
      "--overwrite",
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /symlink/);
    assert.equal(await readFile(target, "utf8"), "keep\n");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the generated ESLint fragment loads on a baseline config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "unslop-host-config-"));
  try {
    const text = await readFile(join(GOLDENS, "eslint_fragment.mjs"), "utf8")
      .then((value) =>
        value
          .replace('"@dostark/unslop-ts/eslint"', JSON.stringify(pathToFileURL(join(ROOT, "eslint.ts")).href))
          .replace('"@dostark/unslop-ts"', JSON.stringify(pathToFileURL(join(ROOT, "mod.ts")).href))
      );
    const fragment = join(dir, "fragment.mjs");
    await writeFile(fragment, text);
    // deno-lint-ignore exaix/dynamic-import exaix/import-inside-statement -- the fragment is generated at test time
    const module = await import(pathToFileURL(fragment).href);
    assert.equal(Array.isArray(module.default), true);
    assert.equal(typeof module.default[0].plugins.unslop.create, "undefined");
    assert.equal(typeof module.default[0].plugins.unslop.rules["no-explicit-unknown"].create, "function");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an Oxlint rule exclusion is expressed as an override, or generation fails", () => {
  const rootUrl = pathToFileURL(`${ROOT}/`);
  const descriptor = {
    pluginName: "demo",
    rootUrl,
    configUrl: new URL("examples/unslop.config.json", rootUrl),
    lintConfigUrl: new URL("deno.json", rootUrl),
    pluginUrl: new URL("examples/lint_plugin.ts", rootUrl),
    packs: [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK],
    scriptRules: {},
    wholeTreeHosts: {},
  };
  const excluded = compileConfig({
    version: 2,
    plugin: "demo",
    paths: { test: [], fixture: [] },
    rules: { "demo/no-explicit-unknown": { level: "error", exclude: ["**/vendor/**"] } },
  }, descriptor);
  const fragment = toHostConfig(excluded, "oxlint");
  const override = fragment.groups.find((group) => group.excludedFiles !== null);
  assert.ok(override, "no override carries the exclusion");
  assert.deepEqual(override.excludedFiles, ["**/vendor/**"]);
  assert.ok(override.rules["demo/no-explicit-unknown"]);

  const scoped = compileConfig({
    version: 2,
    plugin: "demo",
    paths: { test: [], fixture: [] },
    rules: { "demo/max-params": { level: "error", scope: "test" } },
  }, descriptor);
  assert.throws(() => toHostConfig(scoped, "oxlint"), HostConfigError);
});
