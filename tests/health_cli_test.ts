/**
 * @module HealthCliTest
 * @path tests/health_cli_test.ts
 * @description End-to-end checks of the health command: findings, profile, flags, options and exits.
 * @architectural-layer Test
 * @related-files [src/cli/commands/health.ts, src/report/health.ts, src/report/health_model.ts]
 */

import { fixtureGit as gitIn } from "./helpers/git_fixture.ts";
import { assert, assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { crapOf, DIRECT_COVERAGE_PERCENT } from "../src/report/crap.ts";
import { HealthReportSchema, type IHealthReport } from "../src/report/mod.ts";
import { enginePins, runDeno } from "./helpers/demo_project.ts";
import { GOD, godClassSource } from "./helpers/god_class_fixture.ts";

const SCRIPT = new URL("../src/cli/unslop.ts", import.meta.url).href;
const ENGINE = new URL("../mod.ts", import.meta.url).href;

Deno.test("health-private-cohesion: a high-WMC private-field class retains cohesion and stays below God Class detection", async () => {
  const source = godClassSource({ ...GOD, cohesion: "shared" })
    .replace("private shared", "#shared").replaceAll("this.shared", "this.#shared");
  const other = `class Other { ${
    Array.from({ length: GOD.foreignReads }, (_, index) => `field${index} = 0;`).join(" ")
  } }`;
  await withHealthProject({ "packages/x/src/counter.ts": `${other}\n${source}` }, async (dir) => {
    const result = await health(dir, ["--format=json"]);
    assertEquals(result.code, 0, result.stderr);
    const report = parseReport(result.stdout);
    const counter = report.class_scores.find((entry) => entry.name === "Hub")!;
    assertEquals([counter.wmc, counter.noa, counter.tcc, counter.lcom4, counter.atfd], [50, 1, 1, 1, 6]);
    assertEquals(report.design_findings.filter((entry) => entry.strategy === "god-class"), []);
  });
});

Deno.test("health-class-population-coverage: the CLI reports named lexical classes and unavailable anonymous analysis", async () => {
  const source =
    "export function make() { class Local { run() {} } const Made = class Named { run() {} }; return class {}; }";
  await withHealthProject({ "packages/x/src/local.ts": source }, async (dir) => {
    const result = await health(dir, ["--classes", "--format=json"]);
    assertEquals(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout) as IHealthReport;
    assertEquals(report.class_scores.filter((entry) => entry.precision === "typed").map((entry) => entry.name).sort(), [
      "Local",
      "Named",
    ]);
    assert("class_analysis" in report);
    assertEquals(report.class_analysis, {
      total: 3,
      typed: 2,
      unjoined: [{
        path: "packages/x/src/local.ts",
        name: "(anonymous)",
        nameOffset: source.indexOf("class {}"),
        reportedBy: "babel",
      }],
    });
    assertStringIncludes((await health(dir, ["--classes"])).stdout, "method analysis unavailable for 1 class(es)");
  });
});

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

const DESCRIPTOR = `import {
  type IProjectDescriptor,
  TYPESCRIPT_RULE_PACK,
  WHOLE_TREE_CHECKS,
} from "@dostark/unslop-ts";

const rootUrl = new URL("./", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {
    "duplicate-code": {
      controls: WHOLE_TREE_CHECKS["duplicate-code"].controls,
      command: ["deno", "task", "duplicate-code"],
    },
  },
};
`;

/** A version 2 configuration that pins non-default maxima and keeps every gate scope outside the fixture paths. */
function catalog(extraRules: Record<string, unknown> = {}): Record<string, unknown> {
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
      ...extraRules,
    },
  };
}

