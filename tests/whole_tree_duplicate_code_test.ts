/**
 * @module WholeTreeDuplicateCodeTest
 * @path tests/whole_tree_duplicate_code_test.ts
 * @description The duplicate-code check turns each configured scan group into a jscpd run and compares the reported duplication to the group threshold.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/duplicate_code.ts, src/rules/whole_tree/options.ts]
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { fingerprintClone } from "../src/rules/whole_tree/duplicate_baseline.ts";
import {
  buildJscpdArgs,
  checkRepository,
  JSCPD_REPORT_FILE,
  selectGroups,
  type TJscpdRunner,
} from "../src/rules/whole_tree/duplicate_code.ts";
import {
  DEFAULT_JSCPD_VERSION,
  DuplicateCodeSettingsSchema,
  type IDuplicateCodeGroup,
  type IDuplicateCodeSettings,
} from "../src/rules/whole_tree/options.ts";

const OUTPUT_DIR = "/tmp/report";

function group(overrides: Partial<IDuplicateCodeGroup>): IDuplicateCodeGroup {
  return {
    name: "source",
    paths: ["packages/"],
    ignore: [],
    pattern: null,
    minLines: null,
    maxGapLines: null,
    threshold: 2,
    ...overrides,
  };
}

function settings(groups: IDuplicateCodeGroup[]): IDuplicateCodeSettings {
  return {
    jscpdVersion: DEFAULT_JSCPD_VERSION,
    minLines: 5,
    minTokens: 50,
    maxGapLines: 0,
    baseline: null,
    crossGroups: false,
    groups,
  };
}

function report(percentage: number): string {
  return JSON.stringify({
    statistics: { total: { percentage, duplicatedLines: 12, clones: 1, sources: 3, lines: 400 } },
    duplicates: [{
      lines: 6,
      firstFile: { name: "packages/a.ts", start: 1, end: 7 },
      secondFile: { name: "packages/b.ts", start: 3, end: 9 },
    }],
  });
}

/** A runner that writes a canned report for each group, in order, instead of starting jscpd. */
function fakeRunner(percentages: number[], calls: string[][] = []): TJscpdRunner {
  return async (args, outputDir) => {
    calls.push([...args]);
    await Deno.writeTextFile(join(outputDir, JSCPD_REPORT_FILE), report(percentages[calls.length - 1] ?? 0));
  };
}

Deno.test("the jscpd arguments carry the group paths, filters, and limits but no threshold", () => {
  const args = buildJscpdArgs(
    settings([]),
    group({ paths: ["packages/", "apps/"], ignore: ["**/*.d.ts", "**/dist/**"], pattern: "**/tests/**/*.ts" }),
    OUTPUT_DIR,
  );
  assertEquals(args.slice(0, 2), ["packages/", "apps/"]);
  assertEquals(args[args.indexOf("--ignore") + 1], "**/*.d.ts,**/dist/**");
  assertEquals(args[args.indexOf("--min-lines") + 1], "5");
  assertEquals(args[args.indexOf("--min-tokens") + 1], "50");
  assertEquals(args[args.indexOf("--pattern") + 1], "**/tests/**/*.ts");
  assertEquals(args[args.indexOf("--reporters") + 1], "json");
  assertEquals(args[args.indexOf("--output") + 1], OUTPUT_DIR);
  assertEquals(args.includes("--threshold"), false);
});

Deno.test("a group minimum overrides the shared minimum for that group only", () => {
  const shared = settings([]);
  const own = buildJscpdArgs(shared, group({ minLines: 10 }), OUTPUT_DIR);
  const inherited = buildJscpdArgs(shared, group({}), OUTPUT_DIR);
  assertEquals(own[own.indexOf("--min-lines") + 1], "10");
  assertEquals(inherited[inherited.indexOf("--min-lines") + 1], "5");
});

