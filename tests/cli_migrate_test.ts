/**
 * @module CliMigrateTest
 * @path tests/cli_migrate_test.ts
 * @description The migrate route bootstraps a v1-only project, refuses unsafe destinations, and rolls back a failed second output.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [src/cli/commands/migrate.ts, src/cli/safe_write.ts, tests/helpers/migration_descriptor.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { PartialWriteError, writeMigrationPair } from "../src/cli/safe_write.ts";
import { CLI_PATH } from "./helpers/cli_project.ts";
import { runDeno } from "./helpers/demo_project.ts";

const DESCRIPTOR_SOURCE = `import { z } from "zod";
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
  wholeTreeHosts: {},
};
`;

const V1_CATALOG = {
  version: "1",
  scopes: {
    test: ["**/*_test.ts"],
    fixture: ["**/tests/fixtures/**"],
  },
  layout: { sourceRoots: ["src"] },
  tagVocabulary: {
    "type-safety": { description: "Rules that keep type evidence." },
    scripts: { description: "Rules about runnable script headers." },
  },
  rules: {
    "demo/no-chained-type-assertions": {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: ["type-safety"],
    },
    "project-check": {
      engine: "script",
      severity: "warn",
      scope: "all",
      tags: ["scripts"],
      options: { threshold: 2 },
      limits: "A consumer limit.",
    },
  },
};

const V2_PLUGIN_SOURCE = `import { createUnslopProject } from "@dostark/unslop-ts";
import { descriptor } from "./unslop.project.ts";
import config from "../unslop.config.json" with { type: "json" };

export const project = createUnslopProject({ descriptor, config });

export default project.plugin;
`;

const BROKEN_PLUGIN_SOURCE = 'throw new Error("the plugin must not load during migration");\n';
const VIOLATION = "export const value = 1 as never as number;\n";

/** Migration writes, so the spawned CLI gets write access on top of read and env. */
async function runMigrateCli(
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runDeno(["run", "--allow-read", "--allow-write", "--allow-env", CLI_PATH, ...args], cwd);
}

