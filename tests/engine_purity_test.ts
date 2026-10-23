/**
 * @module EnginePurityTest
 * @path tests/engine_purity_test.ts
 * @description Keeps the engine package free of consumer names and of imports that leave the package.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [mod.ts, src/engine/plugin.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import * as api from "../mod.ts";
import { main } from "../src/cli/unslop.ts";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, normalize, relative } from "@std/path";

interface ISourceFile {
  readonly path: string;
  readonly text: string;
}

const PACKAGE_ROOT = fromFileUrl(new URL("..", import.meta.url));
const SCANNED = ["src", "tests", "docs", "examples"];
const SCANNED_FILES = ["mod.ts", "README.md", "deno.json"];
const SCANNED_EXTENSIONS = [".ts", ".md", ".json"];
const ALLOWED_PACKAGES = ["@std/", "zod", "typescript", "@dostark/unslop-ts"];
/** Exact-pinned schema validators that only the test suite needs. */
const TEST_ONLY_PACKAGES = ["ajv", "ajv-draft-04", "ajv-formats"];
// The words are joined here so that this file does not contain them.
const FORBIDDEN_WORDS = [
  ["ex", "aix"].join(""),
  ["lint", "policy"].join("-"),
  ["scripts", "config"].join("/"),
  ["code", "style"].join("_"),
];
const IMPORT_PATTERN = /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm;

function isAllowedImport(specifier: string, path: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) return true;
  const testOnly = TEST_ONLY_PACKAGES.some((allowed) => specifier === allowed || specifier.startsWith(`${allowed}/`));
  if (testOnly) return path.startsWith("tests/");
  return ALLOWED_PACKAGES.some((allowed) => specifier === allowed || specifier.startsWith(allowed));
}

/** One message for each forbidden word and for each import that leaves the package. */
function purityViolations(files: readonly ISourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const lower = file.text.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
      if (lower.includes(word)) violations.push(`${file.path}: names '${word}'`);
    }
    if (!file.path.endsWith(".ts")) continue;
    for (const match of file.text.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (!isAllowedImport(specifier, file.path)) violations.push(`${file.path}: imports '${specifier}'`);
    }
  }
  return violations;
}

async function enginePackageFiles(): Promise<ISourceFile[]> {
  const paths = SCANNED_FILES.map((file) => `${PACKAGE_ROOT}${file}`);
  for (const dir of SCANNED) {
    for await (const entry of walk(`${PACKAGE_ROOT}${dir}`, { exts: SCANNED_EXTENSIONS, includeDirs: false })) {
      paths.push(entry.path);
    }
  }
  return await Promise.all(
    paths.map(async (path) => ({ path: relative(PACKAGE_ROOT, path), text: await Deno.readTextFile(path) })),
  );
}

const CLOSURE_ROOT = "mod.ts";
/** Files that the Deno host needs by design: the closure walk does not inspect them. */
const DENO_ONLY = ["deno.ts", "src/engine/run_plugin.ts", "src/report/", "src/rules/whole_tree/", "src/cli/"];
const CLOSURE_BARE_ALLOWED = ["zod"];
const DENO_TOKEN_PATTERN = /\bDeno\./;

function isDenoOnly(path: string): boolean {
  return DENO_ONLY.some((prefix) => prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix);
}

function importedSpecifiers(text: string): string[] {
  return [...text.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2]);
}

function resolveImport(from: string, specifier: string): string {
  return normalize(join(dirname(from), specifier));
}

/** Every non-Deno-only file reachable from the root through static imports and re-exports. */
function closureOf(root: string, files: ReadonlyMap<string, string>): ISourceFile[] {
  const seen = new Set<string>();
  const queue = [root];
  const closure: ISourceFile[] = [];
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const text = files.get(path);
    if (text === undefined || isDenoOnly(path)) continue;
    closure.push({ path, text });
    for (const specifier of importedSpecifiers(text)) {
      if (specifier.startsWith(".")) queue.push(resolveImport(path, specifier));
    }
  }
  return closure;
}

/** One message for each Deno global, CLI import, or foreign bare import in the closure. */
function closureViolations(closure: readonly ISourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of closure) {
    if (DENO_TOKEN_PATTERN.test(file.text)) violations.push(`${file.path}: names the Deno namespace`);
    for (const specifier of importedSpecifiers(file.text)) {
      if (specifier.startsWith(".")) {
        const target = resolveImport(file.path, specifier);
        if (target.startsWith("src/cli/")) violations.push(`${file.path}: imports '${specifier}' from the CLI`);
        continue;
      }
      if (!CLOSURE_BARE_ALLOWED.includes(specifier)) violations.push(`${file.path}: imports '${specifier}'`);
    }
  }
  return violations;
}

async function packageFileMap(): Promise<Map<string, string>> {
  return new Map((await enginePackageFiles()).map((file) => [file.path, file.text]));
}

Deno.test("the engine sources, entry point, tests, docs, and examples name no consumer and import nothing outside the package", async () => {
  assertEquals(purityViolations(await enginePackageFiles()), []);
});

