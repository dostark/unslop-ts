/**
 * @module WholeTreeUnusedFilesManifestTest
 * @path tests/whole_tree_unused_files_manifest_test.ts
 * @description The manifest mode of the unused-files rule takes its entry points from deno.json and package.json, follows the import maps, and reports every scanned file that no entry reaches.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/whole_tree/unused_files_manifest.ts, src/rules/whole_tree/manifest_entries.ts]
 */

import { assertEquals } from "@std/assert";
import { checkManifestRepository } from "../src/rules/whole_tree/unused_files_manifest.ts";
import type { IUnusedFilesManifestSettings } from "../src/rules/whole_tree/options.ts";
import { withRepo, write } from "./helpers/temp_repo.ts";

const MANIFEST_DEFAULTS: IUnusedFilesManifestSettings = {
  walkSkipPatterns: ["node_modules"],
  extraEntries: [],
  referenceGlobs: [],
};

async function unreached(root: string, overrides: Partial<IUnusedFilesManifestSettings> = {}): Promise<string[]> {
  const report = await checkManifestRepository(root, { ...MANIFEST_DEFAULTS, ...overrides });
  return report.findings.map((finding) => finding.repoPath);
}

function denoJson(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest, null, 2);
}

Deno.test("a script named by a task is reached and an unlisted script is reported", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({ tasks: { check: "deno run -A scripts/check.ts --flag" } }));
    await write(root, "scripts/check.ts", "export const check = 1;\n");
    await write(root, "scripts/old.ts", "export const old = 1;\n");
    assertEquals(await unreached(root), ["scripts/old.ts"]);
  });
});

Deno.test("a member export reaches its module and a barrel that nothing names is reported", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({ workspace: ["./packages/p"] }));
    await write(root, "packages/p/deno.json", denoJson({ exports: { ".": "./mod.ts", "./util": "./src/util.ts" } }));
    await write(root, "packages/p/mod.ts", 'export * from "./src/live.ts";\n');
    await write(root, "packages/p/src/live.ts", "export const live = 1;\n");
    await write(root, "packages/p/src/util.ts", "export const util = 1;\n");
    await write(root, "packages/p/src/mod.ts", 'export * from "./live.ts";\n');
    assertEquals(await unreached(root), ["packages/p/src/mod.ts"]);
  });
});

Deno.test("a file that the Deno test discovery picks up is an entry and a helper without the test suffix is not", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({}));
    await write(root, "tests/a_test.ts", 'import "./shared.ts";\n');
    await write(root, "tests/b.test.ts", "export const b = 1;\n");
    await write(root, "tests/shared.ts", "export const shared = 1;\n");
    await write(root, "tests/benchmark.ts", 'Deno.test("never discovered", () => {});\n');
    assertEquals(await unreached(root), ["tests/benchmark.ts"]);
  });
});

Deno.test("the test include and exclude lists of the root manifest limit the test discovery", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({ test: { include: ["tests/"], exclude: ["tests/fixtures/"] } }));
    await write(root, "tests/a_test.ts", "export const a = 1;\n");
    await write(root, "tests/fixtures/f_test.ts", "export const f = 1;\n");
    await write(root, "other/o_test.ts", "export const o = 1;\n");
    assertEquals(await unreached(root), ["other/o_test.ts", "tests/fixtures/f_test.ts"]);
  });
});

Deno.test("an import map entry resolves a bare specifier, and only a trailing slash makes a prefix", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "deno.json",
      denoJson({
        tasks: { start: "deno run main.ts" },
        imports: { "@lib": "./lib/mod.ts", "@lib/": "./lib/src/", "jsr:ignored": "jsr:@std/path@1" },
      }),
    );
    await write(root, "main.ts", 'import "@lib";\nimport "@lib/deep.ts";\nimport "@lib/missing.ts";\n');
    await write(root, "lib/mod.ts", "export const mod = 1;\n");
    await write(root, "lib/src/deep.ts", "export const deep = 1;\n");
    await write(root, "lib/src/orphan.ts", "export const orphan = 1;\n");
    assertEquals(await unreached(root), ["lib/src/orphan.ts"]);
  });
});

Deno.test("a package.json main, bin, exports, and script path are entries", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "package.json",
      JSON.stringify({
        main: "./lib/main.js",
        bin: { tool: "./bin/tool.mjs" },
        exports: { ".": { import: "./lib/esm.js", require: "./lib/cjs.cjs" } },
        scripts: { build: "node scripts/build.mjs --out dist" },
      }),
    );
    for (const path of ["lib/main.js", "bin/tool.mjs", "lib/esm.js", "lib/cjs.cjs", "scripts/build.mjs"]) {
      await write(root, path, "export {};\n");
    }
    await write(root, "lib/dead.js", "export {};\n");
    assertEquals(await unreached(root), ["lib/dead.js"]);
  });
});

Deno.test("a deno.json lint plugin is an entry", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({ lint: { plugins: ["./lint/plugin.ts"] } }));
    await write(root, "lint/plugin.ts", 'import "./rules.ts";\n');
    await write(root, "lint/rules.ts", "export const rules = 1;\n");
    assertEquals(await unreached(root), []);
  });
});

