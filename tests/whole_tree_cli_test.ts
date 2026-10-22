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
import { CLI_PATH, withCliProject } from "./helpers/cli_project.ts";
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

const MAGIC_CATALOG = {
  version: "1",
  scopes: { test: ["**/tests/**"], fixture: [] },
  wholeTree: { magicLiterals: { statusLiterals: ["skipped-state"] } },
};

const MAGIC_SOURCE = Array.from({ length: 4 }, (_, index) => `export const v${index} = ["repeated literal text"];`)
  .join("\n");

async function writeMagicProject(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, "src"));
  await Deno.mkdir(join(dir, "tests"));
  await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(MAGIC_CATALOG));
  await Deno.writeTextFile(join(dir, "src/a.ts"), MAGIC_SOURCE);
  await Deno.writeTextFile(join(dir, "tests/a_test.ts"), MAGIC_SOURCE.replaceAll("repeated", "another"));
}

Deno.test("whole_tree reports a repeated literal in production files and skips test files", async () => {
  await inTempDir(async (dir) => {
    await writeMagicProject(dir);
    const result = await runDeno(["run", "-A", CLI, "--rule=magic-literals", "--catalog=catalog.json"], dir);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, '"repeated literal text"');
    assertStringIncludes(result.stderr, "src/a.ts: 4 occurrences");
    assertEquals(result.stderr.includes("another literal text"), false);
  });
});

Deno.test("whole_tree counts test files with --include-tests", async () => {
  await inTempDir(async (dir) => {
    await writeMagicProject(dir);
    const result = await runDeno(
      ["run", "-A", CLI, "--rule=magic-literals", "--catalog=catalog.json", "--include-tests"],
      dir,
    );
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "another literal text");
  });
});

Deno.test("whole_tree passes a tree whose repeated literal is a listed status word", async () => {
  await inTempDir(async (dir) => {
    await writeMagicProject(dir);
    await Deno.writeTextFile(join(dir, "src/a.ts"), MAGIC_SOURCE.replaceAll("repeated literal text", "skipped-state"));
    const result = await runDeno(["run", "-A", CLI, "--rule=magic-literals", "--catalog=catalog.json"], dir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "No magic value violations detected");
  });
});

Deno.test("config_print_output_is_a_working_whole_tree_catalog", async () => {
  await withCliProject(async (dir) => {
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.mkdir(join(dir, "tests"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "constants.ts"), 'export const ITEMS = ["alpha", "beta"];\n');
    await Deno.writeTextFile(
      join(dir, "tests", "example_test.ts"),
      'import { ITEMS } from "../src/constants.ts";\nexport const count = ITEMS.length;\n',
    );
    const printed = await runDeno(["run", "--allow-read", "--allow-env", CLI_PATH, "config", "print"], dir);
    assertEquals(printed.code, 0, printed.stderr);
    await Deno.writeTextFile(join(dir, "printed_catalog.json"), printed.stdout);
    const result = await runDeno(
      ["run", "-A", CLI, "--rule=constant-restatement", "--catalog=printed_catalog.json"],
      dir,
    );
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "No constant restatements found");
  });
});
