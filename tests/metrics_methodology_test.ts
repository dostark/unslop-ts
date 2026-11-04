/**
 * @module MetricsMethodologyTest
 * @path tests/metrics_methodology_test.ts
 * @description Executable examples, contribution tables, sources and the pinned calibration of the methodology doc.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [docs/metrics_methodology.md, src/metrics/mod.ts]
 */

import { assert, assertEquals, assertMatch, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { createMeasurementContext } from "../src/metrics/context.ts";
import { functionUnits, measureFunction } from "../src/metrics/function_metrics.ts";
import { METRIC_CONTRIBUTION_KINDS } from "../src/metrics/types.ts";
import type { IClassMetrics, IFunctionMetrics, IMetricOptions, MetricVariant } from "../src/metrics/types.ts";
import { CLASS_THRESHOLDS } from "../src/metrics/class_thresholds.ts";
import type { IPassClass } from "../src/report/class_pass.ts";
import { bandsOf } from "../src/report/class_statistics.ts";
import { designFindingsOf } from "../src/report/design_strategies.ts";
import { measureClassesOnBabel } from "./helpers/class_measurement.ts";

const DOC_PATH = join(import.meta.dirname!, "../docs/metrics_methodology.md");

/** One parsed worked example: its id, its source and its expected values. */
interface IWorkedExample {
  readonly id: string;
  readonly code: string;
  readonly options: IMetricOptions;
  readonly expected: Readonly<
    Record<string, Readonly<Record<"cyclomatic" | "cognitive" | "lines" | "params", number>>>
  >;
}

/** One expected metric value of one unit. */
type ExpectedMetrics = Readonly<Record<"cyclomatic" | "cognitive" | "lines" | "params", number>>;

/** A methodology error, for a malformed document or a failed example. */
class MethodologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MethodologyError";
  }
}

/** Reads the methodology document. */
async function methodologyText(): Promise<string> {
  try {
    return await Deno.readTextFile(DOC_PATH);
  } catch (error) {
    throw new MethodologyError(`cannot read ${DOC_PATH}: ${String(error)}`);
  }
}

const EXAMPLE_MARKER = /^<!-- metric-example: ([a-z0-9-]+) -->$/;

/** The fence kind of one line, or null. */
function fenceKindOf(line: string): "ts" | "json" | null {
  if (line === "```ts") return "ts";
  if (line === "```json") return "json";
  return null;
}

/** Parses the worked examples from the doc text; rejects duplicate ids, missing JSON and unterminated fences. */
function parseExamples(text: string): IWorkedExample[] {
  const lines = text.split("\n");
  const examples: IWorkedExample[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    const marker = EXAMPLE_MARKER.exec(lines[index].trim());
    if (!marker) continue;
    const id = marker[1];
    if (seen.has(id)) throw new MethodologyError(`duplicate example id: ${id}`);
    seen.add(id);
    const code = readFence(lines, index, "ts", id);
    const json = readFence(lines, code.end, "json", id);
    index = json.end;
    const parsed = parseExampleJson(json.body, id);
    examples.push({ id, code: code.body, options: parsed.options, expected: parsed.expected });
  }
  return examples;
}

/** Reads the fence of one kind after a marker, returning its body and its closing line index. */
function readFence(
  lines: readonly string[],
  markerLine: number,
  kind: "ts" | "json",
  id: string,
): { readonly body: string; readonly end: number } {
  let open = -1;
  for (let index = markerLine + 1; index < lines.length; index++) {
    if (lines[index].trim() === "") continue;
    if (fenceKindOf(lines[index].trim()) === kind) {
      open = index;
      break;
    }
    throw new MethodologyError(`example ${id}: expected a ${kind} fence after the marker`);
  }
  if (open === -1) throw new MethodologyError(`example ${id}: missing ${kind} fence`);
  const close = lines.indexOf("```", open + 1);
  if (close === -1) throw new MethodologyError(`example ${id}: unterminated ${kind} fence`);
  return { body: lines.slice(open + 1, close).join("\n"), end: close };
}

const VARIANTS: ReadonlySet<string> = new Set(["classic", "extended"]);

