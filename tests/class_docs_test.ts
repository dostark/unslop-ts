/**
 * @module ClassDocsTest
 * @path tests/class_docs_test.ts
 * @description Proves that the style guide defines every class metric and strategy and that the README documents the class-size strategy option, the health class section, its flags and the precision labels.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [docs/style_guide.md, README.md, docs/metrics_methodology.md]
 */

import { assertMatch, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const ROOT = join(import.meta.dirname!, "..");
const METRICS = [
  "NOM",
  "NOA",
  "WMC",
  "TCC",
  "LCOM4",
  "ATFD",
  "CBO",
  "RFC",
  "DIT",
  "NOC",
  "WOC",
  "NOAP",
  "NOAM",
  "LAA",
  "FDP",
];
const STRATEGIES = ["God Class", "Data Class", "Feature Envy"];

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(join(ROOT, path));
}

/** The complexity section of the style guide, from its heading to the next second-level heading. */
function complexitySection(guide: string): string {
  const start = guide.indexOf("## Function & Method Complexity {#complexity-rules}");
  return guide.slice(start, guide.indexOf("\n## ", start + 1));
}

Deno.test("docs-class-metrics: the style guide defines every class metric, strategy and the legacy score", async () => {
  const section = complexitySection(await read("docs/style_guide.md"));
  for (const metric of METRICS) assertMatch(section, new RegExp(`\\b${metric}\\b`), `${metric} is not defined`);
  for (const strategy of STRATEGIES) assertStringIncludes(section, strategy);
  assertStringIncludes(section, "legacy-score");
  assertStringIncludes(section, "metrics_methodology.md");
  assertNotMatch(section, /A score of 60 or more is a god object/);
});

Deno.test("docs-class-metrics: the style guide separates the generic preset from an activating project", async () => {
  const section = complexitySection(await read("docs/style_guide.md"));
  assertMatch(section, /generic preset[^.]*(off|opt-in)/i);
  assertMatch(section, /`max-params`[^.]*opt-in/);
});

Deno.test("docs-strategies: the README documents the strategy option, the class section, its flags and the precision labels", async () => {
  const readme = await read("README.md");
  for (const text of ["`strategy`", "god-class", "legacy-score", "--classes", "--top-classes", "class_scores"]) {
    assertStringIncludes(readme, text);
  }
  for (const label of ["syntactic", "typed", "design_findings", "class_thresholds"]) {
    assertStringIncludes(readme, label);
  }
  assertStringIncludes(readme, "docs/metrics_methodology.md");
});

/** The agent context section of the style guide, from its heading to the next second-level heading. */
function agentContextSection(guide: string): string {
  const start = guide.indexOf("## Module Size and Agent Context {#agent-context}");
  return start < 0 ? "" : guide.slice(start, guide.indexOf("\n## ", start + 1));
}

Deno.test("docs-agent-context: the style guide explains why module decomposition beats function splitting for agents", async () => {
  const section = agentContextSection(await read("docs/style_guide.md"));
  assertMatch(section, /\bagent/i, "the section is missing or does not mention agents");
  for (const claim of ["tokens", "whole file", "module", "round trip", "nesting", "softMax", "hard limit", "soft limit"]) {
    assertStringIncludes(section, claim);
  }
  assertMatch(section, /splitting a function[^.]*(more|larger|longer)/i);
  assertMatch(section, /relocat|move[sd]? (the )?(lines|decisions)/i);
});

Deno.test("docs-agent-context: the function size rule and the methodology describe the soft and hard line limits", async () => {
  const guide = complexitySection(await read("docs/style_guide.md"));
  assertStringIncludes(guide, "softMax");
  assertStringIncludes(guide, "#agent-context");
  const methodology = await read("docs/metrics_methodology.md");
  assertStringIncludes(methodology, "softMax");
});