Deno.test("the group minimum defaults to null and must be a positive integer", () => {
  const parsed = DuplicateCodeSettingsSchema.parse({
    groups: [{ name: "a", paths: ["x/"], threshold: 1 }, { name: "b", paths: ["y/"], threshold: 1, minLines: 12 }],
  });
  assertEquals(parsed.groups.map((entry) => entry.minLines), [null, 12]);
  assertThrows(() =>
    DuplicateCodeSettingsSchema.parse({ groups: [{ name: "a", paths: ["x/"], threshold: 1, minLines: 0 }] })
  );
});

Deno.test("a group without a pattern or ignore globs passes neither flag", () => {
  const args = buildJscpdArgs(settings([]), group({}), OUTPUT_DIR);
  assertEquals(args.includes("--pattern"), false);
  assertEquals(args.includes("--ignore"), false);
});

Deno.test("each group runs once and passes only while its duplication stays within the threshold", async () => {
  const calls: string[][] = [];
  const result = await checkRepository(
    Deno.cwd(),
    settings([group({ name: "source", threshold: 2 }), group({ name: "tests", threshold: 3 })]),
    fakeRunner([1.5, 9], calls),
  );
  assertEquals(calls.length, 2);
  assertEquals(result.groups.map((entry) => [entry.name, entry.passed]), [["source", true], ["tests", false]]);
  assertEquals(result.groups[1]?.percentage, 9);
  assertEquals(result.groups[1]?.threshold, 3);
});

Deno.test("a percentage equal to the threshold passes", async () => {
  const result = await checkRepository(Deno.cwd(), settings([group({ threshold: 2 })]), fakeRunner([2]));
  assertEquals(result.groups[0]?.passed, true);
});

Deno.test("each clone keeps both file ranges for the verbose report", async () => {
  const result = await checkRepository(Deno.cwd(), settings([group({})]), fakeRunner([1]));
  assertEquals(result.groups[0]?.clones, [{
    id: result.groups[0]?.clones[0]?.id ?? "",
    lines: 6,
    first: { file: "packages/a.ts", start: 1, end: 7 },
    second: { file: "packages/b.ts", start: 3, end: 9 },
  }]);
  assert(/^[0-9a-f]{16}$/.test(result.groups[0]?.clones[0]?.id ?? ""));
});

Deno.test("a runner that writes no report fails with the group name", async () => {
  const silent: TJscpdRunner = () => Promise.resolve();
  const error = await assertRejects(() => checkRepository(Deno.cwd(), settings([group({ name: "tests" })]), silent));
  assert(error instanceof Error && error.message.includes("tests"));
});

Deno.test("a report without statistics fails with the group name", async () => {
  const broken: TJscpdRunner = (_args, outputDir) =>
    Deno.writeTextFile(join(outputDir, JSCPD_REPORT_FILE), JSON.stringify({ duplicates: [] }));
  const error = await assertRejects(() => checkRepository(Deno.cwd(), settings([group({ name: "tests" })]), broken));
  assert(error instanceof Error && error.message.includes("tests"));
});

Deno.test("a group that scans no files fails with the group name instead of passing at zero percent", async () => {
  const empty: TJscpdRunner = (_args, outputDir) =>
    Deno.writeTextFile(
      join(outputDir, JSCPD_REPORT_FILE),
      JSON.stringify({ statistics: { total: { percentage: 0, duplicatedLines: 0, sources: 0 } }, duplicates: [] }),
    );
  const error = await assertRejects(() => checkRepository(Deno.cwd(), settings([group({ name: "tests" })]), empty));
  assert(error instanceof Error && error.message.includes("tests") && error.message.includes("no files"));
});

Deno.test("absolute clone paths are reported relative to the repository root", async () => {
  const absolute: TJscpdRunner = (_args, outputDir) =>
    Deno.writeTextFile(
      join(outputDir, JSCPD_REPORT_FILE),
      JSON.stringify({
        statistics: { total: { percentage: 1, duplicatedLines: 6, sources: 2 } },
        duplicates: [{
          lines: 6,
          firstFile: { name: "/repo/packages/a.ts", start: 1, end: 7 },
          secondFile: { name: "/repo/packages/b.ts", start: 3, end: 9 },
        }],
      }),
    );
  const result = await checkRepository("/repo", settings([group({})]), absolute);
  assertEquals(result.groups[0]?.clones[0]?.first.file, "packages/a.ts");
  assertEquals(result.groups[0]?.clones[0]?.second.file, "packages/b.ts");
});