/** Validates and parses one JSON fence. */
function parseExampleJson(body: string, id: string): { options: IMetricOptions; expected: IWorkedExample["expected"] } {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new MethodologyError(`example ${id}: invalid JSON: ${String(error)}`);
  }
  if (typeof value !== "object" || value === null) throw new MethodologyError(`example ${id}: JSON must be an object`);
  const record = value as Record<string, unknown>;
  if (record.id !== id) throw new MethodologyError(`example ${id}: JSON id mismatch`);
  const options = record.options;
  if (typeof options !== "object" || options === null) throw new MethodologyError(`example ${id}: missing options`);
  const optionRecord = options as Record<string, unknown>;
  const variant = optionRecord.variant;
  if (typeof variant !== "string" || !VARIANTS.has(variant)) {
    throw new MethodologyError(`example ${id}: invalid variant`);
  }
  if (typeof optionRecord.countNullish !== "boolean") throw new MethodologyError(`example ${id}: missing countNullish`);
  return {
    options: { variant: variant as MetricVariant, countNullish: optionRecord.countNullish },
    expected: expectedOf(record.expected, id),
  };
}

/** Validates the expected map of one example. */
function expectedOf(value: unknown, id: string): IWorkedExample["expected"] {
  if (typeof value !== "object" || value === null) throw new MethodologyError(`example ${id}: missing expected map`);
  const expected: Record<string, ExpectedMetrics> = {};
  for (const [unit, metrics] of Object.entries(value as Record<string, unknown>)) {
    if (typeof metrics !== "object" || metrics === null) {
      throw new MethodologyError(`example ${id}: expected ${unit} is not an object`);
    }
    const metricRecord = metrics as Record<string, unknown>;
    expected[unit] = {
      cyclomatic: numberField(metricRecord, "cyclomatic", id, unit),
      cognitive: numberField(metricRecord, "cognitive", id, unit),
      lines: numberField(metricRecord, "lines", id, unit),
      params: numberField(metricRecord, "params", id, unit),
    };
  }
  return expected;
}

/** Reads one required number field. */
function numberField(record: Record<string, unknown>, key: string, id: string, unit: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new MethodologyError(`example ${id}: ${unit}.${key} is not a number`);
  return value;
}

/** Measures every unit of one source text with the given options. */
function measuredUnits(text: string, options: IMetricOptions): Map<string, IFunctionMetrics> {
  const context = createMeasurementContext({ text }, "example.ts");
  const measured = new Map<string, IFunctionMetrics>();
  for (const unit of functionUnits(context.syntaxTree.program, context)) {
    measured.set(unit.name, measureFunction(unit, options, context));
  }
  return measured;
}

/** Verifies one example and returns the compared unit count. */
function verifyExample(example: IWorkedExample): number {
  const measured = measuredUnits(example.code, example.options);
  let compared = 0;
  for (const [unitName, expected] of Object.entries(example.expected)) {
    const actual = measured.get(unitName);
    if (!actual) throw new MethodologyError(`example ${example.id}: no unit named ${unitName}`);
    for (const key of ["cyclomatic", "cognitive", "lines", "params"] as const) {
      if (actual[key] !== expected[key]) {
        throw new MethodologyError(
          `example ${example.id}: ${unitName}.${key} is ${actual[key]}, expected ${expected[key]}`,
        );
      }
    }
    compared++;
  }
  return compared;
}

/** The kind column of the contribution table in the doc. */
function contributionTableKinds(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "### Contribution kinds");
  if (start === -1) throw new MethodologyError("missing the contribution kinds section");
  const kinds: string[] = [];
  let inRows = false;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line.startsWith("|")) {
      if (inRows) break;
      continue;
    }
    inRows = true;
    const cell = line.split("|")[1]?.trim() ?? "";
    if (cell === "Kind" || /^-+$/.test(cell)) continue;
    kinds.push(cell.replaceAll("`", ""));
  }
  return kinds;
}

Deno.test("every worked example measures exactly", async () => {
  const text = await methodologyText();
  const examples = parseExamples(text);
  assert(examples.length >= 4, "the document defines at least four worked examples");
  let compared = 0;
  for (const example of examples) compared += verifyExample(example);
  assertEquals(compared, examples.length);
});

Deno.test("a seeded wrong expectation fails", async () => {
  const text = await methodologyText();
  const [first] = parseExamples(text);
  const [unitName, metrics] = Object.entries(first.expected)[0];
  const wrong: IWorkedExample = {
    ...first,
    expected: { [unitName]: { ...metrics, cyclomatic: metrics.cyclomatic + 1 } },
  };
  assertThrows(() => verifyExample(wrong), MethodologyError);
});

