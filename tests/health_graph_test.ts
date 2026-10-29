/**
 * @module HealthGraphTest
 * @path tests/health_graph_test.ts
 * @description Unit values for the maintainability index, the graph projections and the raw export population.
 * @architectural-layer Test
 * @related-files [src/report/graph.ts, src/report/exports.ts, src/report/maintainability.ts, src/rules/whole_tree/import_cycles.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  buildHealthGraph,
  deadRatioOf,
  exportPopulationOf,
  maintainabilityBandOf,
  maintainabilityIndexOf,
  moduleGraphOf,
  parseHealthFile,
  valueExportSitesOf,
} from "../src/report/mod.ts";
import type { IParsedHealthFile } from "../src/report/parse.ts";
import { readImportAliases } from "../src/report/aliases.ts";
import { couplingSignalOf, runtimeCyclesOf } from "../src/rules/whole_tree/import_cycles.ts";

/** Writes the files to a temp dir and parses the snapshot the way the CLI does. */
async function snapshotOf(files: Readonly<Record<string, string>>): Promise<Map<string, IParsedHealthFile>> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_graph_" });
  try {
    for (const [path, source] of Object.entries(files)) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), source);
    }
    const snapshot = new Map<string, IParsedHealthFile>();
    for (const path of Object.keys(files).sort((left, right) => left.localeCompare(right))) {
      snapshot.set(path, await parseHealthFile(join(dir, path), path));
    }
    return snapshot;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const GRAPH_FILES: Readonly<Record<string, string>> = {
  "src/side.ts": "export const side = 1;\n",
  "src/types.ts": "export type Shape = { a: number };\n",
  "src/b.ts": "export const value = 1;\n",
  "src/a.ts": 'import "./side.ts";\nimport type { Shape } from "./types.ts";\nexport { value } from "./b.ts";\n' +
    "export const local = 1;\n",
  "src/c.ts": 'import { value } from "./b.ts";\nexport const used = value;\n',
  "src/d.ts": 'import type { Shape } from "./types.ts";\nexport const shape: Shape = { a: 1 };\n',
  "src/e.ts": 'const loaded = await import("./b.ts");\nexport const done = loaded;\n',
  "src/self.ts": 'import { helper } from "./self.ts";\nexport const helper = 1;\n',
  "src/alias.ts": 'import { value } from "@/b.ts";\nexport const aliased = value;\n',
};

Deno.test("health-maintainability-index: known density, dead ratio and fan-out yield the exact clamped index", () => {
  assertEquals(maintainabilityIndexOf({ fileLines: 50, cyclomatic: 25, deadExportRatio: 0, fanOut: 0 }), 85);
  assertEquals(maintainabilityIndexOf({ fileLines: 25, cyclomatic: 25, deadExportRatio: 1, fanOut: 0 }), 65);
  assertEquals(maintainabilityIndexOf({ fileLines: 10, cyclomatic: 10, deadExportRatio: 0, fanOut: 0 }), 94);
  assertEquals(maintainabilityIndexOf({ fileLines: 200, cyclomatic: 1000, deadExportRatio: 1, fanOut: 10 }), 0);
  assertEquals(maintainabilityBandOf(70), "good");
  assertEquals(maintainabilityBandOf(69.9), "moderate");
  assertEquals(maintainabilityBandOf(40), "moderate");
  assertEquals(maintainabilityBandOf(39.9), "poor");
});

