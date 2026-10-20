/**
 * @module WholeTreeCliTest
 * @path tests/whole_tree_cli_test.ts
 * @description The whole-tree CLI reads its settings from `--catalog` and exits 2 on a missing or invalid catalog.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/cli/whole_tree.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runDeno } from "./helpers/demo_project.ts";

const CLI = new URL("../src/cli/whole_tree.ts", import.meta.url).href;
const USAGE_EXIT = 2;

const CATALOG = {
  version: "1",
  wholeTree: {
    constantRestatement: { constantModules: ["src/constants.ts"], testRoots: ["tests"], minRestatedElements: 2 },
  },
};

async function inTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "whole_tree_cli_" });
  try {
    return await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("whole_tree without --catalog exits 2 and prints usage", async () => {
  await inTempDir(async (dir) => {
    const result = await runDeno(["run", "-A", CLI, "--rule=constant-restatement"], dir);
    assertEquals(result.code, USAGE_EXIT);
    assertStringIncludes(result.stderr, "--catalog=<path>");
  });
});

Deno.test("whole_tree with an invalid catalog exits 2 and prints the JSON path", async () => {
  await inTempDir(async (dir) => {
    const broken = { version: "1", wholeTree: { constantRestatement: { constantModules: [], testRoots: [] } } };
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(broken));
    const result = await runDeno(["run", "-A", CLI, "--rule=constant-restatement", "--catalog=catalog.json"], dir);
    assertEquals(result.code, USAGE_EXIT);
    assertStringIncludes(result.stderr, "wholeTree.constantRestatement.minRestatedElements");
  });
});

Deno.test("whole_tree exits 2 when the catalog lacks the section the rule needs", async () => {
  await inTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify({ version: "1" }));
    const result = await runDeno(["run", "-A", CLI, "--rule=unused-exports", "--catalog=catalog.json"], dir);
    assertEquals(result.code, USAGE_EXIT);
    assertStringIncludes(result.stderr, "unusedExports");
  });
});

Deno.test("whole_tree reads the restatement settings from --catalog", async () => {
  await inTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "src"));
    await Deno.mkdir(join(dir, "tests"));
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(CATALOG));
    await Deno.writeTextFile(join(dir, "src/constants.ts"), 'export const HOSTS = ["a.test", "b.test"];\n');
    await Deno.writeTextFile(join(dir, "tests/hosts_test.ts"), 'export const FLAG = "a.test,b.test";\n');
    const result = await runDeno(["run", "-A", CLI, "--rule=constant-restatement", "--catalog=catalog.json"], dir);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "restates HOSTS");
  });
});

const DUPLICATE_CATALOG = {
  version: "1",
  scopes: { test: ["**/tests/**"], fixture: [] },
  rules: {
    "demo/duplicate-type": {
      engine: "script",
      severity: "error",
      scope: "prod",
      tags: ["duplication"],
      include: ["packages/**"],
      options: { allow: [] },
    },
    "demo/duplicate-constant": {
      engine: "script",
      severity: "error",
      scope: "prod",
      tags: ["duplication"],
      include: ["packages/**"],
      options: {
        allow: [{ name: "GONE", files: ["packages/a/a.ts", "packages/b/b.ts"], reason: "Stale on purpose." }],
      },
    },
  },
};

async function writeDuplicateProject(dir: string): Promise<void> {
  for (const pkg of ["a", "b"]) await Deno.mkdir(join(dir, "packages", pkg, "tests"), { recursive: true });
  await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(DUPLICATE_CATALOG));
  const shape = "export interface IThing { a: string; b: number; }\nexport const LIMIT = 3;\n";
  await Deno.writeTextFile(join(dir, "packages/a/a.ts"), shape);
  await Deno.writeTextFile(join(dir, "packages/b/b.ts"), shape);
  await Deno.writeTextFile(join(dir, "packages/b/tests/b_test.ts"), shape);
}

Deno.test("whole_tree reports a duplicate type in production files and ignores test files", async () => {
  await inTempDir(async (dir) => {
    await writeDuplicateProject(dir);
    const result = await runDeno(["run", "-A", CLI, "--rule=duplicate-type", "--catalog=catalog.json"], dir);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stdout, "ERROR [duplicate-type] packages/b/b.ts");
    assertStringIncludes(result.stdout, "'IThing' duplicates packages/a/a.ts");
    assertEquals(result.stdout.includes("tests/b_test.ts"), false);
  });
});

Deno.test("whole_tree reports a duplicate constant and a stale allow entry", async () => {
  await inTempDir(async (dir) => {
    await writeDuplicateProject(dir);
    const result = await runDeno(["run", "-A", CLI, "--rule=duplicate-constant", "--catalog=catalog.json"], dir);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stdout, "ERROR [duplicate-constant] packages/b/b.ts");
    assertStringIncludes(result.stdout, "the allow entry 'GONE' matches no current duplicate");
  });
});

Deno.test("whole_tree passes a tree without duplicates", async () => {
  await inTempDir(async (dir) => {
    await writeDuplicateProject(dir);
    await Deno.remove(join(dir, "packages/b/b.ts"));
    const result = await runDeno(["run", "-A", CLI, "--rule=duplicate-type", "--catalog=catalog.json"], dir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "No duplicate types found");
  });
});

Deno.test("whole_tree exits 2 when the catalog has no entry for the duplicate rule", async () => {
  await inTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "catalog.json"),
      JSON.stringify({ version: "1", scopes: { test: [], fixture: [] }, rules: {} }),
    );
    const result = await runDeno(["run", "-A", CLI, "--rule=duplicate-type", "--catalog=catalog.json"], dir);
    assertEquals(result.code, USAGE_EXIT);
    assertStringIncludes(result.stderr, "duplicate-type");
  });
});
