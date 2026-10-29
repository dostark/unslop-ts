/**
 * @module HealthCliTest
 * @path tests/health_cli_test.ts
 * @description End-to-end checks of the health command: findings, profile, flags, options and exits.
 * @architectural-layer Test
 * @related-files [src/cli/commands/health.ts, src/report/health.ts, src/report/health_model.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { HealthReportSchema, type IHealthReport } from "../src/report/mod.ts";
import { enginePins, runDeno } from "./helpers/demo_project.ts";

const SCRIPT = new URL("../src/cli/unslop.ts", import.meta.url).href;
const ENGINE = new URL("../mod.ts", import.meta.url).href;

const MIXED = "export function wide(value: number | null): number {\n" +
  "  const first = value ?? 0;\n" +
  "  const second = value ?? 1;\n" +
  "  const third = value ?? 2;\n" +
  "  return first + second + third;\n" +
  "}\n\n" +
  "export function deep(a: boolean, b: boolean): number {\n" +
  "  if (a) {\n" +
  "    if (b) {\n" +
  "      return 1;\n" +
  "    }\n" +
  "  }\n" +
  "  return 0;\n" +
  "}\n\n" +
  "export function small(): number {\n  return 1;\n}\n";

const DESCRIPTOR = `import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("./", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {},
};
`;

/** A version 2 configuration that pins non-default maxima and keeps every gate scope outside the fixture paths. */
function catalog(): Record<string, unknown> {
  return {
    version: 2,
    plugin: "demo",
    extends: [],
    docsBase: "docs/",
    paths: { test: ["**/*_test.ts"], fixture: ["**/tests/fixtures/**"], ignore: [] },
    rules: {
      "demo/max-cyclomatic-complexity": { level: "error", options: { max: 1, variant: "classic" } },
      "demo/max-cognitive-complexity": { level: "error", options: { max: 1, countNullish: false } },
      "demo/max-function-lines": { level: "error", options: { max: 2 } },
    },
  };
}

/** Writes a health project to a temp dir and runs `body` in it. */
async function withHealthProject<T>(
  files: Readonly<Record<string, string>>,
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_health_" });
  try {
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({ imports: { "@dostark/unslop-ts": ENGINE, ...(await enginePins()) } }),
    );
    await Deno.writeTextFile(join(dir, "unslop.project.ts"), DESCRIPTOR);
    await Deno.writeTextFile(join(dir, "unslop.config.json"), JSON.stringify(catalog(), null, 2));
    await Deno.writeTextFile(join(dir, "plugin.ts"), "export {};\n");
    for (const [path, source] of Object.entries(files)) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), source);
    }
    return await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs the real health command in a project and returns its output. */
async function health(dir: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runDeno(["run", "-A", SCRIPT, "health", `--descriptor=unslop.project.ts`, ...args], dir);
}