/** Writes a health project to a temp dir and runs `body` in it. */
async function withHealthProject<T>(
  files: Readonly<Record<string, string>>,
  body: (dir: string) => Promise<T>,
  extraRules: Record<string, unknown> = {},
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_health_" });
  try {
    const extra = JSON.parse(files["deno.json"] ?? "{}") as { imports?: Record<string, string> };
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({
        ...extra,
        imports: { "@dostark/unslop-ts": ENGINE, ...(await enginePins()), ...extra.imports },
      }),
    );
    await Deno.writeTextFile(join(dir, "unslop.project.ts"), DESCRIPTOR);
    await Deno.writeTextFile(join(dir, "unslop.config.json"), JSON.stringify(catalog(extraRules), null, 2));
    await Deno.writeTextFile(join(dir, "plugin.ts"), "export {};\n");
    for (const [path, source] of Object.entries(files)) {
      if (path === "deno.json") continue;
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
    assertEquals(report.schema_version, 2);
    assertEquals(report.formula_version, "unslop-health-v2");
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

Deno.test("health-parameter-optional-ownership: health reports the body-only cyclomatic value", async () => {
  const source = "export function withDefault(x = value?.field): number {\n  return x?.y ? 1 : 0;\n}\n";
  await withHealthProject({ "packages/x/src/default.ts": source }, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json", "--variant=extended"])).stdout);
    assertEquals(report.findings.find((finding) => finding.name === "withDefault")?.cyclomatic, 3);
  });
});

Deno.test("fix(health-module): top-level decisions contribute once to the file score", async () => {
  const source = "const x = true;\nif (x) { console.log(x); }\n" +
    "export function nested(): number { if (x) return 1; return 0; }\n";
  await withHealthProject({ "packages/x/src/module.ts": source }, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json"])).stdout);
    const score = report.file_scores.find((entry) => entry.path === "packages/x/src/module.ts");
    assertEquals(score?.module_cyclomatic, 2);
    assertEquals(score?.cyclomatic, 4);
    assertEquals(report.summary.functions, 1);
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

Deno.test("fix(health-graph): excluded source and JSON imports do not disable graph scores", async () => {
  await withHealthProject({
    "packages/x/src/main.ts": 'import data from "./config.json" with { type: "json" };\n' +
      'import { value } from "../tests/fixtures/helper.ts";\n' +
      "export const result = value + data.value;\n",
    "packages/x/src/config.json": '{"value": 1}\n',
    "packages/x/tests/fixtures/helper.ts": "export const value = 2;\n",
  }, async (dir) => {
    const result = await health(dir, ["--format=json"]);
    assertEquals(result.code, 0, result.stderr);
    const report = parseReport(result.stdout);
    assertEquals(report.summary.graph.unresolved_specifiers, 0);
    assertEquals(report.summary.graph.excluded_source_specifiers, 1);
    assertEquals(report.summary.graph.resource_specifiers, 1);
    assertEquals(report.summary.graph.external_specifiers, 1);
    assertEquals(report.summary.graph.complete, true);
    assertEquals(report.health_score.signals.find((signal) => signal.signal === "cycles")?.status, "measured");
    assertEquals(report.health_score.signals.find((signal) => signal.signal === "coupling")?.status, "measured");
  });
});

Deno.test("fix(health-graph): a missing JSON import still makes the graph incomplete", async () => {
  await withHealthProject({
    "packages/x/src/main.ts": 'import data from "./missing.json" with { type: "json" };\nexport const value = data;\n',
  }, async (dir) => {
    const result = await health(dir, ["--format=json"]);
    assertEquals(result.code, 0, result.stderr);
    const report = parseReport(result.stdout);
    assertEquals(report.summary.graph.unresolved_specifiers, 1);
    assertEquals(report.summary.graph.complete, false);
  });
});

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

/** Runs Git inside one fixture with an isolated configuration. */

Deno.test("health-hotspot-cli: the real --since and --min-commits flags change CLI hotspots", async () => {
  await withHealthProject(MAIN_FILES, async (dir) => {
    const plain = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(plain.hotspot_summary.available, false);
    assertEquals(plain.hotspot_summary.reason, "not-a-git-repository");
    assertEquals(plain.hotspots, []);

    await gitIn(dir, ["init", "-b", "main"]);
    await gitIn(dir, ["add", "-A"]);
    await gitIn(dir, ["commit", "-m", "first"]);
    const wide = parseReport((await health(dir, ["--format=json", "--since=365d", "--min-commits=1"])).stdout);
    assertEquals(wide.hotspot_summary.available, true);
    assertEquals(wide.hotspot_summary.shallow, false);
    assertEquals(wide.hotspot_summary.qualified > 0, true);
    assertEquals(wide.hotspots[0].score, 100);

    const strict = parseReport((await health(dir, ["--format=json", "--since=365d", "--min-commits=2"])).stdout);
    assertEquals(strict.hotspots, []);
    assertEquals(strict.hotspot_summary.qualified, 0);
    assertEquals(strict.hotspot_summary.min_commits, 2);

    const narrow = parseReport((await health(dir, ["--format=json", "--since=30d", "--min-commits=1"])).stdout);
    assertEquals(narrow.hotspot_summary.since > wide.hotspot_summary.since, true);
  });
});

Deno.test("health-alias-coverage-cycle: alias imports give runtime reach, an exact cycle and a complete graph", async () => {
  const files: Readonly<Record<string, string>> = {
    "deno.json": JSON.stringify({ imports: { "@a": "./packages/x/src/a.ts", "@b": "./packages/x/src/b.ts" } }),
    "packages/x/src/a.ts": 'import { b } from "@b";\n\nexport function a(flag: boolean): number {\n' +
      "  if (flag) return b();\n  return 0;\n}\n",
    "packages/x/src/b.ts": 'import { a } from "@a";\n\nexport function b(): number {\n  return a(false);\n}\n',
    "packages/x/src/a_test.ts": 'import { a } from "@a";\n\nexport const result = a(true);\n',
  };
  await withHealthProject(files, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(report.summary.graph.complete, true);
    assertEquals(report.summary.graph.unresolved_specifiers, 0);
    assertEquals(report.summary.graph.internal_edges, 3);
    assertEquals(report.vital_signs.cycles.sccs, 1);
    assertEquals(report.vital_signs.cycles.files, 2);
    const direct = report.findings.find((finding) => finding.name === "a");
    assert(direct !== undefined);
    assertEquals(direct.cyclomatic, 2);
    assertEquals(direct.crap, crapOf(direct.cyclomatic, DIRECT_COVERAGE_PERCENT));
  });
});

Deno.test("health-malformed-lcov-cli: malformed coverage cannot produce a successful measured report", async () => {
  const path = "packages/x/src/mixed.ts";
  const bodies = ["DA:1,", "FN:garbage", "FNDA:garbage", "DA:1,1\nend_of_record\nend_of_record"];
  for (const body of bodies) {
    await withHealthProject({ ...MAIN_FILES, "coverage.lcov": `SF:${path}\n${body}\nend_of_record\n` }, async (dir) => {
      const result = await health(dir, ["--format=json", "--coverage=coverage.lcov"]);
      assertEquals(result.code, 1, body);
      assertStringIncludes(result.stderr, "health input rejected");
    });
  }
});

Deno.test("health-freshness-cli: only a complete matching manifest emits revision verified", async () => {
  const sources: Readonly<Record<string, string>> = {
    "packages/x/src/a.ts": "export function a(): number {\n  return 1;\n}\n",
    "packages/x/src/b.ts": "export function b(): number {\n  return 2;\n}\n",
  };
  const hashOf = async (text: string): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const a = await hashOf(sources["packages/x/src/a.ts"]);
  const b = await hashOf(sources["packages/x/src/b.ts"]);
  const lcov = Object.keys(sources).map((path) => `SF:${path}\nDA:1,1\nend_of_record\n`).join("");
  const cases: readonly {
    readonly files: Record<string, string>;
    readonly code: number;
    readonly revision?: string;
  }[] = [
    { files: { "packages/x/src/a.ts": a, "packages/x/src/b.ts": b }, code: 0, revision: "verified" },
    { files: {}, code: 0, revision: "unverified" },
    { files: { "packages/x/src/a.ts": a }, code: 0, revision: "unverified" },
    { files: { "packages/x/src/a.ts": a, "packages/x/src/b.ts": "0".repeat(64) }, code: 1 },
    { files: { "packages/x/src/a.ts": a, "packages/x/src/b.ts": b, "packages/x/src/gone.ts": a }, code: 1 },
    { files: { "packages/x/src/a.ts": "nothex", "packages/x/src/b.ts": b }, code: 1 },
  ];
  for (const entry of cases) {
    await withHealthProject({
      ...sources,
      "coverage.lcov": lcov,
      "coverage.lcov.manifest.json": JSON.stringify({ files: entry.files }),
    }, async (dir) => {
      const result = await health(dir, ["--format=json", "--coverage=coverage.lcov"]);
      assertEquals(result.code, entry.code, `${JSON.stringify(entry.files)} ${result.stderr}`);
      if (entry.revision !== undefined) {
        assertEquals(parseReport(result.stdout).summary.coverage.revision, entry.revision, JSON.stringify(entry.files));
      }
    });
  }
});

Deno.test("health-cli-strict-values: malformed values are usage errors and boundary values round-trip", async () => {
  const unsafe = "9007199254740993";
  const overflow = "9".repeat(400);
  const rejected = [
    "--count-nullish=tru",
    "--count-nullish=TRUE",
    "--count-nullish=1",
    `--max-cyclomatic=${overflow}`,
    `--max-cognitive=${unsafe}`,
    `--max-lines=${unsafe}`,
    `--top=${overflow}`,
    `--min-commits=${unsafe}`,
    "--max-cyclomatic=0",
    "--max-crap=Infinity",
    `--max-crap=1${"0".repeat(400)}`,
    "--max-crap=1e400",
    "--min-score=NaN",
    "--min-score=101",
    `--since=${overflow}d`,
    `--since=${unsafe}m`,
    "--since=0d",
    "--since=notadate",
    "--since=1",
    "--since=2026-13-45",
  ];
  await withHealthProject(MAIN_FILES, async (dir) => {
    for (const flag of rejected) {
      const result = await health(dir, ["--format=json", flag]);
      assertEquals(result.code, 2, `${flag}: ${result.stderr}`);
      assertEquals(result.stdout, "", flag);
    }
    const accepted = await health(dir, [
      "--format=json",
      "--count-nullish=false",
      "--max-cyclomatic=9007199254740991",
      "--max-cognitive=1",
      "--max-lines=1",
      "--max-crap=0.5",
      "--since=2026-01-01",
      "--min-commits=9007199254740991",
    ]);
    assertEquals(accepted.code, 0, accepted.stderr);
    const report = parseReport(accepted.stdout);
    assertEquals(report.summary.options.max_cyclomatic, Number.MAX_SAFE_INTEGER);
    assertEquals(report.summary.options.count_nullish, false);
    assertEquals(report.summary.options.max_crap, 0.5);
  });
});

Deno.test("health-cycle-cli: the command exposes the exact cycle and coupling populations", async () => {
  const files: Readonly<Record<string, string>> = {
    "packages/x/src/a.ts": 'import type { IThing } from "./types.ts";\n' +
      'import { b } from "./b.ts";\n\n' +
      "export function a(thing: IThing): number {\n  return b() + thing.value;\n}\n",
    "packages/x/src/b.ts": 'import { a } from "./a.ts";\n\n' +
      "export function b(): number {\n  return 1;\n}\n",
    "packages/x/src/types.ts": "export interface IThing {\n  value: number;\n}\n",
  };
  await withHealthProject(files, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(report.vital_signs.cycles.sccs, 1);
    assertEquals(report.vital_signs.cycles.files, 2);
    assertEquals(report.vital_signs.cycles.code_files, 5);
    assertEquals(report.vital_signs.cycles.per_thousand, (1 / 5) * 1000);
    assertEquals(report.vital_signs.coupling.high_files, 0);
    assertEquals(report.vital_signs.coupling.code_files, 5);
    assertEquals(report.vital_signs.coupling.percent, 0);
    assertEquals(report.vital_signs.coupling.fan_in_limit, 20);
    assertEquals(report.vital_signs.coupling.fan_out_limit, 15);
    assertEquals(report.summary.graph.runtime_edges, 2);
  });
});

/** The fake local jscpd package with a zero-duplication report. */
const FAKE_JSCPD: Readonly<Record<string, string>> = {
  "node_modules/jscpd/package.json": JSON.stringify({ name: "jscpd", version: "5.4.2", bin: "bin/jscpd.js" }),
  "node_modules/jscpd/bin/jscpd.js": 'const fs = require("node:fs");\n' +
    'const out = process.argv[process.argv.indexOf("--output") + 1];\n' +
    'fs.writeFileSync(out + "/jscpd-report.json", JSON.stringify({ statistics: { total: ' +
    "{ percentage: 0, duplicatedLines: 0, sources: 1, lines: 30 } }, duplicates: [] }));\n",
};

/** The duplicate-code rule options that make the fixture run the local fake runner. */
const DUPLICATE_RULE: Record<string, unknown> = {
  "duplicate-code": {
    level: "error",
    options: {
      jscpdVersion: "5.4.2",
      minLines: 5,
      minTokens: 50,
      maxGapLines: 0,
      baseline: null,
      crossGroups: false,
      groups: [{
        name: "src",
        paths: ["packages/x/src"],
        ignore: [],
        threshold: 100,
        minLines: 5,
        maxGapLines: 0,
        pattern: null,
      }],
    },
  },
};

Deno.test("fix(health-text): the report groups evidence and prints measured duplication", async () => {
  await withHealthProject({ ...MAIN_FILES, ...FAKE_JSCPD }, async (dir) => {
    const result = await health(dir, ["--format=text", "--top=1"]);
    assertEquals(result.code, 0, result.stderr);
    const output = result.stdout;
    const sections = ["UNSLOP HEALTH", "OVERVIEW", "SCORE SIGNALS", "HOTSPOTS", "FINDINGS", "LIMITATIONS"];
    let previous = -1;
    for (const section of sections) {
      const current = output.indexOf(section);
      assert(current > previous, `${section} is missing or out of order`);
      previous = current;
    }
    assertStringIncludes(output, "Duplication");
    assertStringIncludes(output, "0.0%");
    assertStringIncludes(output, "grade withheld");
    assertStringIncludes(output, "Variant");
    assertStringIncludes(output, "external");
    assertStringIncludes(output, "dynamic");
    assertStringIncludes(output, "File scores");
    assertStringIncludes(output, "advisory");
    assertStringIncludes(output, "9 supported score signals");
    assertStringIncludes(output, "complete within scan scope");
  }, DUPLICATE_RULE);
});

Deno.test("health-min-score-exit: the gate passes equality only on a complete score", async () => {
  const files: Readonly<Record<string, string>> = {
    "packages/x/src/a.ts": "export function a(flag: boolean): number {\n  return flag ? 1 : 2;\n}\n",
  };
  await withHealthProject({ ...files, ...FAKE_JSCPD }, async (dir) => {
    await gitIn(dir, ["init", "-b", "main"]);
    await gitIn(dir, ["add", "-A"]);
    await gitIn(dir, ["commit", "-m", "first"]);

    const raw = await health(dir, ["--format=json"]);
    assertEquals(raw.code, 0, raw.stderr);
    const complete = parseReport(raw.stdout);
    assertEquals(complete.health_score.status, "complete");
    const value = complete.health_score.value;
    const failed = complete.health_score.signals.filter((signal) => signal.status === "unavailable");
    assertEquals(failed.map((signal) => `${signal.signal}:${signal.reason}`), []);

    const equal = await health(dir, ["--min-score=" + String(value)]);
    assertEquals(equal.code, 0, equal.stderr);
    const above = await health(dir, ["--min-score=" + String(value - 1)]);
    assertEquals(above.code, 0, above.stderr);
    const below = await health(dir, ["--min-score=" + String(Math.min(value + 1, 100))]);
    assertEquals(below.code, 1);
    const invalid = await health(dir, ["--min-score=101"]);
    assertEquals(invalid.code, 2);
  }, DUPLICATE_RULE);
});

Deno.test("health-min-score-exit: a partial score never passes a gate", async () => {
  await withHealthProject(MAIN_FILES, async (dir) => {
    const partial = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(partial.health_score.status, "partial");
    assertEquals(partial.health_score.grade, null);
    const gated = await health(dir, ["--min-score=0"]);
    assertEquals(gated.code, 1);
    assertStringIncludes(gated.stdout, "gate: minimum score 0");
    const negative = await health(dir, ["--min-score=-1"]);
    assertEquals(negative.code, 2);
    const text = await health(dir, []);
    assertStringIncludes(text.stdout, "partial");
  });
});

Deno.test("the_readme_documents_every_health_flag", async () => {
  const readme = await Deno.readTextFile(new URL("../README.md", import.meta.url));
  const start = readme.indexOf("## Health report");
  assert(start >= 0);
  const section = readme.slice(start, readme.indexOf("## Editing", start));
  for (
    const flag of [
      "--root",
      "--descriptor",
      "--plugin",
      "--format",
      "--max-cyclomatic",
      "--max-cognitive",
      "--max-lines",
      "--max-crap",
      "--coverage",
      "--variant",
      "--count-nullish",
      "--top",
      "--sort",
      "--since",
      "--min-commits",
      "--min-score",
    ]
  ) {
    assertStringIncludes(section, flag);
  }
  for (
    const claim of [
      "exactly `true` or `false`",
      "`unverified`",
      "SHA-256",
      "deno.jsonc",
      "byte limits",
      "leaves the project root",
    ]
  ) {
    assertStringIncludes(section, claim);
  }
  assertStringIncludes(section, "unslop-health-v2");
  assertStringIncludes(section, "--allow-run=git,node");
  assertStringIncludes(section, "jscpd");
  assertStringIncludes(section, "./metrics");
  assertStringIncludes(section, "./report");
});

const CLASS_FILES: Readonly<Record<string, string>> = {
  "packages/x/src/shape.ts": [
    "export class Shape {",
    "  width = 1;",
    "  height = 2;",
    "  area(): number {",
    "    return this.width * this.height;",
    "  }",
    "}",
    "",
  ].join("\n"),
  "packages/x/src/user.ts": [
    'import { Shape } from "./shape.ts";',
    "export class User {",
    "  size(shape: Shape): number {",
    "    return shape.area();",
    "  }",
    "}",
    "",
  ].join("\n"),
};

Deno.test("health-class-scores: a fixture repository gives one entry per class with typed values and the thresholds", async () => {
  await withHealthProject(CLASS_FILES, async (dir) => {
    const result = await health(dir, ["--format=json"]);
    assertEquals(result.code, 0, result.stderr);
    const report = parseReport(result.stdout);
    assertEquals(report.class_scores.map((entry) => entry.name), ["Shape", "User"]);
    const shape = report.class_scores[0];
    assertEquals([shape.path, shape.nom, shape.noap, shape.precision], ["packages/x/src/shape.ts", 1, 2, "typed"]);
    assertEquals(report.class_scores[1].rfc, 2);
    assertEquals(report.design_findings, []);
    assertEquals(report.class_thresholds.defaults.wmcVeryHigh.value, 47);
    assertEquals(report.class_thresholds.derived.population, 2);
  });
});

Deno.test("health-score-unchanged: the class section does not move the score, the version or the existing keys", async () => {
  const asFunction = { "packages/x/src/shape.ts": "export function area(): number {\n  return 1 * 2;\n}\n" };
  const asClass = { "packages/x/src/shape.ts": "export class Area {\n  area(): number {\n    return 1 * 2;\n  }\n}\n" };
  const scoreOf = async (files: Readonly<Record<string, string>>): Promise<IHealthReport> =>
    await withHealthProject(files, async (dir) => parseReport((await health(dir, ["--format=json"])).stdout));
  const plain = await scoreOf(asFunction);
  const classy = await scoreOf(asClass);
  assertEquals(plain.class_scores.length, 0);
  assertEquals(classy.class_scores.length, 1);
  assertEquals(classy.health_score, plain.health_score);
  assertEquals(classy.schema_version, plain.schema_version);
  assertEquals(classy.formula_version, "unslop-health-v2");
});

Deno.test("health-classes-flag: --classes prints only the class section and --top-classes limits its rows", async () => {
  await withHealthProject(CLASS_FILES, async (dir) => {
    const only = await health(dir, ["--classes"]);
    assertEquals(only.code, 0, only.stderr);
    assertStringIncludes(only.stdout, "CLASS DESIGN");
    assertStringIncludes(only.stdout, "unslop extension");
    assertNotMatch(only.stdout, /SCORE SIGNALS|FINDINGS/);
    const full = await health(dir, []);
    assertStringIncludes(full.stdout, "SCORE SIGNALS");
    assertStringIncludes(full.stdout, "CLASS DESIGN");
    const limited = await health(dir, ["--classes", "--top-classes=1"]);
    const rows = limited.stdout.split("\n").filter((line) => /^\s+\d+ .*packages\/x\/src\//.test(line));
    assertEquals(rows.length, 1);
  });
});

const FOUR_LINES = "export function four(a: number): number {\n  const b = a + 1;\n  return b;\n}\n";

Deno.test("health-soft-lines: softMax sets the advisory line limit below the hard limit and a flag still wins", async () => {
  const soft = { "demo/max-function-lines": { level: "error", options: { max: 100, softMax: 3 } } };
  await withHealthProject({ "packages/x/src/four.ts": FOUR_LINES }, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(report.summary.options.max_lines, 3);
    assertEquals(report.findings.filter((finding) => finding.name === "four").length, 1);
    const flagged = parseReport((await health(dir, ["--format=json", "--max-lines=50"])).stdout);
    assertEquals(flagged.summary.options.max_lines, 50);
    assertEquals(flagged.findings.filter((finding) => finding.name === "four").length, 0);
  }, soft);
});

Deno.test("health-soft-lines: without softMax the hard limit is the advisory limit", async () => {
  const hard = { "demo/max-function-lines": { level: "error", options: { max: 100 } } };
  await withHealthProject({ "packages/x/src/four.ts": FOUR_LINES }, async (dir) => {
    const report = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(report.summary.options.max_lines, 100);
  }, hard);
});

function fileOf(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => `export const v${index} = ${index};`).join("\n") + "\n";
}

Deno.test("health-large-files: files above the soft and hard limits are listed with their level", async () => {
  const rule = { "demo/max-file-lines": { level: "error", options: { max: 10, softMax: 4 } } };
  const files = {
    "packages/x/src/small.ts": fileOf(2),
    "packages/x/src/medium.ts": fileOf(6),
    "packages/x/src/large.ts": fileOf(12),
  };
  await withHealthProject(files, async (dir) => {
    const json = parseReport((await health(dir, ["--format=json"])).stdout);
    const own = json.large_files.filter((entry) => entry.path.startsWith("packages/x/"));
    assertEquals(own.map((entry) => [entry.path, entry.lines, entry.limit]), [
      ["packages/x/src/large.ts", 12, "hard"],
      ["packages/x/src/medium.ts", 6, "soft"],
    ]);
    const text = (await health(dir, [])).stdout;
    assertStringIncludes(text, "LARGE FILES");
    assertStringIncludes(text, "packages/x/src/large.ts");
  }, rule);
});

Deno.test("health-large-files: a project that does not configure the rule gets no list", async () => {
  await withHealthProject({ "packages/x/src/large.ts": fileOf(1500) }, async (dir) => {
    const json = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(json.large_files, []);
  });
});

Deno.test("health-large-files: an opt-in rule with configured options still gives the list", async () => {
  const rule = {
    "demo/max-file-lines": { level: "off", options: { max: 10, softMax: 4 }, optIn: true, reason: "Manual." },
  };
  await withHealthProject({ "packages/x/src/large.ts": fileOf(12) }, async (dir) => {
    const json = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(json.large_files.some((entry) => entry.path === "packages/x/src/large.ts"), true);
  }, rule);
});

Deno.test("health-large-files: the list follows the include globs and the scope of the rule", async () => {
  const rule = {
    "demo/max-file-lines": {
      level: "off",
      options: { max: 10, softMax: 4 },
      optIn: true,
      reason: "Manual.",
      scope: "prod",
      include: ["packages/x/src/**"],
    },
  };
  const files = {
    "packages/x/src/large.ts": fileOf(12),
    "packages/x/tests/big_test.ts": fileOf(12),
    "packages/y/src/large.ts": fileOf(12),
  };
  await withHealthProject(files, async (dir) => {
    const json = parseReport((await health(dir, ["--format=json"])).stdout);
    assertEquals(json.large_files.map((entry) => entry.path), ["packages/x/src/large.ts"]);
  }, rule);
});