Deno.test("health-graph-projections: side-effect, type, barrel, dynamic and alias edges give exact fan counts", async () => {
  const snapshot = await snapshotOf(GRAPH_FILES);
  const graph = buildHealthGraph(snapshot, { "@/": "./src/" });
  assertEquals(graph.edges.length, 7);
  assertEquals(graph.edges.filter((edge) => edge.kind === "runtime").length, 5);
  assertEquals(graph.edges.filter((edge) => edge.kind === "type").length, 2);
  assertEquals(graph.fanIn.get("src/b.ts"), 4);
  assertEquals(graph.fanIn.get("src/types.ts"), 2);
  assertEquals(graph.fanIn.get("src/side.ts"), 1);
  assertEquals(graph.fanOut.get("src/a.ts"), 3);
  assertEquals(graph.fanOut.get("src/self.ts") ?? 0, 0);
  assertEquals(graph.complete, true);
  const forms = graph.edges.filter((edge) => edge.from === "src/a.ts").map((edge) => edge.form).sort();
  assertEquals(forms, ["import", "re-export", "side-effect"]);
});

Deno.test("health-graph-projections: unresolved, external and nonliteral specifiers are attributed", async () => {
  const snapshot = await snapshotOf({
    "src/ext.ts": 'import "npm:left-pad";\nimport { x } from "./missing.ts";\n' +
      'const name = "./b.ts";\nexport const loaded = await import(name);\n',
  });
  const graph = buildHealthGraph(snapshot);
  assertEquals(graph.edges, []);
  assertEquals(graph.limitations.external, 1);
  assertEquals(graph.limitations.unresolved, 1);
  assertEquals(graph.limitations.nonliteral_dynamic, 1);
  assertEquals(graph.complete, false);
});

Deno.test("health-export-population: suppressed sites stay, type exports leave, and zero exports give zero", async () => {
  await withAliasProject({
    "src/exports.ts": "// unslop-ignore-next-line unused-export\n" +
      "export const suppressed = 1;\n" +
      "export const dead = 2;\n" +
      "export type Alias = string;\n" +
      "export interface Shape { a: number }\n" +
      "export default 3;\n" +
      'export { thing } from "./other.ts";\n',
    "src/other.ts": "export const thing = 1;\n",
    "src/uses.ts": 'import { suppressed } from "./exports.ts";\nexport const used = suppressed;\n',
    "src/types_only.ts": "export type Only = string;\nexport interface Other { a: number }\n",
  }, async (root, snapshot) => {
    const exportFile = snapshot.get("src/exports.ts");
    assert(exportFile !== undefined);
    const sites = valueExportSitesOf(exportFile);
    assertEquals(sites.map((site) => site.name).sort(), ["dead", "default", "suppressed", "thing"]);
    const population = exportPopulationOf(
      snapshot,
      await moduleGraphOf(snapshot, { rootPath: root, publicEntries: [] }),
    );
    assertEquals(population.total, 6);
    assertEquals(population.unused, 5);
    assertEquals(population.byPath.get("src/exports.ts")?.unused, 3);
    assertEquals(population.byPath.get("src/types_only.ts")?.total ?? 0, 0);
  });
  assertEquals(deadRatioOf(0, 0), 0);
  assertEquals(deadRatioOf(6, 2), 1 / 3);
});

Deno.test("health-export-binding-identity: unrelated local names and local-only references cannot make an export live", async () => {
  await withAliasProject({
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": "export function f(): number {\n  const x = 2;\n  return x;\n}\n",
    "src/c.ts": "export const z = 1;\nexport const w = z;\n",
  }, async (root, snapshot) => {
    const population = exportPopulationOf(
      snapshot,
      await moduleGraphOf(snapshot, { rootPath: root, publicEntries: [] }),
    );
    assertEquals(population.total, 4);
    assertEquals(population.unused, 4);
    assertEquals(population.byPath.get("src/a.ts")?.unused, 1);
  });
});