/** Reads one JSON report and asserts it against the published schema. */
function parseReport(stdout: string): IHealthReport {
  const report = JSON.parse(stdout) as IHealthReport;
  const parsed = HealthReportSchema.safeParse(report);
  assertEquals(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  return report;
}

const MAIN_FILES: Readonly<Record<string, string>> = {
  "packages/x/src/mixed.ts": MIXED,
  "packages/x/src/types.d.ts": "export declare const declared: number;\n",
  "packages/x/tests/fixtures/sample.ts": "export function sample(): number {\n  return 1;\n}\n",
};

Deno.test("health-findings-shape: named fields, worst severity and the full aggregate population", async () => {
  await withHealthProject(MAIN_FILES, async (dir) => {
    const result = await health(dir, ["--format=json", "--top=1"]);
    assertEquals(result.code, 0, result.stderr);
    const report = parseReport(result.stdout);
    assertEquals(report.schema_version, 1);
    assertEquals(report.formula_version, "unslop-health-v1");
    assertEquals(report.summary.analyzed_files, 3);
    assertEquals(report.summary.excluded_files, 2);
    assertEquals(report.summary.functions, 3);
    assertEquals(report.summary.findings_population, 3);
    assertEquals(report.findings.length, 1);
    assertEquals(report.findings[0].name, "deep");
    assertEquals(report.findings[0].path, "packages/x/src/mixed.ts");
    assertEquals(report.findings[0].severity, "critical");
    assertEquals(report.findings[0].col, 7);
    assertEquals(report.findings[0].line, 8);
    assertEquals(report.findings[0].line_count, 8);
    assertEquals(report.findings[0].param_count, 2);
    assertEquals(report.findings[0].contributions.length > 0, true);
    assertEquals(report.limits.source_bytes, 16 * 1024 * 1024);
  });
});

Deno.test("health-unit-size-profile: four bands sum to one hundred or stay zero", async () => {
  await withHealthProject(MAIN_FILES, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json"])).stdout);
    const profile = report.vital_signs.unit_size;
    assertEquals(profile.total, 3);
    assertEquals(profile.bands.low.count, 3);
    assertEquals(profile.bands.medium.count, 0);
    assertEquals(profile.bands.high.count, 0);
    assertEquals(profile.bands.very_high.count, 0);
    assertEquals(profile.bands.low.percent.toFixed(1), "100.0");
    const sum = profile.bands.low.percent + profile.bands.medium.percent + profile.bands.high.percent +
      profile.bands.very_high.percent;
    assertEquals(Math.round(sum * 1000) / 1000, 100);
  });
  await withHealthProject({ "packages/x/src/types.d.ts": "export declare const a: number;\n" }, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(report.vital_signs.unit_size.total, 0);
    for (const band of Object.values(report.vital_signs.unit_size.bands)) assertEquals(band, { count: 0, percent: 0 });
  });
});

Deno.test("health-cli-exit-codes: success, usage failures and source parse failures", async () => {
  await withHealthProject(MAIN_FILES, async (dir) => {
    assertEquals((await health(dir, [])).code, 0);
    assertEquals((await health(dir, ["--nope=1"])).code, 2);
    assertEquals((await health(dir, ["--format=json", "--format=json"])).code, 2);
    assertEquals((await health(dir, ["--max-lines=abc"])).code, 2);
    assertEquals((await health(dir, ["--format=xml"])).code, 2);
    assertEquals((await health(dir, ["--sort=unknown"])).code, 2);
    assertEquals((await health(dir, ["--variant=other"])).code, 2);
    assertEquals((await health(dir, ["--root=elsewhere"])).code, 2);
    const correctRoot = await health(dir, ["--root=.", "--format=json"]);
    assertEquals(correctRoot.code, 0, correctRoot.stderr);
  });
  await withHealthProject({ "packages/x/src/broken.ts": "export function broken( {\n" }, async (dir) => {
    const result = await health(dir, ["--format=json"]);
    assertEquals(result.code, 1);
    const report = parseReport(result.stdout);
    assertEquals(report.summary.failed_files, 1);
    assertEquals(report.errors[0].path, "packages/x/src/broken.ts");
    assertStringIncludes(report.errors[0].message, "Metrics cannot parse");
  });
});

Deno.test("health-config-resolution: the real descriptor supplies options and a CLI override wins", async () => {
  await withHealthProject(MAIN_FILES, async (dir) => {
    const configured = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(configured.summary.options, {
      max_cyclomatic: 1,
      max_cognitive: 1,
      max_lines: 2,
      max_crap: 30,
      variant: "classic",
      count_nullish: false,
    });
    const wide = configured.findings.find((finding) => finding.name === "wide");
    assertEquals(wide?.cyclomatic, 1);
    assertEquals(wide?.cognitive, 0);
    assertEquals(wide?.severity, "high");

    const overridden = parseReport(
      (await health(dir, ["--format=json", "--variant=extended", "--count-nullish=true"])).stdout,
    );
    assertEquals(overridden.summary.options.variant, "extended");
    assertEquals(overridden.summary.options.count_nullish, true);
    const extended = overridden.findings.find((finding) => finding.name === "wide");
    assertEquals(extended?.cyclomatic, 4);
    assertEquals(extended?.cognitive, 3);
    assertEquals(extended?.severity, "critical");
  });
});

const GRAPH_FILES: Readonly<Record<string, string>> = {
  "packages/x/src/a.ts":
    'import "./side.ts";\nimport type { Shape } from "./types.ts";\nexport const local = 1;\nexport function use(value: number): number { return value; }\n',
  "packages/x/src/side.ts": "export const side = 1;\n",
  "packages/x/src/types.ts":
    "export type Shape = { a: number };\nexport function build(): Shape { return { a: 1 }; }\n",
  "packages/x/src/unresolved.ts": 'import { x } from "./missing.ts";\nexport const y = x;\n',
};

