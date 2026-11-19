/**
 * @module CycleBaselineTest
 * @path tests/cycle_baseline_test.ts
 * @description The import-cycle baseline rejects a malformed or escaping file, writes deterministically, and needs write access.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/rules/whole_tree/cycle_baseline.ts, src/cli/whole_tree.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { JsonValue } from "../mod.ts";
import type { ICycleAnalysis, ICycleFinding } from "../src/rules/whole_tree/import_cycles.ts";
import {
  buildCycleBaseline,
  compareToBaseline,
  CYCLE_BASELINE_VERSION,
  CycleBaselineError,
  type ICycleBaseline,
  loadCycleBaseline,
  MAX_CYCLE_BASELINE_BYTES,
  MAX_CYCLE_BASELINE_CYCLES,
  parseCycleBaseline,
  resolveInsideRoot,
  saveCycleBaseline,
  serializeCycleBaseline,
} from "../src/rules/whole_tree/cycle_baseline.ts";

const CLI = new URL("../src/cli/whole_tree.ts", import.meta.url).href;
const CYCLE_ID = "cyc-0123456789abcdef";
const USAGE_EXIT = 2;
const FAILURE_EXIT = 1;
const RUNTIME_A = 'import { b } from "./b.ts";\nexport const a = b;\n';
const RUNTIME_B = 'import { a } from "./a.ts";\nexport const b = 1;\n';

function baselineOf(extra: Partial<ICycleBaseline> = {}): ICycleBaseline {
  return {
    version: CYCLE_BASELINE_VERSION,
    allowed_unresolved: [],
    cycles: [{ id: CYCLE_ID, kind: "runtime", files: ["src/a.ts", "src/b.ts"] }],
    ...extra,
  };
}

/** A baseline as a caller may write it, including shapes the schema rejects. */
function rawOf(extra: Record<string, JsonValue>): object {
  return {
    version: CYCLE_BASELINE_VERSION,
    allowed_unresolved: [],
    cycles: [{ id: CYCLE_ID, kind: "runtime", files: ["src/a.ts", "src/b.ts"] }],
    ...extra,
  };
}

function oneCycleAnalysis(): ICycleAnalysis {
  const finding: ICycleFinding = {
    id: CYCLE_ID,
    kind: "runtime",
    files: ["src/a.ts", "src/b.ts"],
    edges: [],
    path: ["src/a.ts", "src/b.ts", "src/a.ts"],
    path_truncated: false,
    size: 2,
    edge_count: 2,
  };
  return {
    cycles: [finding],
    totals: {
      runtime_sccs: 1,
      type_only_sccs: 0,
      mixed_sccs: 0,
      files: 2,
      edges: 2,
      largest_files: 2,
    },
    graph: {
      complete: true,
      code_files: 2,
      runtime_edges: 2,
      type_edges: 0,
      unresolved: 0,
      unresolved_refs: [],
      parse_errors: [],
      parse_error_count: 0,
      nonliteral_dynamic: 0,
    },
  };
}

