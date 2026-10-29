/**
 * @module HealthGraphTest
 * @path tests/health_graph_test.ts
 * @description Unit values for the maintainability index, the graph projections and the raw export population.
 * @architectural-layer Test
 * @related-files [src/report/graph.ts, src/report/exports.ts, src/report/maintainability.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  buildHealthGraph,
  deadRatioOf,
  exportPopulationOf,
  maintainabilityBandOf,
  maintainabilityIndexOf,
  parseHealthFile,
  valueExportSitesOf,
} from "../src/report/mod.ts";
import type { IParsedHealthFile } from "../src/report/parse.ts";

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
  const snapshot = await snapshotOf({
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
  });
  const exportFile = snapshot.get("src/exports.ts");
  assert(exportFile !== undefined);
  const sites = valueExportSitesOf(exportFile);
  assertEquals(sites.map((site) => site.name).sort(), ["dead", "default", "suppressed", "thing"]);
  const population = exportPopulationOf(snapshot);
  assertEquals(population.total, 6);
  assertEquals(population.unused, 2);
  assertEquals(population.byPath.get("src/exports.ts")?.unused, 1);
  assertEquals(population.byPath.get("src/types_only.ts")?.total ?? 0, 0);
  assertEquals(deadRatioOf(0, 0), 0);
  assertEquals(deadRatioOf(6, 2), 1 / 3);
});
