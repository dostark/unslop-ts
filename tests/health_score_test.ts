/**
 * @module HealthScoreTest
 * @path tests/health_score_test.ts
 * @description The nine penalty adapters, the grade boundaries, the duplication union and the local runner.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/health_score.ts, src/report/duplication.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { canRun } from "./helpers/permissions.ts";
import { MAX_JSCPD_REPORT_BYTES } from "../src/report/constants.ts";
import { checkRepository, type TJscpdRunner } from "../src/rules/whole_tree/duplicate_code.ts";
import type { IDuplicateCodeSettings } from "../src/rules/whole_tree/options.ts";
import {
  collectHealth,
  duplicatedLinesOf,
  gradeOf,
  healthScoreOf,
  type IScoreInput,
  localJscpdRunner,
  measureDuplication,
  scoreSignalsOf,
  scoreValueOf,
} from "../src/report/mod.ts";

/** Fresh duplication settings for one fixture file or directory. */
function duplicationSettings(path = "a.ts"): IDuplicateCodeSettings {
  return {
    jscpdVersion: "5.4.2",
    minLines: 5,
    minTokens: 50,
    maxGapLines: 0,
    baseline: null,
    crossGroups: false,
    groups: [{ name: "a", paths: [path], ignore: [], threshold: 100, minLines: 5, maxGapLines: 0, pattern: null }],
  };
}

const EMPTY_REPORT_RUNNER: TJscpdRunner = async (_args, outputDir) => {
  await Deno.writeTextFile(
    join(outputDir, "jscpd-report.json"),
    JSON.stringify({
      statistics: { total: { percentage: 0, duplicatedLines: 0, sources: 1, lines: 10 } },
      duplicates: [],
    }),
  );
};

/** One clean score input, with every supported signal measured. */
function cleanInput(): IScoreInput {
  return {
    deadFiles: { count: 0, population: 10, available: true },
    deadExports: { unused: 0, total: 10 },
    complexity: { critical: 0, units: 100, parseFailed: false },
    maintainability: { low: 0, files: 10 },
    hotspots: { count: 0, files: 100, available: true, reason: null },
    cycles: { sccs: 0, files: 100, complete: true },
    unitSize: { over: 0, units: 100, parseFailed: false },
    coupling: { high: 0, files: 100, complete: true },
    duplication: { lines: 0, total: 100, available: true, reason: null },
  };
}

/** The penalty of one named signal in a signal list. */
function penaltyOf(input: IScoreInput, signal: string): number {
  return scoreSignalsOf(input).find((entry) => entry.signal === signal)?.penalty ?? -1;
}

Deno.test("health-score-penalties: every table weight and cap is exact", () => {
  const input = cleanInput();
  assertEquals(penaltyOf({ ...input, deadFiles: { count: 10, population: 10, available: true } }, "dead_files"), 15);
  assertEquals(penaltyOf({ ...input, deadFiles: { count: 5, population: 10, available: true } }, "dead_files"), 10);
  assertEquals(penaltyOf({ ...input, deadExports: { unused: 5, total: 10 } }, "dead_exports"), 10);
  assertEquals(penaltyOf({ ...input, complexity: { critical: 5, units: 10, parseFailed: false } }, "complexity"), 20);
  assertEquals(
    penaltyOf({ ...input, maintainability: { low: 10, files: 10 } }, "maintainability"),
    15,
  );
  assertEquals(
    penaltyOf({ ...input, hotspots: { count: 10, files: 1000, available: true, reason: null } }, "hotspots"),
    10,
  );
  assertEquals(penaltyOf({ ...input, cycles: { sccs: 100, files: 100, complete: true } }, "cycles"), 25);
  assertEquals(penaltyOf({ ...input, cycles: { sccs: 1, files: 1000, complete: true } }, "cycles"), 0.5);
  assertEquals(penaltyOf({ ...input, unitSize: { over: 10, units: 10, parseFailed: false } }, "unit_size"), 10);
  assertEquals(penaltyOf({ ...input, coupling: { high: 10, files: 10, complete: true } }, "coupling"), 5);
  assertEquals(
    penaltyOf({ ...input, duplication: { lines: 15, total: 100, available: true, reason: null } }, "duplication"),
    10,
  );
  assertEquals(
    penaltyOf({ ...input, duplication: { lines: 4, total: 100, available: true, reason: null } }, "duplication"),
    0,
  );

  assertEquals(gradeOf(85), "A");
  assertEquals(gradeOf(84.999), "B");
  assertEquals(gradeOf(70), "B");
  assertEquals(gradeOf(69.999), "C");
  assertEquals(gradeOf(55), "C");
  assertEquals(gradeOf(40), "D");
  assertEquals(gradeOf(39.999), "F");
});