Deno.test("malformed examples are rejected", () => {
  const duplicate = `<!-- metric-example: a -->\n\`\`\`ts\nconst x = 1;\n\`\`\`\n` +
    `\`\`\`json\n{"id":"a","options":{"variant":"extended","countNullish":true},"expected":{}}\n\`\`\`\n` +
    `<!-- metric-example: a -->\n\`\`\`ts\nconst y = 2;\n\`\`\`\n` +
    `\`\`\`json\n{"id":"a","options":{"variant":"extended","countNullish":true},"expected":{}}\n\`\`\``;
  assertThrows(() => parseExamples(duplicate), MethodologyError);
  const missingJson = `<!-- metric-example: a -->\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`;
  assertThrows(() => parseExamples(missingJson), MethodologyError);
  const unterminated = `<!-- metric-example: a -->\n\`\`\`ts\nconst x = 1;\n`;
  assertThrows(() => parseExamples(unterminated), MethodologyError);
});

Deno.test("the contribution table names exactly the exported kinds", async () => {
  const text = await methodologyText();
  assertEquals(contributionTableKinds(text), [...METRIC_CONTRIBUTION_KINDS]);
});

Deno.test("every source is linked and every comparison is pinned", async () => {
  const text = await methodologyText();
  const references = text.slice(text.indexOf("## References"));
  for (
    const source of [
      "10.1109/TSE.1976.233837",
      "sonarsource.com/resources/cognitive-complexity",
      "github.com/SonarSource/SonarJS",
      "npmjs.com/package/fallow",
      "artima.com/weblogs/viewpost.jsp?thread=215899",
      "github.com/linux-test-project/lcov",
      "learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-maintainability-index",
    ]
  ) {
    assert(references.includes(source), `missing source: ${source}`);
  }
  assert(text.includes("fallow 3.36.0"), "the fallow comparison is pinned");
  assert(text.includes("schema 12"), "the fallow schema is pinned");
});

Deno.test("the calibration record names the pinned counts and differences", async () => {
  const text = await methodologyText();
  for (
    const fact of [
      "2026-10-30",
      "3.36.0",
      "schema 12",
      "46,137",
      "46,138",
      "99.998",
      "97.78",
      "99.77",
      "604 fallow rows",
      "496 core rows",
      "2,587",
      "CALIBRATION_EXCLUSIONS",
    ]
  ) {
    assert(text.includes(fact), `missing calibration fact: ${fact}`);
  }
});

Deno.test("methodology-shadow-example: the shadowing limit is stated as function-wide with a measured example", async () => {
  const text = await methodologyText();
  assert(text.includes("recursion-shadow"), "the shadow example is present");
  assert(text.includes("function-wide"), "the shadow check is described as function-wide");
});

Deno.test("postreview-methodology-examples: the gate, graph and history contracts are stated as built", async () => {
  const text = await methodologyText();
  for (
    const claim of [
      "every file that the plugin observed",
      "leaves the project root",
      "unborn HEAD",
      "short grace",
      "source-changed-during-scan",
    ]
  ) {
    assert(text.includes(claim), `missing contract statement: ${claim}`);
  }
});

const CLASS_MARKER = /^<!-- class-example: ([a-z0-9-]+) -->$/;
const CLASS_REFERENCE_TAG = /\[([A-Z]{2,3}\d{2})\]/g;
const DOI_PATTERN = /DOI 10\.\d{4,}\/\S+/;
const NO_DOI_NOTE = "No DOI is registered";
const CLASS_SECTION = "## Class design metrics";

/** One class worked example: its source, the expected metrics per class, and the strategies that flag the class. */
interface IClassExample {
  readonly id: string;
  readonly code: string;
  readonly expected: Readonly<Record<string, Readonly<Partial<Record<keyof IClassMetrics, number | null>>>>>;
  readonly strategies: Readonly<Record<string, readonly string[]>>;
  readonly bands: readonly number[];
}

/** Parses the class examples of the document. A marker without both fences is an error. */
function parseClassExamples(text: string): IClassExample[] {
  const lines = text.split("\n");
  const examples: IClassExample[] = [];
  for (let index = 0; index < lines.length; index++) {
    const marker = CLASS_MARKER.exec(lines[index].trim());
    if (!marker) continue;
    const code = readFence(lines, index, "ts", marker[1]);
    const json = readFence(lines, code.end, "json", marker[1]);
    index = json.end;
    const parsed = JSON.parse(json.body);
    if (parsed.id !== marker[1]) throw new MethodologyError(`class example ${marker[1]}: JSON id mismatch`);
    examples.push({
      id: marker[1],
      code: code.body,
      expected: parsed.expected ?? {},
      strategies: parsed.strategies ?? {},
      bands: parsed.bands ?? [],
    });
  }
  return examples;
}

