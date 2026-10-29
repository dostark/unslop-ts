/**
 * @module MetricContextTest
 * @path tests/metric_context_test.ts
 * @description Positions, line ownership and function-size measurement of the metric core on every parser shape.
 * @architectural-layer Test
 * @related-files [src/metrics/context.ts, src/metrics/function_metrics.ts, src/rules/max_cyclomatic_complexity.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { parse } from "@babel/parser";
import { DENO_RULE_PACK, type JsonValue, TYPESCRIPT_RULE_PACK } from "../mod.ts";
import { createDenoPlugin, runPlugin } from "../deno.ts";
import { createMeasurementContext } from "../src/metrics/context.ts";
import { functionUnits, measureFunction } from "../src/metrics/function_metrics.ts";
import type { IFunctionMetrics } from "../src/metrics/types.ts";
import { createMaxCyclomaticComplexity } from "../src/rules/max_cyclomatic_complexity.ts";
import type { IRulePack } from "../src/engine/registry.ts";
import type { IRuleNode } from "../src/rules/types.ts";
import { EXTENDED_OPTIONS, FIXTURE_PATH, measureAll, measureWithContext, positionOf } from "./helpers/measurement.ts";
import { loadTestCatalog } from "./helpers/registry.ts";

const THREE_FUNCTIONS = "function a(x: boolean): number {\n  if (x) return 1;\n  return 0;\n}\n" +
  "function b(x: boolean): number {\n  if (x) return 1;\n  return 0;\n}\n" +
  "function c(x: boolean): number {\n  if (x) return 1;\n  return 0;\n}\n";

const CLASS_SOURCE = "class Service {\n" +
  "  ready = false;\n" +
  "  arrow = (value: number): number => value;\n" +
  "  get label(): string {\n" +
  '    return "service";\n' +
  "  }\n" +
  "  set label(value: string) {}\n" +
  "  run(a: boolean): void {\n" +
  "    if (a) return;\n" +
  "  }\n" +
  "}";

const OBJECT_SOURCE = "const obj = {\n" +
  "  method(a: boolean): number { if (a) return 1; return 0; },\n" +
  "  arrow: (a: boolean): number => a ? 1 : 0,\n" +
  "};";

const DEFAULT_EXPORT = "export default function (a: boolean): number { if (a) return 1; return 0; }";

const STRAIGHT_ARROW = "const helper = (\n  first: number,\n  second: number,\n): number => first + second;";

const DESCENDANT_SOURCE = "function outer(item: number): number {\n" +
  "  const inner = (value: number): number => {\n" +
  "    if (value) return value;\n" +
  "    return 0;\n" +
  "  };\n" +
  "  if (item) return inner(1);\n" +
  "  return 0;\n" +
  "}";

const THIS_REST_SOURCE = "function params(this: void, { a, b }: Shape, ...rest: number[]): void {}";

const DEFAULT_PARAM_SOURCE = "function defaults(a = flag ? 1 : 2): number {\n  return a;\n}";

/** The comparable shape of a measurement, so two parsers can be compared value by value. */
function shapeOf(metrics: IFunctionMetrics): unknown {
  return {
    name: metrics.name,
    line: metrics.line,
    column: metrics.column,
    range: metrics.range,
    cyclomatic: metrics.cyclomatic,
    cognitive: metrics.cognitive,
    lines: metrics.lines,
    params: metrics.params,
    contributions: metrics.contributions.map((entry) => ({ ...entry })),
  };
}

/** Measures the source through the Babel AST, the tree the standalone report will read. */
function babelMetrics(source: string, filename = FIXTURE_PATH): readonly IFunctionMetrics[] {
  const context = createMeasurementContext({ text: source }, filename);
  const parsed = parse(source, {
    sourceType: "module",
    plugins: filename.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
    tokens: true,
    ranges: true,
  });
  const program: IRuleNode = parsed.program;
  return functionUnits(program, context).map((unit) => measureFunction(unit, EXTENDED_OPTIONS, context));
}

Deno.test("function-lines-and-params: token LOC, descendant ownership, defaults, rest, and this", () => {
  const arrow = measureAll(STRAIGHT_ARROW)[0];
  assertEquals(arrow.name, "helper");
  assertEquals(arrow.lines, 4);
  assertEquals(arrow.params, 2);
  assertEquals(arrow.cyclomatic, 1);

  const nested = measureAll(DESCENDANT_SOURCE);
  assertEquals(nested.map((entry) => entry.name), ["outer", "inner"]);
  assertEquals(nested.map((entry) => entry.lines), [6, 4]);

  const params = measureAll(THIS_REST_SOURCE)[0];
  assertEquals(params.params, 2);

  const defaults = measureAll(DEFAULT_PARAM_SOURCE)[0];
  assertEquals(defaults.cyclomatic, 1);
});