Deno.test("health-score-not-measured: unsupported signals cost nothing and incomplete input has no grade", () => {
  const complete = healthScoreOf(scoreSignalsOf(cleanInput()));
  assertEquals(complete.status, "complete");
  assertEquals(complete.grade, "A");
  assertEquals(complete.value, 100);

  const signals = scoreSignalsOf(cleanInput());
  assertEquals(signals.filter((signal) => signal.status === "not_measured").map((signal) => signal.signal), [
    "unused_dependencies",
    "prop_drilling",
  ]);
  assertEquals(
    signals.filter((signal) => signal.status === "not_measured").every((signal) => signal.penalty === 0),
    true,
  );

  const input = cleanInput();
  const partial = healthScoreOf(scoreSignalsOf({
    ...input,
    deadFiles: { count: 0, population: 10, available: false },
    duplication: { lines: 0, total: 0, available: false, reason: "jscpd-not-installed" },
  }));
  assertEquals(partial.status, "partial");
  assertEquals(partial.grade, null);
  assertEquals(partial.value, 100);
  const reasons = partial.signals.filter((signal) => signal.status === "unavailable").map((signal) => signal.reason);
  assertEquals(reasons, ["dead-file-scan-failed", "jscpd-not-installed"]);
  assertEquals(scoreValueOf(partial.signals), 100);
});

Deno.test("health-duplication-union: overlapping copies union once and a changed source is rejected", async () => {
  const tokenLines = new Map([
    ["a.ts", new Set([1, 2, 3, 4, 5, 6, 7, 8])],
    ["b.ts", new Set([1, 2, 3, 4, 5, 6, 7, 8])],
  ]);
  const clone = {
    id: "x",
    lines: 4,
    first: { file: "a.ts", start: 2, end: 5 },
    second: { file: "b.ts", start: 2, end: 5 },
  };
  const overlapping = {
    id: "y",
    lines: 4,
    first: { file: "a.ts", start: 4, end: 7 },
    second: { file: "a.ts", start: 6, end: 9 },
  };
  assertEquals(duplicatedLinesOf([clone], tokenLines), 8);
  assertEquals(duplicatedLinesOf([clone, overlapping], tokenLines), 11);
  assertEquals(duplicatedLinesOf([], tokenLines), 0);

  const settings = duplicationSettings();
  const runner = EMPTY_REPORT_RUNNER;
  const measured = await measureDuplication({
    rootPath: Deno.cwd(),
    settings,
    runner,
    tokenLines,
    snapshotDigest: () => Promise.resolve("before"),
  });
  assertEquals(measured.available, true);
  assertEquals(measured.total_lines, 16);
  let calls = 0;
  const changed = await measureDuplication({
    rootPath: Deno.cwd(),
    settings,
    runner,
    tokenLines,
    snapshotDigest: () => Promise.resolve(calls++ === 0 ? "before" : "after"),
  });
  assertEquals(changed.available, false);
  assertEquals(changed.reason, "source-changed-during-scan");
});

const NODE_RUNNABLE = canRun("node");
if (!NODE_RUNNABLE) console.warn("the jscpd runner tests are ignored: the process may not spawn node");

