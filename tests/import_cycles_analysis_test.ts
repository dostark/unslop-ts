/**
 * @module ImportCyclesAnalysisTest
 * @path tests/import_cycles_analysis_test.ts
 * @description Values of the full cycle analysis: SCC members, kind classification, dynamic edges and the
 *   unresolved reference list the gate reads.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/import_cycles.ts, src/report/graph.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { buildHealthGraph, parseHealthFile } from "../src/report/mod.ts";
import type { IParsedHealthFile } from "../src/report/parse.ts";
import { analyzeCycles, type ICycleEdge, type ICycleGraphInfo } from "../src/rules/whole_tree/import_cycles.ts";

const EMPTY_GRAPH: ICycleGraphInfo = {
  complete: true,
  code_files: 10,
  unresolved: 0,
  unresolved_refs: [],
  parse_errors: [],
  parse_error_count: 0,
  nonliteral_dynamic: 0,
};

/** The default analysis options. */
const OPTIONS = { minFiles: 2, includeSelf: false, includeTypeOnly: true };

/** Builds a cycle edge. */
function edge(from: string, to: string, kind: "runtime" | "type" = "runtime", form?: ICycleEdge["form"]): ICycleEdge {
  return form === undefined ? { from, to, kind } : { from, to, kind, form };
}