Deno.test("clones are listed largest first, with ties ordered by file", async () => {
  const range = (name: string) => ({ name, start: 1, end: 5 });
  const clone = (lines: number, a: string, b: string) => ({ lines, firstFile: range(a), secondFile: range(b) });
  const unsorted: TJscpdRunner = (_args, outputDir) =>
    Deno.writeTextFile(
      join(outputDir, JSCPD_REPORT_FILE),
      JSON.stringify({
        statistics: { total: { percentage: 1, duplicatedLines: 30, sources: 4 } },
        duplicates: [clone(6, "b.ts", "c.ts"), clone(20, "z.ts", "y.ts"), clone(6, "a.ts", "c.ts")],
      }),
    );
  const result = await checkRepository("/repo", settings([group({})]), unsorted);
  assertEquals(result.groups[0]?.clones.map((entry) => [entry.lines, entry.first.file]), [
    [20, "z.ts"],
    [6, "a.ts"],
    [6, "b.ts"],
  ]);
});

Deno.test("selectGroups keeps the named groups in settings order and rejects an unknown name", () => {
  const all = settings([group({ name: "source" }), group({ name: "tests" }), group({ name: "integration" })]);
  assertEquals(selectGroups(all, []).groups.map((entry) => entry.name), ["source", "tests", "integration"]);
  assertEquals(selectGroups(all, ["integration", "source"]).groups.map((entry) => entry.name), [
    "source",
    "integration",
  ]);
  const error = assertThrows(() => selectGroups(all, ["nope"]));
  assert(error instanceof Error && error.message.includes("nope") && error.message.includes("source, tests"));
});

Deno.test("the settings schema applies the jscpd defaults and group defaults", () => {
  const parsed = DuplicateCodeSettingsSchema.parse({ groups: [{ name: "source", paths: ["src/"], threshold: 2 }] });
  assertEquals(parsed.jscpdVersion, DEFAULT_JSCPD_VERSION);
  assertEquals(parsed.minLines, 5);
  assertEquals(parsed.minTokens, 50);
  assertEquals(parsed.groups[0]?.ignore, []);
  assertEquals(parsed.groups[0]?.pattern, null);
});

Deno.test("the settings schema rejects a missing group list, a duplicate group name, and an empty path list", () => {
  assertThrows(() => DuplicateCodeSettingsSchema.parse({}));
  assertThrows(() =>
    DuplicateCodeSettingsSchema.parse({
      groups: [{ name: "a", paths: ["x/"], threshold: 1 }, { name: "a", paths: ["y/"], threshold: 1 }],
    })
  );
  assertThrows(() => DuplicateCodeSettingsSchema.parse({ groups: [{ name: "a", paths: [], threshold: 1 }] }));
});

Deno.test("the settings schema rejects a negative threshold and an unknown key", () => {
  assertThrows(() => DuplicateCodeSettingsSchema.parse({ groups: [{ name: "a", paths: ["x/"], threshold: -1 }] }));
  assertThrows(() =>
    DuplicateCodeSettingsSchema.parse({ groups: [{ name: "a", paths: ["x/"], threshold: 1 }], extra: true })
  );
});

type TRawClone = [string, number, number, string, number, number];

function clonesReport(clones: TRawClone[], totalLines: number): string {
  return JSON.stringify({
    statistics: { total: { percentage: 1, duplicatedLines: 5, clones: clones.length, sources: 3, lines: totalLines } },
    duplicates: clones.map(([a, a1, a2, b, b1, b2]) => ({
      lines: a2 - a1 + 1,
      firstFile: { name: a, start: a1, end: a2 },
      secondFile: { name: b, start: b1, end: b2 },
    })),
  });
}

