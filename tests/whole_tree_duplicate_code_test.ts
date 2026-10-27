/**
 * @module WholeTreeDuplicateCodeTest
 * @path tests/whole_tree_duplicate_code_test.ts
 * @description The duplicate-code check turns each configured scan group into a jscpd run and compares the reported duplication to the group threshold.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/duplicate_code.ts, src/rules/whole_tree/options.ts]
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
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
    threshold: 2,
    ...overrides,
  };
}

function settings(groups: IDuplicateCodeGroup[]): IDuplicateCodeSettings {
  return { jscpdVersion: DEFAULT_JSCPD_VERSION, minLines: 5, minTokens: 50, groups };
}

function report(percentage: number): string {
  return JSON.stringify({
    statistics: { total: { percentage, duplicatedLines: 12, clones: 1, sources: 3 } },
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
    lines: 6,
    first: { file: "packages/a.ts", start: 1, end: 7 },
    second: { file: "packages/b.ts", start: 3, end: 9 },
  }]);
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