Deno.test("fix(health-duplication): the pinned Deno npm package supplies the local runner", {
  ignore: !NODE_RUNNABLE,
}, async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop_jscpd_deno_" });
  try {
    const packageRoot = join(root, "node_modules/.deno/jscpd@5.4.2/node_modules/jscpd");
    await Deno.mkdir(packageRoot, { recursive: true });
    await Deno.writeTextFile(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "jscpd", version: "5.4.2", bin: "run-jscpd.js" }),
    );
    const record = join(root, "ran.txt");
    await Deno.writeTextFile(
      join(packageRoot, "run-jscpd.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(record)}, "ran");\n`,
    );
    const runner = await localJscpdRunner(root, "5.4.2");
    await runner(["--version"], root);
    assertEquals(await Deno.readTextFile(record), "ran");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("health-runner-security: the local bin is version and containment checked, and failures clean up", {
  ignore: !NODE_RUNNABLE,
}, async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop_jscpd_" });
  const tempRoot = await Deno.makeTempDir({ prefix: "unslop_jscpd_temp_" });
  try {
    await Deno.mkdir(join(root, "node_modules/jscpd/bin"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "node_modules/jscpd/package.json"),
      JSON.stringify({ name: "jscpd", version: "5.4.2", bin: "bin/jscpd.js" }),
    );
    const record = join(root, "argv.json");
    await Deno.writeTextFile(
      join(root, "node_modules/jscpd/bin/jscpd.js"),
      `const fs = require("node:fs");\n` +
        `const out = process.argv[process.argv.indexOf("--output") + 1];\n` +
        `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\n` +
        `fs.writeFileSync(out + "/jscpd-report.json", JSON.stringify({ statistics: { total: { percentage: 0, duplicatedLines: 0, sources: 1, lines: 1 } }, duplicates: [] }));\n`,
    );
    const runner = await localJscpdRunner(root, "5.4.2");
    const outputDir = join(root, "out");
    await Deno.mkdir(outputDir);
    await runner(["--reporters", "json", "--output", outputDir, "."], outputDir);
    const argv = JSON.parse(await Deno.readTextFile(record)) as string[];
    assertEquals(argv.includes("npx"), false);
    assertEquals(argv.includes("npm"), false);
    assert(argv.includes("--output"));
    assert(argv.includes("."));
    assert(argv.length >= 4);

    await Deno.writeTextFile(
      join(root, "node_modules/jscpd/package.json"),
      JSON.stringify({ name: "jscpd", version: "5.4.1", bin: "bin/jscpd.js" }),
    );
    await assertThrowsAsync(() => localJscpdRunner(root, "5.4.2"), "jscpd-version-mismatch");
    await Deno.writeTextFile(
      join(root, "node_modules/jscpd/package.json"),
      JSON.stringify({ name: "jscpd", version: "5.4.2", bin: "../escaped.js" }),
    );
    await Deno.writeTextFile(join(root, "node_modules/escaped.js"), "process.exit(0);\n");
    await assertThrowsAsync(() => localJscpdRunner(root, "5.4.2"), "jscpd-bin-outside-package");
    await Deno.remove(join(root, "node_modules/jscpd"), { recursive: true });
    await assertThrowsAsync(() => localJscpdRunner(root, "5.4.2"), "jscpd-not-installed");

    const settings = duplicationSettings(".");
    await assertThrowsAsync(
      () => checkRepository(root, settings, () => Promise.reject(new Error("denied")), { tempRoot }),
      "denied",
    );
    assertEquals([...Deno.readDirSync(tempRoot)], []);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(tempRoot, { recursive: true });
  }
});

/** Asserts that an async call rejects with a message that contains the fragment. */
async function assertThrowsAsync(call: () => Promise<unknown>, fragment: string): Promise<void> {
  try {
    await call();
  } catch (error) {
    assertStringIncludes(error instanceof Error ? error.message : String(error), fragment);
    return;
  }
  throw new Error(`expected a rejection containing '${fragment}'`);
}

/** Asserts that a string contains a fragment. */
function assertStringIncludes(actual: string, expected: string): void {
  assert(actual.includes(expected), `'${actual}' does not include '${expected}'`);
}

const POPULATION_FILES = 100;
const CYCLE_FILES = 2;