interface IProjectPaths {
  readonly dir: string;
  readonly catalog: string;
  readonly descriptor: string;
  readonly config: string;
  readonly layout: string;
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

async function withV1Project(body: (paths: IProjectPaths) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_migrate_" });
  try {
    await Deno.mkdir(join(dir, "examples"));
    const own = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
    const engineUrl = new URL("../mod.ts", import.meta.url).href;
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      lintConfig(engineUrl, own.imports.zod, "./examples/broken_plugin.ts"),
    );
    await Deno.writeTextFile(join(dir, "examples", "unslop.project.ts"), DESCRIPTOR_SOURCE);
    await Deno.writeTextFile(join(dir, "examples", "broken_plugin.ts"), BROKEN_PLUGIN_SOURCE);
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(V1_CATALOG, null, 2));
    await body({
      dir,
      catalog: join(dir, "catalog.json"),
      descriptor: join(dir, "examples", "unslop.project.ts"),
      config: join(dir, "unslop.config.json"),
      layout: join(dir, "layout.json"),
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const MIGRATE_ARGS = [
  "migrate",
  "--descriptor=examples/unslop.project.ts",
  "--from=catalog.json",
  "--out=unslop.config.json",
  "--layout-out=layout.json",
];

Deno.test("v1_only_project_migrates_without_v2_import", async () => {
  await withV1Project(async (paths) => {
    const before = await Deno.readTextFile(paths.catalog);
    const migrated = await runMigrateCli(paths.dir, MIGRATE_ARGS);
    assertEquals(migrated.code, 0, migrated.stderr);
    assertStringIncludes(migrated.stdout, paths.config);
    assertStringIncludes(migrated.stdout, paths.layout);
    assertEquals(await Deno.readTextFile(paths.catalog), before);
    const config = JSON.parse(await Deno.readTextFile(paths.config)) as { version: number; plugin: string };
    assertEquals(config.version, 2);
    assertEquals(config.plugin, "demo");
    assertEquals(JSON.parse(await Deno.readTextFile(paths.layout)), V1_CATALOG.layout);

    const own = JSON.parse(await Deno.readTextFile(join(paths.dir, "deno.json")));
    await Deno.writeTextFile(join(paths.dir, "examples", "lint_plugin.ts"), V2_PLUGIN_SOURCE);
    await Deno.writeTextFile(
      join(paths.dir, "deno.json"),
      lintConfig(own.imports["@dostark/unslop-ts"], own.imports.zod, "./examples/lint_plugin.ts"),
    );
    await Deno.writeTextFile(join(paths.dir, "violation.ts"), VIOLATION);
    const lint = await runDeno(["lint", "--json", "violation.ts"], paths.dir);
    const codes = ((JSON.parse(lint.stdout) as { diagnostics?: { code?: string }[] }).diagnostics ?? [])
      .map((diagnostic) => diagnostic.code);
    assert(codes.includes("demo/no-chained-type-assertions"), lint.stdout);
  });
});

Deno.test("migration_refuses_existing_aliased_or_symlink_outputs", async () => {
  await withV1Project(async (paths) => {
    const layoutArgs = "--layout-out=layout.json";
    const cases: readonly (readonly string[])[] = [
      ["migrate", "--descriptor=examples/unslop.project.ts", "--from=catalog.json", "--out=catalog.json", layoutArgs],
      [
        "migrate",
        "--descriptor=examples/unslop.project.ts",
        "--from=catalog.json",
        "--out=same.json",
        "--layout-out=same.json",
      ],
      ["migrate", "--descriptor=examples/unslop.project.ts", "--from=catalog.json", "--out=unslop.config.json"],
      ["migrate", "--descriptor=examples/unslop.project.ts", "--from=catalog.json", "--out=existing.json", layoutArgs],
      ["migrate", "--descriptor=examples/unslop.project.ts", "--from=catalog.json", "--out=link.json", layoutArgs],
      ["migrate", "--descriptor=examples/unslop.project.ts", "--from=catalog.json", "--out=locked.json", layoutArgs],
    ];
    await Deno.writeTextFile(join(paths.dir, "existing.json"), "{}\n");
    await Deno.writeTextFile(join(paths.dir, "target.json"), "{}\n");
    await Deno.symlink(join(paths.dir, "target.json"), join(paths.dir, "link.json"));
    await Deno.writeTextFile(join(paths.dir, ".locked.json.unslop.lock"), "");

    for (const args of cases) {
      const result = await runMigrateCli(paths.dir, args);
      assertEquals(result.code, 2, `${args.join(" ")}: ${result.stderr}`);
    }
    assertEquals(await exists(paths.config), false);
    assertEquals(await exists(paths.layout), false);
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function leftovers(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.includes(".unslop")) names.push(entry.name);
  }
  return names.sort();
}

Deno.test("migration_second_output_failure_is_recoverable", async () => {
  const dir = await Deno.makeTempDir({ prefix: "unslop_write_" });
  try {
    const configPath = join(dir, "unslop.config.json");
    const layoutPath = join(dir, "layout.json");
    const ok = await writeMigrationPair({
      config: { path: configPath, contents: "config\n" },
      layout: { path: layoutPath, contents: "layout\n" },
      sources: [],
    });
    assertEquals(ok.configPath, join(await Deno.realPath(dir), "unslop.config.json"));
    assertEquals(await Deno.readTextFile(configPath), "config\n");
    assertEquals(await Deno.readTextFile(layoutPath), "layout\n");
    assertEquals(await leftovers(dir), []);
    await Deno.remove(configPath);
    await Deno.remove(layoutPath);

    const external = "external writer\n";
    const recoverable = await assertRejects(async () =>
      await writeMigrationPair({
        config: { path: configPath, contents: "config\n" },
        layout: { path: layoutPath, contents: "layout\n" },
        sources: [],
        hooks: {
          afterLayoutLinked: async (linked) => {
            await Deno.writeTextFile(linked.configPath, external);
          },
        },
      })
    );
    assert(!(recoverable instanceof PartialWriteError));
    assertEquals(await exists(layoutPath), false);
    assertEquals(await Deno.readTextFile(configPath), external);
    assertEquals(await leftovers(dir), []);
    await Deno.remove(configPath);

    const partial = await assertRejects(async () =>
      await writeMigrationPair({
        config: { path: configPath, contents: "config\n" },
        layout: { path: layoutPath, contents: "layout\n" },
        sources: [],
        hooks: {
          afterLayoutLinked: async (linked) => {
            await Deno.writeTextFile(linked.configPath, external);
            await Deno.remove(linked.layoutPath);
            await Deno.mkdir(linked.layoutPath);
            await Deno.writeTextFile(join(linked.layoutPath, "keep.txt"), "keep\n");
          },
        },
      }), PartialWriteError);
    assertEquals(partial.surviving.length, 1);
    assert(partial.surviving[0].endsWith("layout.json"));
    assertEquals(await Deno.readTextFile(configPath), external);
    assertEquals(await leftovers(dir), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migrate_refuses_output_that_does_not_compile", async () => {
  await withV1Project(async (paths) => {
    const catalog = JSON.parse(await Deno.readTextFile(paths.catalog)) as Record<string, unknown>;
    catalog.ignore = [{ glob: "**/vendor/**", reason: "" }];
    await Deno.writeTextFile(paths.catalog, JSON.stringify(catalog, null, 2));
    const result = await runMigrateCli(paths.dir, MIGRATE_ARGS);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "does not compile");
    assertStringIncludes(result.stderr, "paths.ignore.0.reason");
    assertEquals(await exists(paths.config), false);
    assertEquals(await exists(paths.layout), false);
    const leftovers: string[] = [];
    for await (const entry of Deno.readDir(paths.dir)) {
      if (entry.name.includes(".unslop")) leftovers.push(entry.name);
    }
    assertEquals(leftovers, []);
  });
});

Deno.test("migrate_of_a_valid_catalog_is_unchanged", async () => {
  await withV1Project(async (paths) => {
    const result = await runMigrateCli(paths.dir, MIGRATE_ARGS);
    assertEquals(result.code, 0, result.stderr);
    assert(await exists(paths.config));
    assert(await exists(paths.layout));
    const validated = await runMigrateCli(paths.dir, ["config", "validate"]);
    assertEquals(validated.code, 0, validated.stderr);
  });
});