Deno.test("the purity check reports a consumer import and a consumer name in a fixture copy", () => {
  const consumerImport = `import { DEFAULT_RUNTIME_PATH } from "@${["ex", "aix"].join("")}/shared";\n`;
  const violations = purityViolations([{ path: "fixture.ts", text: consumerImport }]);
  assertEquals(violations.length, 2);
  assertEquals(purityViolations([{ path: "ok.ts", text: 'import { join } from "@std/path";\n' }]), []);
});

Deno.test("the purity check allows a validator only in the test suite", () => {
  const validatorImport = `import { Ajv2020 } from "ajv/dist/2020.js";\n`;
  assertEquals(purityViolations([{ path: "src/fixture.ts", text: validatorImport }]), [
    "src/fixture.ts: imports 'ajv/dist/2020.js'",
  ]);
  assertEquals(purityViolations([{ path: "tests/fixture.ts", text: validatorImport }]), []);
});

Deno.test("the purity check rejects a consumer style-guide name in a seeded engine file", () => {
  const guideName = ["CODE", "STYLE"].join("_");
  const violations = purityViolations([{ path: "src/fixture.ts", text: `const guide = "${guideName}.md";` }]);
  assertEquals(violations, [`src/fixture.ts: names '${guideName.toLowerCase()}'`]);
});

Deno.test("engine_suite_and_public_exports", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url))) as {
    exports: Record<string, string>;
    tasks: Record<string, string>;
  };
  assertEquals(config.exports["./cli"], "./src/cli/unslop.ts");
  assertEquals(config.exports["./deno"], "./deno.ts");
  assertEquals(config.exports["./report"], "./src/report/mod.ts");
  assert(typeof config.tasks.cli === "string" && config.tasks.cli.length > 0);
  assertEquals(typeof main, "function");
  const exported = [
    "compileConfig",
    "configJsonSchema",
    "migrateCatalog",
    "semanticCatalogProjection",
    "semanticCompiledProjection",
    "enableRule",
    "disableRule",
    "setOption",
    "unsetOption",
    "WHOLE_TREE_CHECKS",
    "PRESETS",
    "RULE_CATEGORIES",
    "NOT_ENABLED_REASON",
  ];
  for (const name of exported) assert(name in api, name);
  for (const name of ["createLintPlugin", "runPlugin", "createUnslopProject", "collectRunReport", "failingFindings"]) {
    assertFalse(name in api, name);
  }
});

Deno.test("the import closure of the root export uses no Deno global and only zod", async () => {
  assertEquals(closureViolations(closureOf(CLOSURE_ROOT, await packageFileMap())), []);
});

Deno.test("the closure check rejects a Deno global, a foreign import, and a CLI import in a seeded closure", () => {
  const denoGlobal = [{ path: "src/engine/seeded.ts", text: 'const home = Deno.env.get("HOME");\n' }];
  assertEquals(closureViolations(denoGlobal), ["src/engine/seeded.ts: names the Deno namespace"]);
  assertEquals(closureViolations([{ path: "src/engine/seeded.ts", text: 'import { join } from "@std/path";\n' }]), [
    "src/engine/seeded.ts: imports '@std/path'",
  ]);
  assertEquals(closureViolations([{ path: "src/engine/seeded.ts", text: 'import eslint from "eslint";\n' }]), [
    "src/engine/seeded.ts: imports 'eslint'",
  ]);
  const cliImport = 'import type { IResolvedSelection } from "../cli/selection.ts";\n';
  assertEquals(closureViolations([{ path: "src/report/collect.ts", text: cliImport }]), [
    "src/report/collect.ts: imports '../cli/selection.ts' from the CLI",
  ]);
});

Deno.test("the closure check skips a seeded Deno global in a Deno-only file", () => {
  const files = new Map([["src/cli/seeded.ts", 'const home = Deno.env.get("HOME");\n']]);
  assertEquals(closureViolations(closureOf("src/cli/seeded.ts", files)), []);
});

Deno.test("draft04_validator_is_test_only", () => {
  const adapterImport = `import Ajv04 from "ajv-draft-04";\n`;
  assertEquals(purityViolations([{ path: "src/fixture.ts", text: adapterImport }]), [
    "src/fixture.ts: imports 'ajv-draft-04'",
  ]);
  assertEquals(purityViolations([{ path: "tests/fixture.ts", text: adapterImport }]), []);
});

Deno.test("consumer_snapshot_stays_out_of_engine", async () => {
  const consumerPath = ["packages", ["lint", "policy"].join("-")].join("/");
  const files = await enginePackageFiles();
  assert(files.every((file) => !file.text.toLowerCase().includes(consumerPath.toLowerCase())));
  const snapshotImport = `import catalog from "../../${consumerPath}/tests/fixtures/catalog_v1.json";\n`;
  assert(purityViolations([{ path: "tests/fixture.ts", text: snapshotImport }]).length > 0);
});

Deno.test("the import closure of the eslint entry imports only zod", async () => {
  assertEquals(closureViolations(closureOf("eslint.ts", await packageFileMap())), []);
});

Deno.test("the closure check rejects a seeded eslint import in the eslint entry", () => {
  assertEquals(closureViolations([{ path: "eslint.ts", text: 'import { RuleTester } from "eslint";\n' }]), [
    "eslint.ts: imports 'eslint'",
  ]);
});