async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "cycle_baseline_" });
  try {
    return await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("cycle-baseline-shape: the schema rejects a wrong version, a non-runtime cycle and a missing reason", () => {
  assertThrows(() => parseCycleBaseline(JSON.stringify(rawOf({ version: 2 }))), "version");
  assertThrows(
    () =>
      parseCycleBaseline(JSON.stringify(rawOf({
        cycles: [{ id: CYCLE_ID, kind: "type-only", files: ["src/a.ts", "src/b.ts"] }],
      }))),
    "kind",
  );
  assertThrows(
    () =>
      parseCycleBaseline(JSON.stringify(rawOf({
        allowed_unresolved: [{ specifier: "./missing.ts", from: "src/a.ts", reason: "" }],
      }))),
    "reason",
  );
  const duplicate = rawOf({
    cycles: [
      { id: CYCLE_ID, kind: "runtime", files: ["src/a.ts", "src/b.ts"] },
      { id: CYCLE_ID, kind: "runtime", files: ["src/c.ts", "src/d.ts"] },
    ],
  });
  assertThrows(() => parseCycleBaseline(JSON.stringify(duplicate)), "duplicate");
  const unsorted = rawOf({ cycles: [{ id: CYCLE_ID, kind: "runtime", files: ["src/b.ts", "src/a.ts"] }] });
  assertThrows(() => parseCycleBaseline(JSON.stringify(unsorted)), "sorted");
  const outside = rawOf({ cycles: [{ id: CYCLE_ID, kind: "runtime", files: ["../a.ts", "src/b.ts"] }] });
  assertThrows(() => parseCycleBaseline(JSON.stringify(outside)), "inside");
  assertThrows(() => parseCycleBaseline("{"), "JSON");
});

Deno.test("cycle-baseline-shape: the cycle count and the byte size are bounded", () => {
  const cycles = Array.from({ length: MAX_CYCLE_BASELINE_CYCLES + 1 }, (_, index) => ({
    id: `cyc-${String(index).padStart(16, "0")}`,
    kind: "runtime" as const,
    files: ["src/a.ts", "src/b.ts"],
  }));
  assertThrows(() => parseCycleBaseline(JSON.stringify(rawOf({ cycles }))), "cycles");
  const oversized = " ".repeat(MAX_CYCLE_BASELINE_BYTES + 1);
  assertThrows(() => parseCycleBaseline(oversized), "bytes");
});

Deno.test("cycle-baseline-security: a path that leaves the root, a symlink and a malformed read are rejected", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "config"));
    await assertRejects(() => resolveInsideRoot(root, "/etc/cycles.json"), "inside the project root");
    await assertRejects(() => resolveInsideRoot(root, "../cycles.json"), "inside the project root");
    await assertRejects(() => resolveInsideRoot(root, "config/../../cycles.json"), "inside the project root");
    assertEquals(
      await resolveInsideRoot(root, "config/cycles.json"),
      join(await Deno.realPath(root), "config/cycles.json"),
    );

    const outside = await Deno.makeTempDir({ prefix: "cycle_outside_" });
    try {
      await Deno.writeTextFile(join(outside, "cycles.json"), JSON.stringify(baselineOf()));
      // The compatibility harness grants scoped permissions, and a symlink needs unscoped read and write.
      let linked = false;
      try {
        await Deno.symlink(join(outside, "cycles.json"), join(root, "escape.json"));
        linked = true;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotCapable)) throw error;
      }
      if (linked) {
        await assertRejects(() => loadCycleBaseline(root, "escape.json"), "inside the project root");
      }
    } finally {
      await Deno.remove(outside, { recursive: true });
    }

    await Deno.writeTextFile(join(root, "broken.json"), "{");
    await assertRejects(() => loadCycleBaseline(root, "broken.json"), "JSON");
    await Deno.writeTextFile(join(root, "big.json"), " ".repeat(MAX_CYCLE_BASELINE_BYTES + 1));
    await assertRejects(() => loadCycleBaseline(root, "big.json"), "bytes");
  });
});

Deno.test("cycle-baseline-temp-symlink: a temporary symlink cannot redirect the write", async () => {
  await withTempDir(async (root) => {
    const outside = await Deno.makeTempDir({ prefix: "cycle_outside_tmp_" });
    try {
      const victim = join(outside, "victim.txt");
      await Deno.writeTextFile(victim, "original\n");
      // The compatibility harness grants scoped permissions, and a symlink needs unscoped read and write.
      let linked = false;
      try {
        await Deno.symlink(victim, join(root, "cycle_baseline.json.tmp"));
        linked = true;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotCapable)) throw error;
      }
      if (!linked) return;
      await assertRejects(
        () => saveCycleBaseline(root, "cycle_baseline.json", baselineOf()),
        CycleBaselineError,
        "temporary",
      );
      assertEquals(await Deno.readTextFile(victim), "original\n");
      assertEquals(await Deno.lstat(join(root, "cycle_baseline.json")).catch(() => null), null);
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("cycle-baseline-temp-cleanup: a failed rename leaves no temporary file", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "cycle_baseline.json"));
    await assertRejects(() => saveCycleBaseline(root, "cycle_baseline.json", baselineOf()));
    assertEquals(await Deno.lstat(join(root, "cycle_baseline.json.tmp")).catch(() => null), null);
  });
});

Deno.test("cycle-baseline-update: the serialized baseline is sorted, timestamp-free and stable", async () => {
  await withTempDir(async (root) => {
    const analysis = oneCycleAnalysis();
    const baseline = buildCycleBaseline(analysis, [
      { specifier: "./z.ts", from: "src/b.ts", reason: "Third-party fixture." },
      { specifier: "./a.ts", from: "src/a.ts", reason: "Generated file." },
    ]);
    assertEquals(baseline.cycles.map((cycle) => cycle.id), [CYCLE_ID]);
    assertEquals(baseline.allowed_unresolved.map((entry) => entry.from), ["src/a.ts", "src/b.ts"]);
    const text = serializeCycleBaseline(baseline);
    assert(!text.includes("generated_at"));
    assert(!text.includes("tool"));
    assertEquals(parseCycleBaseline(text), baseline);
    assertEquals(serializeCycleBaseline(parseCycleBaseline(text)), text);

    const path = await saveCycleBaseline(root, "cycle_baseline.json", baseline);
    assertEquals(path, join(await Deno.realPath(root), "cycle_baseline.json"));
    const first = await Deno.readTextFile(join(root, "cycle_baseline.json"));
    await saveCycleBaseline(root, "cycle_baseline.json", baseline);
    assertEquals(await Deno.readTextFile(join(root, "cycle_baseline.json")), first);
    const siblings = [...Deno.readDirSync(root)].map((entry) => entry.name).sort();
    assertEquals(siblings, ["cycle_baseline.json"]);
  });
});

