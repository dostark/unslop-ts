/**
 * @module HealthScoreTest
 * @path tests/health_score_test.ts
 * @description The nine penalty adapters, the grade boundaries, the duplication union and the local runner.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/health_score.ts, src/report/duplication.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { checkRepository, type TJscpdRunner } from "../src/rules/whole_tree/duplicate_code.ts";
import type { IDuplicateCodeSettings } from "../src/rules/whole_tree/options.ts";
import {
  duplicatedLinesOf,
  gradeOf,
  healthScoreOf,
  type IScoreInput,
  localJscpdRunner,
  measureDuplication,
  scoreSignalsOf,
  scoreValueOf,
} from "../src/report/mod.ts";

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

  const settings: IDuplicateCodeSettings = {
    jscpdVersion: "5.4.2",
    minLines: 5,
    minTokens: 50,
    maxGapLines: 0,
    baseline: null,
    crossGroups: false,
    groups: [{ name: "a", paths: ["a.ts"], ignore: [], threshold: 100, minLines: 5, maxGapLines: 0, pattern: null }],
  };
  const runner: TJscpdRunner = async (_args, outputDir) => {
    await Deno.writeTextFile(
      join(outputDir, "jscpd-report.json"),
      JSON.stringify({
        statistics: { total: { percentage: 0, duplicatedLines: 0, sources: 1, lines: 10 } },
        duplicates: [],
      }),
    );
  };
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

Deno.test("health-runner-security: the local bin is version and containment checked, and failures clean up", async () => {
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

    const settings: IDuplicateCodeSettings = {
      jscpdVersion: "5.4.2",
      minLines: 5,
      minTokens: 50,
      maxGapLines: 0,
      baseline: null,
      crossGroups: false,
      groups: [{ name: "a", paths: ["."], ignore: [], threshold: 100, minLines: 5, maxGapLines: 0, pattern: null }],
    };
    await assertThrowsAsync(
      () =>
        checkRepository(root, settings, async () => {
          throw new Error("denied");
        }, { tempRoot }),
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