Deno.test("function-lines-and-params: class, object-literal, default-export and accessor names are distinct", () => {
  assertEquals(measureAll(CLASS_SOURCE).map((entry) => entry.name), [
    "arrow",
    "get label",
    "set label",
    "run",
  ]);
  assertEquals(measureAll(OBJECT_SOURCE).map((entry) => entry.name), ["method", "arrow"]);
  assertEquals(measureAll(DEFAULT_EXPORT).map((entry) => entry.name), ["default"]);
});

Deno.test("metric-core-cross-parser: golden corpus values match the Deno host and the Babel AST", () => {
  const corpus = [
    {
      name: "alpha",
      source: "function alpha(x: number): number {\n  if (x > 0) return x;\n  return x && 1 ? x : 0;\n}",
    },
    { name: "wide", source: "function wide(a?: string, b = flag ? 1 : 2): number {\n  return a?.length ?? b;\n}" },
    { name: "nested", source: DESCENDANT_SOURCE },
    { name: "class", source: CLASS_SOURCE },
    { name: "object", source: OBJECT_SOURCE },
    { name: "default-export", source: DEFAULT_EXPORT },
  ];
  for (const entry of corpus) {
    const deno = measureAll(entry.source).map(shapeOf);
    const babel = babelMetrics(entry.source).map(shapeOf);
    assertEquals(babel, deno, entry.name);
  }
});

Deno.test("metric-context-hosts: CRLF, non-ASCII, multiline literals and comments keep UTF-16 positions", () => {
  const crlf = "function f(): number {\r\n  return 1;\r\n}\r\n";
  const crlfSource = measureWithContext(crlf);
  assertEquals(crlfSource.context.positionAt(crlf.indexOf("return")), { line: 2, column: 3 });
  assertEquals(crlfSource.metrics[0].lines, 3);

  const unicode = 'const smile = "ü😀"; // note\nfunction f(): void {}\n';
  const unicodeSource = measureWithContext(unicode);
  assertEquals(unicodeSource.context.positionAt(unicode.indexOf("function")), { line: 2, column: 1 });
  assertEquals(unicodeSource.context.positionAt(unicode.indexOf("// note")), { line: 1, column: 22 });
  assertEquals(
    unicodeSource.context.positionAt(unicode.indexOf("// note")),
    positionOf(unicode, unicode.indexOf("// note")),
  );

  const template = "function f(): string {\n  return `a\n\nb`;\n}\n";
  assertEquals(measureWithContext(template).metrics[0].lines, 5);

  const commented = "// header\nfunction f(): number {\n  return 1;\n}\n";
  assertEquals(measureWithContext(commented).metrics[0].lines, 3);
});

Deno.test("metric-context-hosts: blank JSX text is layout and the host loc is never read", () => {
  const jsx = "const App = () => (\n  <div>\n\n  </div>\n);\n";
  assertEquals(measureWithContext(jsx, EXTENDED_OPTIONS, "packages/x/src/a.tsx").metrics[0].lines, 4);
  const source = "function f(a: boolean): number {\n  if (a) return 1;\n  return 0;\n}";
  assertEquals(measureAll(source).map(shapeOf), babelMetrics(source).map(shapeOf));
});

Deno.test("metric-context-hosts: a parse diagnostic is an explicit error, never a zero measurement", () => {
  assertThrows(
    () => createMeasurementContext({ text: "function f( {" }, FIXTURE_PATH),
    Error,
    "Metrics cannot parse",
  );
});

Deno.test("metric-context-hosts: the rule creates one measurement context per file", () => {
  let creates = 0;
  const base = TYPESCRIPT_RULE_PACK.rules["max-cyclomatic-complexity"];
  const counted: IRulePack = {
    name: "typescript",
    optionSchemas: TYPESCRIPT_RULE_PACK.optionSchemas,
    rules: {
      ...TYPESCRIPT_RULE_PACK.rules,
      "max-cyclomatic-complexity": {
        ...base,
        create(context, ctx) {
          creates++;
          return createMaxCyclomaticComplexity(context, ctx);
        },
      },
    },
  };
  const catalog = {
    version: "1",
    scopes: { test: [], fixture: [] },
    tagVocabulary: { complexity: { description: "Function size limits." } },
    rules: {
      "demo/max-cyclomatic-complexity": {
        engine: "plugin",
        severity: "error",
        scope: "prod",
        tags: ["complexity"],
        options: { max: 1 } satisfies Record<string, JsonValue>,
      },
    },
  };
  const plugin = createDenoPlugin("demo", loadTestCatalog(catalog), {
    rulePacks: [counted, DENO_RULE_PACK],
  });
  const diagnostics = runPlugin(plugin, FIXTURE_PATH, THREE_FUNCTIONS);
  assertEquals(creates, 1);
  assertEquals(diagnostics.length, 3);
});