/** Writes a project with one runtime cycle and a catalog that names the baseline. */
async function writeCycleProject(dir: string, baseline: string | null = "cycle_baseline.json"): Promise<void> {
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "catalog.json"),
    JSON.stringify({
      version: "1",
      scopes: { test: ["**/tests/**"], fixture: [] },
      wholeTree: { importCycles: { baseline } },
    }),
  );
  await Deno.writeTextFile(join(dir, "src/a.ts"), RUNTIME_A);
  await Deno.writeTextFile(join(dir, "src/b.ts"), RUNTIME_B);
}

Deno.test("cycle-baseline-update: the CLI writes the baseline and refuses without --allow-write", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);

    const refused = await runCli(dir, ["--update-baseline"], ["run", "--allow-read", "--allow-env", CLI]);
    assertEquals(refused.code, FAILURE_EXIT);
    assertStringIncludes(refused.stderr, "allow-write");

    const written = await runCli(dir, ["--update-baseline"], ["run", "-A", CLI]);
    assertEquals(written.code, 0);
    const baseline = parseCycleBaseline(await Deno.readTextFile(join(dir, "cycle_baseline.json")));
    assertEquals(baseline.cycles.length, 1);
    assertEquals(baseline.cycles[0].files, ["src/a.ts", "src/b.ts"]);
    assertEquals(baseline.allowed_unresolved, []);

    const again = await runCli(dir, ["--update-baseline"], ["run", "-A", CLI]);
    assertEquals(again.code, 0);
    assertEquals(
      await Deno.readTextFile(join(dir, "cycle_baseline.json")),
      serializeCycleBaseline(baseline),
    );

    const withoutPath = await runCli(dir, ["--update-baseline"], ["run", "-A", CLI], { baseline: null });
    assertEquals(withoutPath.code, USAGE_EXIT);
    assertStringIncludes(withoutPath.stderr, "baseline");

    const escaping = await runCli(dir, ["--update-baseline"], ["run", "-A", CLI], { baseline: "../escape.json" });
    assertEquals(escaping.code, USAGE_EXIT);
    assertStringIncludes(escaping.stderr, "inside the project root");

    await Deno.writeTextFile(join(dir, "cycle_baseline.json"), "{");
    const malformed = await runCli(dir, ["--update-baseline"], ["run", "-A", CLI], { baseline: "cycle_baseline.json" });
    assertEquals(malformed.code, FAILURE_EXIT);
    assertStringIncludes(malformed.stderr, "JSON");
    assertEquals(await Deno.readTextFile(join(dir, "cycle_baseline.json")), "{");
  });
});

interface IRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the whole-tree CLI in `dir`; the command prefix defaults to the full-permission entry. */
async function runCli(
  dir: string,
  args: readonly string[],
  prefix: readonly string[],
  overrides: { readonly baseline?: string | null } = {},
): Promise<IRunResult> {
  if (overrides.baseline !== undefined) {
    const path = join(dir, "catalog.json");
    const catalog = JSON.parse(await Deno.readTextFile(path)) as {
      wholeTree: { importCycles: Record<string, string | null> };
    };
    catalog.wholeTree.importCycles.baseline = overrides.baseline;
    await Deno.writeTextFile(path, JSON.stringify(catalog));
  }
  const result = await new Deno.Command(Deno.execPath(), {
    args: [...prefix, "--rule=import-cycles", "--catalog=catalog.json", ...args],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
    env: { LD_LIBRARY_PATH: "" },
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

Deno.test("cycle-baseline-match: the committed baseline passes and --baseline wins over the setting", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir, null);
    const written = await runCli(dir, ["--update-baseline", "--baseline=alt_baseline.json"], ["run", "-A", CLI]);
    assertEquals(written.code, 0);
    const matched = await runCli(dir, ["--baseline=alt_baseline.json"], ["run", "-A", CLI]);
    assertEquals(matched.code, 0);
    assertStringIncludes(matched.stderr, "1 matched · 0 new · 0 changed · 0 stale");
    assertStringIncludes(matched.stderr, "import-cycle gate passed");

    const json = await runCli(dir, ["--baseline=alt_baseline.json", "--format=json"], ["run", "-A", CLI]);
    const report = JSON.parse(json.stdout) as {
      baseline: { matched: number; added: readonly object[]; passed: boolean };
    };
    assertEquals(report.baseline.matched, 1);
    assertEquals(report.baseline.added, []);
    assertEquals(report.baseline.passed, true);
  });
});