Deno.test("health-cycle-score-population: one two-file cycle among 100 files scores over all measured files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "unslop_cycle_score_" });
  try {
    await Deno.mkdir(join(dir, "src"));
    await Deno.writeTextFile(join(dir, "src/a.ts"), 'import { b } from "./b.ts";\nexport const a = b;\n');
    await Deno.writeTextFile(join(dir, "src/b.ts"), 'import { a } from "./a.ts";\nexport const b = () => a;\n');
    for (let index = 0; index < POPULATION_FILES - CYCLE_FILES; index++) {
      await Deno.writeTextFile(join(dir, `src/f${index}.ts`), `export const f${index} = ${index};\n`);
    }
    const report = await collectHealth({
      rootPath: dir,
      ignoreGlobs: [],
      scopes: { test: [], fixture: [] },
      settings: {
        maxCyclomatic: 15,
        maxCognitive: 15,
        maxLines: 60,
        maxCrap: 30,
        variant: "extended",
        countNullish: true,
      },
      sort: "severity",
      coverageText: null,
      testGlobs: [],
      coverageSha256: null,
      coverageManifest: null,
      sinceEpoch: 0,
      minCommits: 1,
      nowEpoch: 0,
      duplication: null,
      duplicateRunner: null,
      publicEntries: [],
    });
    const signal = report.health_score.signals.find((entry) => entry.signal === "cycles");
    assertEquals(signal?.numerator, 1);
    assertEquals(signal?.denominator, POPULATION_FILES);
    assertEquals(signal?.raw, 10);
    assertEquals(signal?.penalty, 5);
    assertEquals(report.vital_signs.cycles.per_thousand, signal?.raw);
    assertEquals(report.vital_signs.cycles.files, CYCLE_FILES);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const BIG_END = Number.MAX_SAFE_INTEGER;

Deno.test("health-clone-finite-ranges: invalid ranges become attributed absences and huge ranges end promptly", async () => {
  const tokenLines = new Map([["a.ts", new Set([1, 2, 3])], ["b.ts", new Set([4, 6, 9])]]);
  const huge = {
    id: "h",
    lines: 1,
    first: { file: "a.ts", start: 1, end: BIG_END },
    second: { file: "b.ts", start: 5, end: BIG_END },
  };
  assertEquals(duplicatedLinesOf([huge], tokenLines), 5);

  const settings = duplicationSettings();
  const reportWith = (first: string, second: string): TJscpdRunner => async (_args, outputDir) => {
    await Deno.writeTextFile(
      join(outputDir, "jscpd-report.json"),
      '{"statistics":{"total":{"percentage":0,"duplicatedLines":0,"sources":1,"lines":10}},"duplicates":[' +
        `{"lines":5,"firstFile":${first},"secondFile":${second}}]}`,
    );
  };
  const range = (start: string, end: string): string => `{"name":"a.ts","start":${start},"end":${end}}`;
  const invalid = [
    range("1", "1e309"),
    range("-3", "4"),
    range("9", "2"),
    range("1.5", "4"),
    range("0", "4"),
    range('"1"', "4"),
  ];
  for (const first of invalid) {
    const measured = await measureDuplication({
      rootPath: Deno.cwd(),
      settings,
      runner: reportWith(first, range("1", "5")),
      tokenLines,
      snapshotDigest: () => Promise.resolve("same"),
    });
    assertEquals(measured.available, false, first);
    assertStringIncludes(measured.reason ?? "", "invalid clone range");
  }
  const accepted = await measureDuplication({
    rootPath: Deno.cwd(),
    settings,
    runner: reportWith(range("1", String(BIG_END)), range("1", "5")),
    tokenLines,
    snapshotDigest: () => Promise.resolve("same"),
  });
  assertEquals(accepted.available, true, accepted.reason ?? "");
});

Deno.test("health-runner-stream-bounds: a runner that floods stderr or stalls is killed and rejected", {
  ignore: !NODE_RUNNABLE,
}, async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop_jscpd_flood_" });
  try {
    await Deno.mkdir(join(root, "node_modules/jscpd/bin"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "node_modules/jscpd/package.json"),
      JSON.stringify({ name: "jscpd", version: "5.4.2", bin: "bin/jscpd.js" }),
    );
    const marker = join(root, "marker");
    const bin = join(root, "node_modules/jscpd/bin/jscpd.js");
    const limits = { deadlineMs: 1_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 256 * 1024 };
    await Deno.writeTextFile(
      bin,
      `const fs = require("node:fs");\nconst chunk = "x".repeat(65536);\n` +
        `for (let index = 0; index < 64; index++) fs.writeSync(2, chunk);\n` +
        `fs.writeFileSync(${JSON.stringify(marker)}, "done");\n`,
    );
    const runner = await localJscpdRunner(root, "5.4.2", limits);
    await assertThrowsAsync(() => runner(["--output", root], root), "output exceeds");
    assertEquals(await Deno.stat(marker).then(() => true, () => false), false);
    await Deno.writeTextFile(bin, `setTimeout(() => {}, 60000);\n`);
    await assertThrowsAsync(() => runner(["--output", root], root), "deadline");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("duplication-digest-failure: a digest that cannot be read is an unavailable signal and the run completes", async () => {
  const settings = duplicationSettings();
  const runner = EMPTY_REPORT_RUNNER;
  const tokenLines = new Map([["a.ts", new Set([1, 2])]]);
  for (const failAt of [0, 1]) {
    let calls = 0;
    const measured = await measureDuplication({
      rootPath: Deno.cwd(),
      settings,
      runner,
      tokenLines,
      snapshotDigest: () => (calls++ === failAt ? Promise.reject(new Error("file vanished")) : Promise.resolve("same")),
    });
    assertEquals(measured.available, false, `digest call ${failAt}`);
    assertEquals(measured.reason, "source-changed-during-scan");
  }
});

Deno.test("jscpd-report-bound-cause: an oversized report names the byte bound, not a missing report", async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop_big_report_" });
  const tempRoot = await Deno.makeTempDir({ prefix: "unslop_big_report_temp_" });
  try {
    const settings = duplicationSettings(".");
    const runner: TJscpdRunner = async (_args, outputDir) => {
      const file = await Deno.open(join(outputDir, "jscpd-report.json"), { create: true, write: true });
      await file.truncate(MAX_JSCPD_REPORT_BYTES + 1);
      file.close();
    };
    await assertThrowsAsync(() => checkRepository(root, settings, runner, { tempRoot }), "byte bound");
    assertEquals([...Deno.readDirSync(tempRoot)], []);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(tempRoot, { recursive: true });
  }
});