Deno.test("cycle-members: a three-file loop reports every file and every internal edge", () => {
  const edges = [edge("src/a.ts", "src/b.ts"), edge("src/b.ts", "src/c.ts"), edge("src/c.ts", "src/a.ts")];
  const analysis = analyzeCycles(edges, EMPTY_GRAPH, OPTIONS);
  assertEquals(analysis.cycles.length, 1);
  assertEquals(analysis.cycles[0].files, ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assertEquals(analysis.cycles[0].edge_count, 3);
  assertEquals(analysis.totals.files, 3);
  assertEquals(analysis.totals.edges, 3);
  assertEquals(analysis.totals.largest_files, 3);
});

Deno.test("cycle-classify: runtime, type-only and mixed projections carry their own kind", () => {
  const edges = [
    edge("src/r1.ts", "src/r2.ts"),
    edge("src/r2.ts", "src/r1.ts"),
    edge("src/t1.ts", "src/t2.ts", "type"),
    edge("src/t2.ts", "src/t1.ts", "type"),
    edge("src/m1.ts", "src/m2.ts", "runtime"),
    edge("src/m2.ts", "src/m1.ts", "type"),
  ];
  const analysis = analyzeCycles(edges, EMPTY_GRAPH, OPTIONS);
  const kindOf = (file: string) => analysis.cycles.find((cycle) => cycle.files.includes(file))?.kind;
  assertEquals(kindOf("src/r1.ts"), "runtime");
  assertEquals(kindOf("src/t1.ts"), "type-only");
  assertEquals(kindOf("src/m1.ts"), "mixed");
  assertEquals(analysis.totals.runtime_sccs, 1);
  assertEquals(analysis.totals.type_only_sccs, 1);
  assertEquals(analysis.totals.mixed_sccs, 1);
  assertEquals(analysis.totals.files, 2);
});

Deno.test("cycle-empty: a DAG and an empty graph report no cycle", () => {
  assertEquals(analyzeCycles([], EMPTY_GRAPH, OPTIONS).cycles.length, 0);
  assertEquals(analyzeCycles([edge("src/a.ts", "src/b.ts")], EMPTY_GRAPH, OPTIONS).cycles.length, 0);
});

Deno.test("cycle-dynamic: a literal dynamic import forms a cycle and the graph state passes through", () => {
  const edges = [edge("src/a.ts", "src/b.ts", "runtime", "dynamic"), edge("src/b.ts", "src/a.ts")];
  const analysis = analyzeCycles(edges, EMPTY_GRAPH, OPTIONS);
  assertEquals(analysis.cycles.length, 1);
  assertEquals(analysis.cycles[0].edges.some((ref) => ref.form === "dynamic"), true);
  const incomplete = analyzeCycles(edges, { ...EMPTY_GRAPH, complete: false, unresolved: 1 }, OPTIONS);
  assertEquals(incomplete.graph.complete, false);
});

Deno.test("cycle-unresolved-list: the graph names an unresolvable relative import", async () => {
  const dir = await Deno.makeTempDir({ prefix: "unslop_cycles_" });
  try {
    await Deno.mkdir(join(dir, "src"));
    await Deno.writeTextFile(
      join(dir, "src", "a.ts"),
      'import { gone } from "./missing.ts";\nexport const a = gone;\n',
    );
    const parsed = new Map<string, IParsedHealthFile>([
      ["src/a.ts", await parseHealthFile(join(dir, "src", "a.ts"), "src/a.ts")],
    ]);
    const graph = buildHealthGraph(parsed);
    assertEquals(graph.limitations.unresolved, 1);
    assertEquals(graph.limitations.unresolved_refs, [{ from: "src/a.ts", specifier: "./missing.ts" }]);
    assertEquals(graph.complete, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cycle-path: the canonical path is the shortest cycle and tie-breaks lexicographically", () => {
  const edges = [
    edge("src/a.ts", "src/b.ts"),
    edge("src/b.ts", "src/c.ts"),
    edge("src/c.ts", "src/a.ts"),
    edge("src/a.ts", "src/d.ts"),
    edge("src/d.ts", "src/e.ts"),
    edge("src/e.ts", "src/a.ts"),
  ];
  const analysis = analyzeCycles(edges, EMPTY_GRAPH, OPTIONS);
  assertEquals(analysis.cycles[0].path, ["src/a.ts", "src/b.ts", "src/c.ts", "src/a.ts"]);
  assertEquals(analysis.cycles[0].path_truncated, false);
});

Deno.test("cycle-id: the id ignores edge order and member order", () => {
  const forward = [edge("src/a.ts", "src/b.ts"), edge("src/b.ts", "src/a.ts")];
  const backward = [edge("src/b.ts", "src/a.ts"), edge("src/a.ts", "src/b.ts")];
  const first = analyzeCycles(forward, EMPTY_GRAPH, OPTIONS).cycles[0].id;
  const second = analyzeCycles(backward, EMPTY_GRAPH, OPTIONS).cycles[0].id;
  assertEquals(first, second);
  assertEquals(/^cyc-[0-9a-f]{16}$/.test(first), true);
  const other = analyzeCycles([edge("src/a.ts", "src/c.ts"), edge("src/c.ts", "src/a.ts")], EMPTY_GRAPH, OPTIONS);
  assertEquals(other.cycles[0].id === first, false);
});

Deno.test("cycle-self: a self-import is excluded by default and reported with includeSelf", () => {
  const edges = [edge("src/self.ts", "src/self.ts")];
  assertEquals(analyzeCycles(edges, EMPTY_GRAPH, OPTIONS).cycles.length, 0);
  const withSelf = analyzeCycles(edges, EMPTY_GRAPH, { ...OPTIONS, includeSelf: true });
  assertEquals(withSelf.cycles.length, 1);
  assertEquals(withSelf.cycles[0].files, ["src/self.ts"]);
  assertEquals(withSelf.cycles[0].kind, "runtime");
  assertEquals(withSelf.cycles[0].edges, [
    { from: "src/self.ts", to: "src/self.ts", kind: "runtime", form: "import" },
  ]);
  assertEquals(withSelf.cycles[0].edge_count, 1);
});

Deno.test("cycle-truncated: a long cycle keeps every member and truncates only the path", () => {
  const files = Array.from({ length: 70 }, (_, index) => `src/f${String(index).padStart(2, "0")}.ts`);
  const edges = files.map((file, index) => edge(file, files[(index + 1) % files.length]));
  const analysis = analyzeCycles(edges, EMPTY_GRAPH, OPTIONS);
  assertEquals(analysis.cycles[0].files.length, 70);
  assertEquals(analysis.cycles[0].path.length, 64);
  assertEquals(analysis.cycles[0].path_truncated, true);
});