Deno.test("cycle-baseline-new: a new runtime cycle exits 1 and is named", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);
    assertEquals((await runCli(dir, ["--update-baseline"], ["run", "-A", CLI])).code, 0);
    await Deno.writeTextFile(join(dir, "src/c.ts"), 'import { d } from "./d.ts";\nexport const c = d;\n');
    await Deno.writeTextFile(join(dir, "src/d.ts"), 'import { c } from "./c.ts";\nexport const d = 1;\n');
    const result = await runCli(dir, [], ["run", "-A", CLI]);
    assertEquals(result.code, FAILURE_EXIT);
    assertStringIncludes(result.stderr, "1 new");
    assertStringIncludes(result.stderr, "NEW runtime");
    assertStringIncludes(result.stderr, "src/c.ts, src/d.ts");
    assertStringIncludes(result.stderr, "import-cycle gate failed");
  });
});

Deno.test("cycle-baseline-changed: a grown member set exits 1 with a changed-cycle message", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);
    assertEquals((await runCli(dir, ["--update-baseline"], ["run", "-A", CLI])).code, 0);
    await Deno.writeTextFile(
      join(dir, "src/a.ts"),
      'import { b } from "./b.ts";\nimport { c } from "./c.ts";\nexport const a = b + c;\n',
    );
    await Deno.writeTextFile(join(dir, "src/c.ts"), 'import { a } from "./a.ts";\nexport const c = 1;\n');
    const result = await runCli(dir, [], ["run", "-A", CLI]);
    assertEquals(result.code, FAILURE_EXIT);
    assertStringIncludes(result.stderr, "1 changed");
    assertStringIncludes(result.stderr, "CHANGED runtime");
    assertStringIncludes(result.stderr, "was src/a.ts, src/b.ts");
    assertStringIncludes(result.stderr, "now src/a.ts, src/b.ts, src/c.ts");
  });
});

Deno.test("cycle-baseline-stale: a removed cycle is advisory and fails with --fail-on-stale", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);
    assertEquals((await runCli(dir, ["--update-baseline"], ["run", "-A", CLI])).code, 0);
    await Deno.writeTextFile(join(dir, "src/b.ts"), "export const b = 1;\n");
    const advisory = await runCli(dir, [], ["run", "-A", CLI]);
    assertEquals(advisory.code, 0);
    assertStringIncludes(advisory.stderr, "1 stale");
    assertStringIncludes(advisory.stderr, "STALE");
    assertStringIncludes(advisory.stderr, "import-cycle gate passed");

    const strict = await runCli(dir, ["--fail-on-stale"], ["run", "-A", CLI]);
    assertEquals(strict.code, FAILURE_EXIT);
    assertStringIncludes(strict.stderr, "import-cycle gate failed");
  });
});

Deno.test("cycle-baseline-incomplete-graph: an unlisted specifier fails and an allowlisted one passes", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);
    assertEquals((await runCli(dir, ["--update-baseline"], ["run", "-A", CLI])).code, 0);
    await Deno.writeTextFile(
      join(dir, "src/a.ts"),
      'import { b } from "./b.ts";\nimport "./missing.ts";\nexport const a = b;\n',
    );
    const failed = await runCli(dir, [], ["run", "-A", CLI]);
    assertEquals(failed.code, FAILURE_EXIT);
    assertStringIncludes(failed.stderr, "UNRESOLVED src/a.ts imports './missing.ts'");

    const path = join(dir, "cycle_baseline.json");
    const baseline = JSON.parse(await Deno.readTextFile(path)) as {
      allowed_unresolved: { specifier: string; from: string; reason: string }[];
    };
    baseline.allowed_unresolved = [
      { specifier: "./missing.ts", from: "src/a.ts", reason: "Optional runtime module." },
    ];
    await Deno.writeTextFile(path, JSON.stringify(baseline));
    const allowed = await runCli(dir, [], ["run", "-A", CLI]);
    assertEquals(allowed.code, 0);
    assertStringIncludes(allowed.stderr, "import-cycle gate passed");
  });
});

