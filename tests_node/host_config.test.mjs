// deno-lint-ignore-file -- generated configurations are imported at test time
/**
 * @module HostConfigTest
 * @path tests_node/host_config.test.mjs
 * @description Checks the generated host fragments, the skipped rules, and the wrapper's safe writes.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Linter } from "eslint";
import parser from "@typescript-eslint/parser";
import {
  compileConfig,
  DENO_RULE_PACK,
  HostConfigError,
  renderEslintFragment,
  renderOxlintFragment,
  toHostConfig,
  TYPESCRIPT_RULE_PACK,
} from "../mod.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER = join(ROOT, "scripts", "to_host_config.mjs");
const GOLDENS = join(ROOT, "tests", "fixtures", "host_config");
const ROOT_URL = pathToFileURL(`${ROOT}/`);
const DESCRIPTOR = {
  pluginName: "demo",
  rootUrl: ROOT_URL,
  configUrl: new URL("examples/unslop.config.json", ROOT_URL),
  lintConfigUrl: new URL("deno.json", ROOT_URL),
  pluginUrl: new URL("examples/lint_plugin.ts", ROOT_URL),
  packs: [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {},
};
const MANY_PARAMS = "export function run(a, b, c, d, e, f, g, h) { return a; }\n";

function compiledRule(rules, paths = { test: [], fixture: [] }) {
  return compileConfig({ version: 2, plugin: "demo", paths, rules }, DESCRIPTOR);
}

async function generatedEslint(compiled) {
  const dir = await mkdtemp(join(tmpdir(), "unslop-generated-eslint-"));
  const source = renderEslintFragment(toHostConfig(compiled, "eslint"), "demo")
    .replace('"@dostark/unslop-ts/eslint"', JSON.stringify(pathToFileURL(join(ROOT, "eslint.ts")).href))
    .replace('"@dostark/unslop-ts"', JSON.stringify(pathToFileURL(join(ROOT, "mod.ts")).href));
  const path = join(dir, "fragment.mjs");
  await writeFile(path, source);
  const module = await import(pathToFileURL(path).href);
  return {
    verify: (filename, code = MANY_PARAMS) =>
      new Linter().verify(code, [
        ...module.default,
        { files: ["**/*.ts"], languageOptions: { parser } },
      ], { filename }).filter((message) => message.ruleId?.startsWith("demo/")),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

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
    const module = await import(pathToFileURL(fragment).href);
    assert.equal(Array.isArray(module.default), true);
    assert.equal(typeof module.default[0].plugins.demo.create, "undefined");
    assert.equal(typeof module.default[0].plugins.demo.rules["no-explicit-unknown"].create, "function");
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

test("a generated custom-name fragment runs its rule in ESLint", async () => {
  const host = await generatedEslint(compiledRule({ "demo/max-params": { level: "error" } }));
  try {
    assert.deepEqual(host.verify("src/a.ts").map((message) => message.ruleId), ["demo/max-params"]);
  } finally {
    await host.cleanup();
  }
});

test("test scope and include both restrict generated ESLint rules", async () => {
  const compiled = compiledRule(
    { "demo/max-params": { level: "error", scope: "test", include: ["src/**"] } },
    { test: ["**/*_test.ts"], fixture: [] },
  );
  const host = await generatedEslint(compiled);
  try {
    assert.equal(host.verify("src/a_test.ts").length, 1);
    assert.equal(host.verify("src/a.ts").length, 0);
    assert.equal(host.verify("other/a_test.ts").length, 0);
  } finally {
    await host.cleanup();
  }
});

test("test scope without globs and an Oxlint intersection fail with the rule id", () => {
  const empty = compiledRule({ "demo/max-params": { level: "error", scope: "test" } });
  for (const host of ["eslint", "oxlint"]) {
    assert.throws(
      () => toHostConfig(empty, host),
      (error) => error instanceof HostConfigError && error.message.includes("demo/max-params"),
    );
  }
  const intersected = compiledRule(
    { "demo/max-params": { level: "error", scope: "test", include: ["src/**"] } },
    { test: ["**/*_test.ts"], fixture: [] },
  );
  assert.throws(
    () => toHostConfig(intersected, "oxlint"),
    (error) => error instanceof HostConfigError && error.message.includes("demo/max-params"),
  );
});

test("distinct comma-bearing include arrays remain separate groups", () => {
  const compiled = compiledRule({
    "demo/max-params": { level: "error", include: ["src/a,b/**"] },
    "demo/no-explicit-unknown": { level: "error", include: ["src/a", "b/**"] },
  });
  const fragment = toHostConfig(compiled, "eslint");
  const scoped = fragment.groups.filter((group) =>
    Object.keys(group.rules).some((id) => ["demo/max-params", "demo/no-explicit-unknown"].includes(id))
  );
  assert.equal(scoped.length, 2);
  assert.deepEqual(scoped.map((group) => group.files), [["src/a", "b/**"], ["src/a,b/**"]]);
});

test("generated full-id docs reach ESLint hints", async () => {
  const docs = "https://example.test/custom-max-params";
  const host = await generatedEslint(compiledRule({
    "demo/max-params": { level: "error", docs },
  }));
  try {
    assert.match(host.verify("src/a.ts")[0].message, /https:\/\/example\.test\/custom-max-params/);
  } finally {
    await host.cleanup();
  }
});

test("Oxlint loads a generated exclusion and skips only the excluded path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "unslop-generated-oxlint-"));
  try {
    const fragment = toHostConfig(
      compiledRule({
        "demo/max-params": {
          level: "error",
          exclude: ["**/excluded/**"],
          docs: "https://example.test/oxlint-max-params",
        },
      }),
      "oxlint",
    );
    await writeFile(join(dir, "oxlintrc.json"), renderOxlintFragment(fragment));
    await writeFile(
      join(dir, "unslop.plugin.mjs"),
      [
        `import { createEslintPlugin } from ${JSON.stringify(pathToFileURL(join(ROOT, "eslint.ts")).href)};`,
        `import { TYPESCRIPT_RULE_PACK, DENO_RULE_PACK } from ${
          JSON.stringify(pathToFileURL(join(ROOT, "mod.ts")).href)
        };`,
        'export default createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "demo" });',
        "",
      ].join("\n"),
    );
    const included = join(dir, "included.ts");
    const excluded = join(dir, "excluded", "excluded.ts");
    await mkdir(dirname(excluded), { recursive: true });
    await writeFile(included, MANY_PARAMS);
    await writeFile(excluded, MANY_PARAMS);
    const result = spawnSync(join(ROOT, "node_modules", ".bin", "oxlint"), [
      "-c",
      join(dir, "oxlintrc.json"),
      "--format=json",
      included,
      excluded,
    ], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const diagnostics = JSON.parse(result.stdout).diagnostics.filter((entry) => entry.code === "demo(max-params)");
    assert.equal(diagnostics.length, 1, result.stdout + result.stderr);
    assert.match(diagnostics[0].filename ?? diagnostics[0].filePath ?? "", /included\.ts$/);
    assert.match(diagnostics[0].message, /https:\/\/example\.test\/oxlint-max-params/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