Deno.test("health-export-resolved-population: default, star, alias, suppressed and public sites have exact values", async () => {
  const files: Readonly<Record<string, string>> = {
    "src/lib.ts": "export const live = 1;\nexport const dead = 2;\n// unslop-ignore-next-line unused-export\n" +
      "export const suppressed = 3;\nconst inner = 4;\nexport { inner as renamed };\nexport default 5;\n",
    "src/barrel.ts": 'export * from "./star_target.ts";\nexport { live as again } from "./lib.ts";\n',
    "src/star_target.ts": "export const starred = 1;\n",
    "src/lonely.ts": 'export * from "./star_target.ts";\n',
    "src/dflt.ts": "export default 9;\n",
    "src/user.ts": 'import dflt, { live, renamed } from "./lib.ts";\nexport const out = [dflt, live, renamed];\n',
    "src/user2.ts": 'import { starred } from "./barrel.ts";\nexport const out2 = starred;\n',
    "src/public.ts": "export const api = 1;\n",
  };
  await withAliasProject(files, async (root, snapshot) => {
    const graph = await moduleGraphOf(snapshot, { rootPath: root, publicEntries: ["src/public.ts"] });
    const population = exportPopulationOf(snapshot, graph);
    assertEquals(population.total, 13);
    assertEquals(population.unused, 7);
    const unusedByPath = Object.fromEntries([...population.byPath].map(([path, entry]) => [path, entry.unused]));
    assertEquals(unusedByPath, {
      "src/barrel.ts": 1,
      "src/dflt.ts": 1,
      "src/lib.ts": 2,
      "src/lonely.ts": 1,
      "src/public.ts": 0,
      "src/star_target.ts": 0,
      "src/user.ts": 1,
      "src/user2.ts": 1,
    });
    const unconfigured = exportPopulationOf(
      snapshot,
      await moduleGraphOf(snapshot, { rootPath: root, publicEntries: [] }),
    );
    assertEquals(unconfigured.byPath.get("src/public.ts")?.unused, 1);
  });
});

Deno.test("import-cycles: a three-file loop is one SCC and disconnected cycles count separately", () => {
  const loop = runtimeCyclesOf([
    { from: "a.ts", to: "b.ts", kind: "runtime" },
    { from: "b.ts", to: "c.ts", kind: "runtime" },
    { from: "c.ts", to: "a.ts", kind: "runtime" },
  ]);
  assertEquals(loop, { sccs: 1, files: 3 });
  const several = runtimeCyclesOf([
    { from: "a.ts", to: "b.ts", kind: "runtime" },
    { from: "b.ts", to: "a.ts", kind: "runtime" },
    { from: "d.ts", to: "e.ts", kind: "runtime" },
    { from: "e.ts", to: "d.ts", kind: "runtime" },
    { from: "f.ts", to: "f.ts", kind: "runtime" },
  ]);
  assertEquals(several, { sccs: 2, files: 4 });
  const dag = runtimeCyclesOf([
    { from: "a.ts", to: "b.ts", kind: "runtime" },
    { from: "a.ts", to: "c.ts", kind: "runtime" },
  ]);
  assertEquals(dag, { sccs: 0, files: 0 });
  assertEquals(runtimeCyclesOf([]), { sccs: 0, files: 0 });
});

Deno.test("health-coupling: duplicate edges, type-only coupling and the limits count once per file", () => {
  const edges = [
    { from: "a.ts", to: "b.ts", kind: "type" as const },
    { from: "a.ts", to: "b.ts", kind: "runtime" as const },
  ];
  const single = couplingSignalOf(edges, 2);
  assertEquals(single.high_files, 0);
  assertEquals(single.fan_in_limit, 20);
  assertEquals(single.fan_out_limit, 15);

  const fanOut = Array.from({ length: 16 }, (_, index) => ({
    from: "hub.ts",
    to: `leaf_${index}.ts`,
    kind: "runtime" as const,
  }));
  const hub = couplingSignalOf(fanOut, 17);
  assertEquals(hub.high_files, 1);
  assertEquals(hub.percent, (1 / 17) * 100);

  const fanIn = Array.from({ length: 21 }, (_, index) => ({
    from: `source_${index}.ts`,
    to: "sink.ts",
    kind: "runtime" as const,
  }));
  const sink = couplingSignalOf(fanIn, 22);
  assertEquals(sink.high_files, 1);

  const atLimit = Array.from({ length: 15 }, (_, index) => ({
    from: "edge.ts",
    to: `leaf_${index}.ts`,
    kind: "runtime" as const,
  }));
  assertEquals(couplingSignalOf(atLimit, 16).high_files, 0);
  assertEquals(couplingSignalOf([], 0).percent, 0);
});