/** A runner that answers every jscpd run with the same canned clones. */
function clonesRunner(clones: TRawClone[], totalLines: number): TJscpdRunner {
  return (_args, outputDir) => Deno.writeTextFile(join(outputDir, JSCPD_REPORT_FILE), clonesReport(clones, totalLines));
}

Deno.test("involved lines count each line once across every clone and become a share of the scanned lines", async () => {
  const runner = clonesRunner([["a.ts", 1, 7, "b.ts", 3, 9], ["a.ts", 5, 11, "c.ts", 1, 7]], 500);
  const result = await checkRepository("/repo", settings([group({})]), runner);
  assertEquals(result.groups[0]?.totalLines, 500);
  assertEquals(result.groups[0]?.involvedLines, 25);
  assertEquals(result.groups[0]?.involvedPercentage, 5);
});

Deno.test("a group that scanned no lines reports a zero involved share instead of dividing by zero", async () => {
  const result = await checkRepository("/repo", settings([group({})]), clonesRunner([], 0));
  assertEquals(result.groups[0]?.involvedPercentage, 0);
});

Deno.test("the maximum gap goes to jscpd only when it is above zero, and a group value replaces the shared one", () => {
  const flag = (shared: number, own: number | null): string | undefined => {
    const args = buildJscpdArgs({ ...settings([]), maxGapLines: shared }, group({ maxGapLines: own }), OUTPUT_DIR);
    const index = args.indexOf("--max-gap-lines");
    return index < 0 ? undefined : args[index + 1];
  };
  assertEquals(flag(0, null), undefined);
  assertEquals(flag(8, null), "8");
  assertEquals(flag(8, 3), "3");
  assertEquals(flag(8, 0), undefined);
});

Deno.test("the settings schema defaults the gap, baseline, and cross-group options and rejects a negative gap", () => {
  const parsed = DuplicateCodeSettingsSchema.parse({ groups: [{ name: "a", paths: ["x/"], threshold: 1 }] });
  assertEquals(parsed.maxGapLines, 0);
  assertEquals(parsed.baseline, null);
  assertEquals(parsed.crossGroups, false);
  assertEquals(parsed.groups[0]?.maxGapLines, null);
  assertThrows(() =>
    DuplicateCodeSettingsSchema.parse({ maxGapLines: -1, groups: [{ name: "a", paths: ["x/"], threshold: 1 }] })
  );
});

