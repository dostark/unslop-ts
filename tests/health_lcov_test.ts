/**
 * @module HealthLcovTest
 * @path tests/health_lcov_test.ts
 * @description LCOV parsing, CRAP arithmetic, coverage ownership and validation outcomes.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/lcov.ts, src/report/crap.ts, src/report/health.ts]
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { coverageOfUnit, crapBandOf, crapOf, estimatedCoverageOf } from "../src/report/crap.ts";
import { assertCoverageManifest, coverageRevisionOf } from "../src/report/health.ts";
import { LcovError, MAX_LCOV_RECORD_BYTES, parseLcov } from "../src/report/lcov.ts";
import { BoundedReadError, readFileBounded } from "../src/report/bounded_io.ts";
import { parseHealthFile } from "../src/report/parse.ts";

const ROOT = "/root";
const SNAPSHOT: ReadonlySet<string> = new Set(["packages/x/src/a.ts", "packages/x/src/b.ts"]);

/** One LCOV fixture with the supported record kinds. */
function lcovText(): string {
  return [
    "TN:deno",
    "SF:packages/x/src/a.ts",
    "FN:3,covered",
    "FNDA:2,covered",
    "DA:3,1",
    "DA:3,4",
    "DA:5,0",
    "BRDA:3,0,0,1",
    "LF:2",
    "LH:1",
    "end_of_record",
    "SF:file:///root/packages/x/src/b.ts",
    "DA:1,3",
    "end_of_record",
    "SF:packages/x/src/outside.ts",
    "DA:1,1",
    "end_of_record",
    "SF:../outside.ts",
    "DA:1,1",
    "end_of_record",
  ].join("\n");
}

Deno.test("lcov-parse: real SF, DA, FN, FNDA and metadata records map to snapshot lines", () => {
  const coverage = parseLcov(lcovText(), ROOT, SNAPSHOT);
  assertEquals([...coverage.files.get("packages/x/src/a.ts")!.lines], [[3, 5], [5, 0]]);
  assertEquals([...coverage.files.get("packages/x/src/b.ts")!.lines], [[1, 3]]);
  assertEquals(coverage.unmatched, ["packages/x/src/outside.ts", "../outside.ts"]);
});

Deno.test("crap-formula: a function at zero coverage scores the untested polynomial", () => {
  assertEquals(crapOf(5, 0), 30);
  assertEquals(crapOf(5, 100), 5);
  assertEquals(crapOf(5, 50), 8.125);
});

Deno.test("crap-static-fallback: runtime reach and the missing or empty sample reasons", () => {
  assertEquals(estimatedCoverageOf("direct"), 85);
  assertEquals(estimatedCoverageOf("indirect"), 40);
  assertEquals(estimatedCoverageOf("none"), 0);

  const missing = coverageOfUnit(new Set([1]), undefined, true, "direct", new Set());
  assertEquals(missing, { source: "estimated", reason: "file_missing", precision: null, percent: 85 });

  const empty = coverageOfUnit(new Set([1]), { lines: new Map() }, true, "indirect", new Set());
  assertEquals(empty, { source: "estimated", reason: "no_executable_samples", precision: null, percent: 40 });

  const noInput = coverageOfUnit(new Set([1]), undefined, false, "none", new Set());
  assertEquals(noInput, { source: "estimated", reason: "no_input", precision: null, percent: 0 });
});

Deno.test("crap-severity-bands: the 30, 50 and 100 boundaries read correctly", () => {
  assertEquals(crapBandOf(29.9), "none");
  assertEquals(crapBandOf(30), "moderate");
  assertEquals(crapBandOf(49.9), "moderate");
  assertEquals(crapBandOf(50), "high");
  assertEquals(crapBandOf(99.9), "high");
  assertEquals(crapBandOf(100), "critical");
});