Deno.test("cycle-baseline-gate-roots: a cycle that reaches production gates, a test-only cycle stays advisory", () => {
  const finding = (id: string, files: readonly string[]): ICycleFinding => ({
    id,
    kind: "runtime",
    files: [...files],
    edges: [],
    path: [...files, files[0]],
    path_truncated: false,
    size: files.length,
    edge_count: files.length,
  });
  const production = finding("cyc-1023456789abcdef", ["packages/a/src/a.ts", "tests/helpers/b.ts"]);
  const testOnly = finding("cyc-2023456789abcdef", ["tests/helpers/c.ts", "tests/helpers/d.ts"]);
  const analysis: ICycleAnalysis = {
    cycles: [production, testOnly],
    totals: { runtime_sccs: 2, type_only_sccs: 0, mixed_sccs: 0, files: 4, edges: 4, largest_files: 2 },
    graph: {
      complete: true,
      code_files: 4,
      runtime_edges: 4,
      type_edges: 0,
      unresolved: 0,
      unresolved_refs: [],
      parse_errors: [],
      parse_error_count: 0,
      nonliteral_dynamic: 0,
    },
  };
  const baseline: ICycleBaseline = {
    version: CYCLE_BASELINE_VERSION,
    allowed_unresolved: [],
    cycles: [{ id: production.id, kind: "runtime", files: production.files }],
  };
  const options = { gateRoots: ["packages/", "apps/"], failOnNew: true, failOnStale: true };
  const gate = compareToBaseline(analysis, baseline, options);
  assertEquals(gate.added, []);
  assertEquals(gate.matched, 1);
  assertEquals(gate.passed, true);

  const withoutBaselineEntry = compareToBaseline(analysis, { ...baseline, cycles: [] }, options);
  assertEquals(withoutBaselineEntry.added.map((cycle) => cycle.id), [production.id]);
  assertEquals(withoutBaselineEntry.passed, false);
});

Deno.test("cycle-gate-parse-error: an unparsable source file fails the gate and is named", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);
    await Deno.writeTextFile(join(dir, "src/broken.ts"), "export function broken( {\n");
    assertEquals((await runCli(dir, ["--update-baseline"], ["run", "-A", CLI])).code, 0);
    const report = JSON.parse((await runCli(dir, ["--format=json"], ["run", "-A", CLI])).stdout) as {
      graph: { complete: boolean; parse_error_count: number; nonliteral_dynamic: number };
    };
    assertEquals(report.graph.parse_error_count, 1);
    assertEquals(report.graph.complete, false);
    const gated = await runCli(dir, ["--fail-on-new", "--fail-on-stale"], ["run", "-A", CLI]);
    assertEquals(gated.code, FAILURE_EXIT);
    assertStringIncludes(gated.stderr, "parse error");
    assertStringIncludes(gated.stderr, "src/broken.ts");
  });
});

Deno.test("cycle-gate-nonliteral: a computed dynamic import fails the gate and is named", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);
    await Deno.writeTextFile(
      join(dir, "src/dyn.ts"),
      'const name = "./b.ts";\nexport const loaded = await import(name);\n',
    );
    assertEquals((await runCli(dir, ["--update-baseline"], ["run", "-A", CLI])).code, 0);
    const report = JSON.parse((await runCli(dir, ["--format=json"], ["run", "-A", CLI])).stdout) as {
      graph: { parse_error_count: number; nonliteral_dynamic: number };
    };
    assertEquals(report.graph.nonliteral_dynamic, 1);
    assertEquals(report.graph.parse_error_count, 0);
    const gated = await runCli(dir, ["--fail-on-new", "--fail-on-stale"], ["run", "-A", CLI]);
    assertEquals(gated.code, FAILURE_EXIT);
    assertStringIncludes(gated.stderr, "nonliteral dynamic");
  });
});

Deno.test("cycle-report-cause: the text report names the parse count and every cause", async () => {
  await withTempDir(async (dir) => {
    await writeCycleProject(dir);
    await Deno.writeTextFile(join(dir, "src/broken.ts"), "export function broken( {\n");
    const text = await runCli(dir, [], ["run", "-A", CLI], { baseline: null });
    assertEquals(text.code, 0);
    assertStringIncludes(text.stdout, "1 parse error(s)");
    assertStringIncludes(text.stdout, "0 unresolved reference(s)");
    assertStringIncludes(text.stdout, "0 computed dynamic import(s)");
    assertStringIncludes(text.stdout, "src/broken.ts could not be parsed");
  });
});