/** Writes a project, parses its source snapshot and runs `body` with the root, the snapshot and the real aliases. */
async function withAliasProject<T>(
  files: Readonly<Record<string, string>>,
  body: (root: string, snapshot: Map<string, IParsedHealthFile>) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_alias_" });
  try {
    for (const [path, source] of Object.entries(files)) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), source);
    }
    const snapshot = new Map<string, IParsedHealthFile>();
    for (const path of Object.keys(files).filter((name) => name.endsWith(".ts")).sort()) {
      snapshot.set(path, await parseHealthFile(join(dir, path), path));
    }
    return await body(dir, snapshot);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const ALIAS_IMPORTS = [
  'import "@local";',
  'import "@lib/x.ts";',
  'import "@lib/deep/y.ts";',
  'import "@scope/m";',
  'import "@scope/m/sub";',
  'import "@local/more";',
].join("\n");

const ALIAS_FILES: Readonly<Record<string, string>> = {
  "deno.json": JSON.stringify({
    workspace: ["./packages/m"],
    imports: { "@local": "./src/dep.ts", "@lib/": "./lib/", "@lib/deep/": "./other/deep/" },
  }),
  "packages/m/deno.jsonc": '{\n  // the workspace package\n  "name": "@scope/m",\n' +
    '  "exports": { ".": "./mod.ts", "./sub": "./src/sub.ts", },\n}\n',
  "src/a.ts": `${ALIAS_IMPORTS}\nexport const a = 1;\n`,
  "src/dep.ts": "export const dep = 1;\n",
  "lib/x.ts": "export const x = 1;\n",
  "other/deep/y.ts": "export const y = 1;\n",
  "packages/m/mod.ts": "export const m = 1;\n",
  "packages/m/src/sub.ts": "export const sub = 1;\n",
};

Deno.test("health-real-config-aliases: exact, longest-prefix, JSONC and workspace aliases give the correct edges", async () => {
  await withAliasProject(ALIAS_FILES, async (root, snapshot) => {
    const graph = buildHealthGraph(snapshot, await readImportAliases(root));
    assertEquals(
      graph.edges.map((edge) => edge.to).sort(),
      ["lib/x.ts", "other/deep/y.ts", "packages/m/mod.ts", "packages/m/src/sub.ts", "src/dep.ts"],
    );
    assertEquals(graph.limitations.external, 1);
    assertEquals(graph.limitations.unresolved, 0);
    assertEquals(graph.complete, true);
  });
  await withAliasProject({
    "deno.json": JSON.stringify({ imports: { "@gone": "./src/missing.ts" } }),
    "src/a.ts": 'import "@gone";\nexport const a = 1;\n',
  }, async (root, snapshot) => {
    const graph = buildHealthGraph(snapshot, await readImportAliases(root));
    assertEquals(graph.edges, []);
    assertEquals(graph.limitations.unresolved, 1);
    assertEquals(graph.limitations.external, 0);
    assertEquals(graph.complete, false);
  });
  await withAliasProject({
    "deno.json": JSON.stringify({ workspace: ["./one", "./two"] }),
    "one/deno.json": JSON.stringify({ imports: { "@shared": "./a.ts" } }),
    "two/deno.json": JSON.stringify({ imports: { "@shared": "./b.ts" } }),
    "one/a.ts": "export const a = 1;\n",
    "two/b.ts": 'import "@shared";\nexport const b = 1;\n',
  }, async (root, snapshot) => {
    const graph = buildHealthGraph(snapshot, await readImportAliases(root));
    assertEquals(graph.edges, []);
    assertEquals(graph.limitations.unresolved, 1);
    assertEquals(graph.complete, false);
  });
});
