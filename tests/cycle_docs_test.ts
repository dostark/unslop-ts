/**
 * @module CycleDocsTest
 * @path tests/cycle_docs_test.ts
 * @description The engine README, style guide and methodology describe the cycle report, its kinds, baseline and gate.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [README.md, docs/style_guide.md, docs/metrics_methodology.md]
 */

import { assert, assertStringIncludes } from "@std/assert";

const README = await Deno.readTextFile(new URL("../README.md", import.meta.url));
const STYLE_GUIDE = await Deno.readTextFile(new URL("../docs/style_guide.md", import.meta.url));
const METHODOLOGY = await Deno.readTextFile(new URL("../docs/metrics_methodology.md", import.meta.url));

Deno.test("cycle-docs-state: the README and the style guide name the report, its flags, the baseline and the gate", () => {
  for (
    const term of [
      "import-cycles",
      "--format=text|json|sarif",
      "--trace=<path>",
      "--update-baseline",
      "--fail-on-new",
      "allowed_unresolved",
      "SARIF",
    ]
  ) assertStringIncludes(README, term);
  assert(!README.includes("44 rules and 8 checks"), "the README still counts eight checks");
  assertStringIncludes(STYLE_GUIDE, "{#import-cycles}");
  assertStringIncludes(STYLE_GUIDE, "runtime cycle");
  assertStringIncludes(STYLE_GUIDE, "advisory");
  assertStringIncludes(STYLE_GUIDE, "allowed_unresolved");
});

Deno.test("cycle-methodology: the methodology defines every metric, the classification, the baseline and fallow comparison", () => {
  for (
    const term of [
      "strongly connected component",
      "runtime",
      "type-only",
      "mixed",
      "Canonical path",
      "Stable id",
      "FNV-1a",
      "runtime_sccs",
      "type_only_sccs",
      "mixed_sccs",
      "largest_files",
      "file_share",
      "per_thousand",
      "allowed_unresolved",
      "fallow",
    ]
  ) assertStringIncludes(METHODOLOGY, term);
  assertStringIncludes(METHODOLOGY, "## Import cycles {#import-cycles}");
});

const API = await Deno.readTextFile(new URL("../docs/reference/api.md", import.meta.url));
const REFERENCE = await Deno.readTextFile(new URL("../docs/reference/whole-tree-checks.md", import.meta.url));

Deno.test("cycle-docs-api: the API page describes the barrel accurately and the reference states the self-edge contract", () => {
  assert(!API.includes("nine whole-tree checks as library functions"), "the API page still promises nine functions");
  assertStringIncludes(API, "WHOLE_TREE_CHECKS");
  assertStringIncludes(API, "parseWholeTreeSettings");
  assertStringIncludes(API, "cycle report types");
  assertStringIncludes(REFERENCE, "self edge");
  assertStringIncludes(REFERENCE, "`edge_count` is 1");
});