Deno.test("lcov-ownership-and-errors: shared lines, bad records, traversal and bounds are explicit", () => {
  const shared = new Set([2]);
  const first = { lines: new Map([[1, 1], [2, 0]]) };
  const unitA = coverageOfUnit(new Set([1, 2]), { ...first }, true, "direct", shared);
  assertEquals(unitA, { source: "lcov", reason: "measured", precision: "line_ambiguous", percent: 50 });
  const unitB = coverageOfUnit(new Set([2, 5]), { lines: new Map([[2, 1], [5, 1]]) }, true, "direct", shared);
  assertEquals(unitB, { source: "lcov", reason: "measured", precision: "line_ambiguous", percent: 100 });
  const ownLines = coverageOfUnit(new Set([9]), { lines: new Map([[9, 1]]) }, true, "direct", shared);
  assertEquals(ownLines.precision, "line");

  assertThrows(() => parseLcov("SF:packages/x/src/a.ts\nDA:0,1\nend_of_record", ROOT, SNAPSHOT), LcovError);
  assertThrows(() => parseLcov("SF:packages/x/src/a.ts\nDA:1,-1\nend_of_record", ROOT, SNAPSHOT), LcovError);
  assertThrows(() => parseLcov("SF:packages/x/src/a.ts\nDA:1,NaN\nend_of_record", ROOT, SNAPSHOT), LcovError);
  assertThrows(() => parseLcov("SF:packages/x/src/a.ts\nZZ:1\nend_of_record", ROOT, SNAPSHOT), LcovError);
  assertThrows(() => parseLcov("end_of_record", ROOT, SNAPSHOT), LcovError);
  assertThrows(() => parseLcov("DA:1,1", ROOT, SNAPSHOT), LcovError);
  assertThrows(
    () => parseLcov(`SF:packages/x/src/a.ts\nDA:${"9".repeat(MAX_LCOV_RECORD_BYTES)},1\nend_of_record`, ROOT, SNAPSHOT),
    LcovError,
  );
});

/** One record body inside a valid SF block for the snapshot file. */
function recordIn(body: string): string {
  return `SF:packages/x/src/a.ts\n${body}\nend_of_record`;
}

Deno.test("lcov-missing-fields: missing hits, malformed function records and nonfinite counts are rejected", () => {
  const malformed = [
    "DA:1,",
    "DA:1",
    "DA:1,1.5",
    "DA:1, 2",
    "DA:1,1e3",
    "DA:1,0x10",
    "DA:1,1,",
    "DA:1.5,1",
    "FN:garbage",
    "FN:3",
    "FN:0,name",
    "FN:3,",
    "FNDA:garbage",
    "FNDA:2",
    "FNDA:x,name",
    "FNDA:2,",
    "FNF:",
    "FNH:1.5",
    "LF: ",
    "LH:1e3",
    "BRF:-1",
    "BRDA:garbage",
    "BRDA:1,0,0",
    "BRDA:1,0,0,x",
    "constructor:1",
  ];
  for (const body of malformed) {
    assertThrows(() => parseLcov(recordIn(body), ROOT, SNAPSHOT), LcovError, "", body);
  }
  const huge = `1${"0".repeat(308)}`;
  assertThrows(() => parseLcov(recordIn(`DA:1,${huge}\nDA:1,${huge}`), ROOT, SNAPSHOT), LcovError, "finite");
  const valid = [
    "DA:1,0",
    "DA:1,7,abc123",
    "FN:3,name",
    "FN:3,5,name",
    "FN:3,a,b",
    "FNDA:0,name",
    "FNF:0",
    "BRDA:1,0,0,-",
    "BRDA:1,0,0,4",
  ];
  for (const body of valid) {
    parseLcov(recordIn(body), ROOT, SNAPSHOT);
  }
});