async function withBaselineFile(text: string | null, run: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await Deno.makeTempDir({ prefix: "unslop_baseline_test_" });
  try {
    if (text !== null) await Deno.writeTextFile(join(repoRoot, "baseline.json"), text);
    await run(repoRoot);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
}

const KNOWN_ID = fingerprintClone(
  { file: "packages/a.ts", start: 1, end: 7 },
  { file: "packages/b.ts", start: 3, end: 9 },
  null,
  6,
);

function baselineText(ids: string[]): string {
  const entry = (id: string) => ({ id, lines: 6, first: "packages/a.ts:1-7", second: "packages/b.ts:3-9" });
  return JSON.stringify({ version: 1, groups: { source: ids.map(entry) } });
}

Deno.test("a clone listed in the baseline passes, and a clone missing from it fails under the threshold", async () => {
  const withBaseline = { ...settings([group({ name: "source", threshold: 50 })]), baseline: "baseline.json" };
  await withBaselineFile(baselineText([KNOWN_ID]), async (repoRoot) => {
    const known = await checkRepository(repoRoot, withBaseline, fakeRunner([1]));
    assertEquals(known.groups[0]?.newClones, []);
    assertEquals(known.groups[0]?.passed, true);
  });
  await withBaselineFile(baselineText(["other"]), async (repoRoot) => {
    const fresh = await checkRepository(repoRoot, withBaseline, fakeRunner([1]));
    assertEquals(fresh.groups[0]?.newClones.map((entry) => entry.id), [KNOWN_ID]);
    assertEquals(fresh.groups[0]?.resolvedClones, 1);
    assertEquals(fresh.groups[0]?.passed, false);
  });
});

Deno.test("the threshold still fails a group whose clones are all in the baseline", async () => {
  const withBaseline = { ...settings([group({ name: "source", threshold: 2 })]), baseline: "baseline.json" };
  await withBaselineFile(baselineText([KNOWN_ID]), async (repoRoot) => {
    const result = await checkRepository(repoRoot, withBaseline, fakeRunner([9]));
    assertEquals(result.groups[0]?.newClones, []);
    assertEquals(result.groups[0]?.passed, false);
  });
});

Deno.test("a configured baseline file that does not exist fails with the update flag in the message", async () => {
  const withBaseline = { ...settings([group({})]), baseline: "baseline.json" };
  await withBaselineFile(null, async (repoRoot) => {
    const error = await assertRejects(() => checkRepository(repoRoot, withBaseline, fakeRunner([1])));
    assert(
      error instanceof Error && error.message.includes("baseline.json") && error.message.includes("--update-baseline"),
    );
  });
});

Deno.test("without a baseline every group reports no new clones and gates on its threshold alone", async () => {
  const result = await checkRepository(Deno.cwd(), settings([group({ threshold: 2 })]), fakeRunner([1]));
  assertEquals(result.groups[0]?.newClones, []);
  assertEquals(result.groups[0]?.resolvedClones, 0);
  assertEquals(result.cross, null);
});

const CROSS_GROUPS = [
  group({ name: "source", paths: ["packages/"], ignore: ["**/tests/**", "**/dist/**"], threshold: 50 }),
  group({
    name: "tests",
    paths: ["packages/"],
    ignore: ["**/dist/**"],
    pattern: "**/tests/**/*.ts",
    minLines: 10,
    threshold: 50,
  }),
];

/** A runner whose per-group runs report no clones and whose later union run reports one clone across both groups. */
function crossRunner(calls: string[][], crossLines: number): TJscpdRunner {
  return async (args, outputDir) => {
    calls.push([...args]);
    const isUnion = calls.length > CROSS_GROUPS.length;
    const clones: TRawClone[] = isUnion
      ? [["packages/a/src/x.ts", 1, crossLines, "packages/a/tests/x_test.ts", 1, crossLines]]
      : [];
    await Deno.writeTextFile(join(outputDir, JSCPD_REPORT_FILE), clonesReport(clones, 1000));
  };
}

Deno.test("the cross-group pass scans the union of the group paths once and keeps clones across groups", async () => {
  const calls: string[][] = [];
  const result = await checkRepository(
    "/repo",
    { ...settings(CROSS_GROUPS), crossGroups: true },
    crossRunner(calls, 12),
  );
  assertEquals(calls.length, 3);
  const union = calls[2] ?? [];
  assertEquals(union.slice(0, 1), ["packages/"]);
  assertEquals(union[union.indexOf("--min-lines") + 1], "5");
  assertEquals(union[union.indexOf("--ignore") + 1], "**/dist/**");
  assertEquals(union.includes("--pattern"), false);
  assertEquals(result.cross?.clones.length, 1);
  assertEquals(result.cross?.passed, true);
});

Deno.test("a cross-group clone that the baseline does not list fails the run", async () => {
  await withBaselineFile(JSON.stringify({ version: 1, groups: {} }), async (repoRoot) => {
    const result = await checkRepository(
      repoRoot,
      { ...settings(CROSS_GROUPS), crossGroups: true, baseline: "baseline.json" },
      crossRunner([], 12),
    );
    assertEquals(result.cross?.newClones.length, 1);
    assertEquals(result.cross?.passed, false);
  });
});

Deno.test("a cross-group clone shorter than the larger group minimum is dropped", async () => {
  const result = await checkRepository("/repo", { ...settings(CROSS_GROUPS), crossGroups: true }, crossRunner([], 7));
  assertEquals(result.cross?.clones, []);
});

Deno.test("the cross-group pass is skipped when fewer than two groups run", async () => {
  const calls: string[][] = [];
  const result = await checkRepository(
    "/repo",
    { ...settings([CROSS_GROUPS[0]!]), crossGroups: true },
    crossRunner(calls, 12),
  );
  assertEquals(calls.length, 1);
  assertEquals(result.cross, null);
});