Deno.test("a dynamic import and a relative URL string reach their target", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({ tasks: { run: "deno run main.ts" } }));
    await write(
      root,
      "main.ts",
      'const lazy = await import("./lazy.ts");\nconst worker = new URL("./tools/worker.ts", import.meta.url);\nconsole.log(lazy, worker);\n',
    );
    await write(root, "lazy.ts", "export const lazy = 1;\n");
    await write(root, "tools/worker.ts", "export const worker = 1;\n");
    await write(root, "tools/unused.ts", "export const unused = 1;\n");
    assertEquals(await unreached(root), ["tools/unused.ts"]);
  });
});

Deno.test("a repository-relative path string reaches a script and a prose word does not", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({ tasks: { run: "deno run main.ts" } }));
    await write(
      root,
      "main.ts",
      'const spawned = ["run", "$REPO_ROOT/scripts/spawned.ts"];\nconst note = "see scripts/mentioned.txt";\nconsole.log(spawned, note);\n',
    );
    await write(root, "scripts/spawned.ts", "export const spawned = 1;\n");
    await write(root, "scripts/unspawned.ts", "export const unspawned = 1;\n");
    assertEquals(await unreached(root), ["scripts/unspawned.ts"]);
  });
});

Deno.test("a configured reference file reaches the paths it names and an unlisted file does not", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({}));
    await write(root, "scenarios/live.yaml", 'command: "deno run $REPO_ROOT/scripts/from_yaml.ts"\n');
    await write(root, "site/index.html", '<script src="assets/deck.js"></script>\n');
    await write(root, "site/assets/deck.js", "export {};\n");
    await write(root, "data/baseline.json", '{"file":"scripts/only_in_json.ts"}\n');
    await write(root, "scripts/from_yaml.ts", "export {};\n");
    await write(root, "scripts/only_in_json.ts", "export {};\n");
    const dead = await unreached(root, { referenceGlobs: ["scenarios/**/*.yaml", "**/*.html"] });
    assertEquals(dead, ["scripts/only_in_json.ts"]);
  });
});

Deno.test("an extra entry glob and a walk skip pattern shape the scan", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({}));
    await write(root, "tools/one.ts", "export {};\n");
    await write(root, "tools/nested/two.ts", "export {};\n");
    await write(root, "vendor/skipped.ts", "export {};\n");
    await write(root, "src/dead.ts", "export {};\n");
    const dead = await unreached(root, { extraEntries: ["tools/**/*.ts"], walkSkipPatterns: ["vendor"] });
    assertEquals(dead, ["src/dead.ts"]);
  });
});

Deno.test("a manifest with a test section or a deno test task owns the tests below it", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "deno.json",
      denoJson({ workspace: ["./packages/p", "./lib"], test: { include: ["packages/"] } }),
    );
    await write(root, "packages/p/deno.json", denoJson({}));
    await write(root, "packages/p/tests/p_test.ts", "export {};\n");
    await write(root, "tests/outside_test.ts", "export {};\n");
    await write(root, "lib/deno.json", denoJson({ tasks: { test: "deno test --allow-all" } }));
    await write(root, "lib/tests/l_test.ts", "export {};\n");
    await write(root, "sub/deno.json", denoJson({ test: { exclude: ["tests/skipped/"] } }));
    await write(root, "sub/tests/s_test.ts", "export {};\n");
    await write(root, "sub/tests/skipped/k_test.ts", "export {};\n");
    assertEquals(await unreached(root), ["sub/tests/skipped/k_test.ts", "tests/outside_test.ts"]);
  });
});

Deno.test("a task that runs tests makes its glob an entry and a cd prefix moves the base directory", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "hosts/package.json",
      JSON.stringify({
        scripts: {
          "test:node": 'cd .. && node --test "tests_node/**/*.test.mjs"',
          "test:one": "cd .. && node --test tests_node/single.mjs",
        },
      }),
    );
    await write(root, "tests_node/a.test.mjs", 'import "./shared.mjs";\n');
    await write(root, "tests_node/nested/b.test.mjs", "export {};\n");
    await write(root, "tests_node/shared.mjs", "export {};\n");
    await write(root, "tests_node/single.mjs", "export {};\n");
    await write(root, "tests_node/unlisted.mjs", "export {};\n");
    await write(root, "deno.json", denoJson({ tasks: { format: "deno fmt tools/**/*.ts" } }));
    await write(root, "tools/formatted.ts", "export {};\n");
    assertEquals(await unreached(root), ["tests_node/unlisted.mjs", "tools/formatted.ts"]);
  });
});

Deno.test("a variable-prefixed mention resolves against each ancestor directory of the file that holds it", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", denoJson({}));
    await write(root, "suite/cases/deep/case.yaml", 'run: "$SUITE_HOME/scripts/helper.ts"\nother: "scripts/bare.ts"\n');
    await write(root, "suite/scripts/helper.ts", "export {};\n");
    await write(root, "suite/scripts/bare.ts", "export {};\n");
    assertEquals(await unreached(root, { referenceGlobs: ["suite/**/*.yaml"] }), ["suite/scripts/bare.ts"]);
  });
});
