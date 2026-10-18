/**
 * @module EnginePurityTest
 * @path tests/engine_purity_test.ts
 * @description Keeps the engine package free of consumer names and of imports that leave the package.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [mod.ts, src/engine/plugin.ts]
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

interface ISourceFile {
  readonly path: string;
  readonly text: string;
}

const PACKAGE_ROOT = fromFileUrl(new URL("..", import.meta.url));
const SCANNED = ["src", "tests", "docs", "examples"];
const SCANNED_FILES = ["mod.ts", "README.md", "deno.json"];
const SCANNED_EXTENSIONS = [".ts", ".md", ".json"];
const ALLOWED_PACKAGES = ["@std/", "zod", "typescript", "@dostark/unslop-ts"];
// The words are joined here so that this file does not contain them.
const FORBIDDEN_WORDS = [["ex", "aix"].join(""), ["lint", "policy"].join("-"), ["scripts", "config"].join("/")];
const IMPORT_PATTERN = /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm;

function isAllowedImport(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) return true;
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
      if (!isAllowedImport(specifier)) violations.push(`${file.path}: imports '${specifier}'`);
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

Deno.test("the engine sources, entry point, tests, docs, and examples name no consumer and import nothing outside the package", async () => {
  assertEquals(purityViolations(await enginePackageFiles()), []);
});

Deno.test("the purity check reports a consumer import and a consumer name in a fixture copy", () => {
  const consumerImport = `import { DEFAULT_RUNTIME_PATH } from "@${["ex", "aix"].join("")}/shared";\n`;
  const violations = purityViolations([{ path: "fixture.ts", text: consumerImport }]);
  assertEquals(violations.length, 2);
  assertEquals(purityViolations([{ path: "ok.ts", text: 'import { join } from "@std/path";\n' }]), []);
});