/** The pass class that the strategies read for one measured class. */
function passClassOf(metrics: IClassMetrics): IPassClass {
  return { path: "example.ts", name: metrics.name, nameOffset: 0, metrics, methods: [] };
}

Deno.test("methodology-class-examples: every class worked example gives its stated metrics and strategy results", async () => {
  const examples = parseClassExamples(await methodologyText());
  assert(examples.length >= 6, `the document has ${examples.length} class examples`);
  for (const example of examples) {
    if (example.bands.length > 0) {
      const bands = bandsOf(example.bands);
      assertEquals(bands, { mean: 5, sd: 2, low: 3, average: 5, high: 7, very_high: 10.5 }, example.id);
      continue;
    }
    const measured = measureClassesOnBabel(example.code);
    for (const [name, values] of Object.entries(example.expected)) {
      const metrics = measured.find((entry) => entry.name === name);
      assert(metrics !== undefined, `${example.id}: no class ${name}`);
      for (const [key, value] of Object.entries(values)) {
        assertEquals(metrics[key as keyof IClassMetrics], value, `${example.id}: ${name}.${key}`);
      }
      const flagged = designFindingsOf([passClassOf(metrics)]).map((finding) => finding.strategy);
      assertEquals(flagged, example.strategies[name] ?? [], `${example.id}: ${name} strategies`);
    }
  }
});

Deno.test("methodology-strategy-tables: the documented limits equal the constants and each condition holds at its boundary", async () => {
  const text = await methodologyText();
  const section = text.slice(text.indexOf("### Detection strategies"), text.indexOf("### The legacy score"));
  const limits: Record<string, number> = {};
  for (const row of section.split("\n")) {
    const cells = row.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !cells[1].startsWith("`")) continue;
    limits[cells[1].replaceAll("`", "")] = Number(cells[2]);
  }
  for (const [name, threshold] of Object.entries(CLASS_THRESHOLDS)) {
    assert(Math.abs(limits[name] - threshold.value) < 0.01, `${name}: ${limits[name]} against ${threshold.value}`);
    for (const source of threshold.sources) assertStringIncludes(section, source, `${name}: source`);
    assertStringIncludes(section, threshold.retrieved, `${name}: retrieval date`);
  }
  const base: IClassMetrics = measureClassesOnBabel("class Base {}")[0];
  const flags = (overrides: Partial<IClassMetrics>): string[] =>
    designFindingsOf([passClassOf({ ...base, ...overrides })]).map((finding) => finding.strategy);
  const god = { wmc: limits.wmcVeryHigh, tcc: 0.3, atfd: limits.atfdFew + 1, woc: 1, noap: 0, noam: 0 };
  assertEquals(flags(god), ["god-class"]);
  assertEquals(flags({ ...god, wmc: limits.wmcVeryHigh - 1 }), []);
  assertEquals(flags({ ...god, atfd: limits.atfdFew }), []);
  assertEquals(flags({ ...god, tcc: CLASS_THRESHOLDS.tccLimit.value }), []);
  const data = { wmc: 1, woc: limits.wocLimit - 0.01, noap: limits.dataClassFew + 1, noam: 0, tcc: 1, atfd: 0 };
  assertEquals(flags(data), ["data-class"]);
  assertEquals(flags({ ...data, noap: limits.dataClassFew }), []);
  assertEquals(flags({ ...data, wmc: limits.wmcHigh }), []);
  assertEquals(flags({ ...data, noap: limits.dataClassMany + 1, wmc: limits.wmcHigh }), ["data-class"]);
  assertEquals(flags({ ...data, noap: limits.dataClassMany + 1, wmc: limits.wmcVeryHigh }), []);
});

Deno.test("methodology-class-references: every cited class source is in the reference list with a DOI or a stated absence", async () => {
  const text = await methodologyText();
  const classSection = text.slice(text.indexOf(CLASS_SECTION), text.indexOf("## References"));
  const references = text.slice(text.indexOf("## References"));
  const cited = new Set([...classSection.matchAll(CLASS_REFERENCE_TAG)].map((match) => match[1]));
  assert(cited.size >= 4, `only ${cited.size} class sources are cited`);
  for (const tag of cited) {
    const entry = references.split("\n- ").find((candidate) => candidate.startsWith(`[${tag}]`));
    assert(entry !== undefined, `${tag} is not in the reference list`);
    const flat = entry.replace(/\s+/g, " ");
    assert(DOI_PATTERN.test(flat) || flat.includes(NO_DOI_NOTE), `${tag} has neither a DOI nor a stated absence`);
  }
  assertMatch(references, /DOI 10\.1109\/32\.295895/);
});