Deno.test("health-graph-cli: the real command emits file scores and graph limitations", async () => {
  await withHealthProject(GRAPH_FILES, async (dir) => {
    const result = await health(dir, ["--format=json"]);
    assertEquals(result.code, 0, result.stderr);
    const report = parseReport(result.stdout);
    assertEquals(report.summary.graph.unresolved_specifiers, 1);
    assertEquals(report.summary.graph.complete, false);
    assertEquals(report.summary.graph.internal_edges >= 2, true);
    assertEquals(report.summary.graph.runtime_edges <= report.summary.graph.internal_edges, true);
    assertEquals(report.file_scores.length, report.summary.file_scores_population);
    assertEquals(report.summary.dead_files.population, report.summary.analyzed_files);
    assertEquals(typeof report.summary.dead_files.available, "boolean");
    assertEquals(report.summary.dead_exports.total >= 3, true);
    const a = report.file_scores.find((score) => score.path === "packages/x/src/a.ts");
    assertEquals(a?.fan_out, 2);
    assertEquals(a?.fan_in, 0);
    assertEquals(a !== undefined && a.mi >= 0 && a.mi <= 100, true);
    assertEquals(a !== undefined && a.lines > 0, true);
    const side = report.file_scores.find((score) => score.path === "packages/x/src/side.ts");
    assertEquals(side?.fan_in, 1);
    const sorted = report.file_scores.map((score) => score.path);
    assertEquals(sorted, [...sorted].sort((left, right) => left.localeCompare(right)));
  });
});

Deno.test("health-real-lcov: real Deno coverage changes the CRAP value and the source label", async () => {
  const files: Readonly<Record<string, string>> = {
    "packages/x/src/math.ts": "export function both(flag: boolean): number {\n" +
      "  if (flag) {\n" +
      "    return 1;\n" +
      "  }\n" +
      "  return 2;\n" +
      "}\n",
    "packages/x/tests/math_test.ts": 'import { both } from "../src/math.ts";\n\n' +
      'Deno.test("both", () => {\n' +
      '  if (both(true) !== 1) throw new Error("bad true");\n' +
      '  if (both(false) !== 2) throw new Error("bad false");\n' +
      "});\n",
  };
  await withHealthProject(files, async (dir) => {
    // A dedicated DENO_DIR keeps the transpiled sources that `deno coverage` needs to map lines.
    const cache = await Deno.makeTempDir({ prefix: "unslop_coverage_cache_" });
    try {
      const coverageDir = join(dir, "coverage-data");
      const test = await runDeno(
        ["test", "--allow-all", `--coverage=${coverageDir}`, "packages/x/tests/math_test.ts"],
        dir,
        { DENO_DIR: cache },
      );
      assertEquals(test.code, 0, test.stderr);
      const lcov = join(dir, "coverage.lcov");
      const convert = await runDeno(["coverage", coverageDir, "--lcov", `--output=${lcov}`], dir, {
        DENO_DIR: cache,
      });
      assertEquals(convert.code, 0, convert.stderr);

      const without = parseReport((await health(dir, ["--format=json"])).stdout);
      const measured = parseReport((await health(dir, ["--format=json", "--coverage=coverage.lcov"])).stdout);
      const before = without.findings.find((finding) => finding.name === "both");
      const after = measured.findings.find((finding) => finding.name === "both");
      assert(before !== undefined && after !== undefined);
      assertEquals(after.coverage_source, "lcov");
      assertEquals(after.coverage_reason, "measured");
      assertEquals(after.coverage_precision, "line");
      assertEquals(after.crap < before.crap, true);
      assertEquals(without.findings[0].coverage_source, "estimated");
      assertEquals(measured.summary.coverage.source, "lcov");
      assertEquals(measured.summary.coverage.revision, "unverified");
      assert(measured.summary.coverage.file_sha256 !== null);
      assertEquals(measured.summary.coverage.matched_files > 0, true);
    } finally {
      await Deno.remove(cache, { recursive: true });
    }
  });
});