Deno.test("lcov-ownership-and-errors: a manifest is accepted when it matches the measured bytes", async () => {
  const relative = "packages/x/src/a.ts";
  const dir = await Deno.makeTempDir();
  try {
    const absolute = join(dir, "a.ts");
    await Deno.writeTextFile(absolute, "export function a(): number {\n  return 1;\n}\n");
    const file = await parseHealthFile(absolute, relative);
    const parsed = new Map([[relative, file]]);
    assertCoverageManifest({ [relative]: file.sha256 }, parsed);
    assert(file.sha256.length === 64);
    assertThrows(
      () => assertCoverageManifest({ [relative]: "b".repeat(64) }, parsed),
      Error,
      "disagrees",
    );
    assertThrows(() => assertCoverageManifest({ "packages/x/src/missing.ts": "b".repeat(64) }, parsed), Error);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("coverage-manifest-population: empty, partial, unknown and changed-source maps cannot certify covered files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const sources = { "packages/x/src/a.ts": "export const a = 1;\n", "packages/x/src/b.ts": "export const b = 2;\n" };
    const parsed = new Map<string, Awaited<ReturnType<typeof parseHealthFile>>>();
    for (const [path, text] of Object.entries(sources)) {
      await Deno.writeTextFile(join(dir, "f.ts"), text);
      parsed.set(path, await parseHealthFile(join(dir, "f.ts"), path));
    }
    const hashOf = (path: string): string => parsed.get(path)?.sha256 ?? "";
    const lcov = (paths: readonly string[]) =>
      parseLcov(paths.map((path) => `SF:${path}\nDA:1,1\nend_of_record`).join("\n"), ROOT, new Set(parsed.keys()));
    const both = lcov(Object.keys(sources));
    const complete = {
      "packages/x/src/a.ts": hashOf("packages/x/src/a.ts"),
      "packages/x/src/b.ts": hashOf("packages/x/src/b.ts"),
    };

    assertEquals(coverageRevisionOf(complete, both, parsed), "verified");
    assertEquals(coverageRevisionOf(null, both, parsed), "unverified");
    assertEquals(coverageRevisionOf({}, both, parsed), "unverified");
    assertEquals(
      coverageRevisionOf({ "packages/x/src/a.ts": complete["packages/x/src/a.ts"] }, both, parsed),
      "unverified",
    );
    assertEquals(coverageRevisionOf(complete, lcov([]), parsed), "unverified");
    assertEquals(coverageRevisionOf(complete, null, parsed), "unverified");

    assertThrows(
      () => assertCoverageManifest({ ...complete, "packages/x/src/unknown.ts": "a".repeat(64) }, parsed),
      Error,
    );
    assertThrows(
      () => assertCoverageManifest({ ...complete, "packages/x/src/a.ts": "b".repeat(64) }, parsed),
      Error,
      "disagrees",
    );
    assertThrows(
      () => assertCoverageManifest({ ...complete, "packages/x/src/a.ts": "not-a-hash" }, parsed),
      Error,
      "SHA-256",
    );
    assertThrows(
      () =>
        assertCoverageManifest(
          { ...complete, "packages/x/src/a.ts": complete["packages/x/src/a.ts"].toUpperCase() },
          parsed,
        ),
      Error,
      "SHA-256",
    );
    assertCoverageManifest(complete, parsed);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("health-input-stream-bounds: oversized and endless inputs reject during the bounded read", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const sized = join(dir, "sized.bin");
    await Deno.writeFile(sized, new Uint8Array(2048));
    assertEquals((await readFileBounded(sized, 2048)).byteLength, 2048);
    await assertRejects(() => readFileBounded(sized, 2047), BoundedReadError, "2047");
    await assertRejects(() => readFileBounded("/dev/zero", 1024 * 1024), BoundedReadError);
    await assertRejects(() => parseHealthFile("/dev/zero", "endless.ts"), Error, "source bound");

    const record = `SF:packages/x/src/a.ts\n${"DA:1,".repeat(MAX_LCOV_RECORD_BYTES / 4)}`;
    assertThrows(() => parseLcov(record, ROOT, SNAPSHOT), LcovError, "byte bound");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
