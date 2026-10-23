#!/usr/bin/env node
/**
 * @module GenerateOverlapTable
 * @path scripts/generate_overlap_table.mjs
 * @description Regenerates the README overlap table from IPluginRule.overlaps.
 *
 * Usage:
 *   node scripts/generate_overlap_table.mjs          # rewrite README
 *   node scripts/generate_overlap_table.mjs --check  # fail when stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../mod.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const README = join(ROOT, "README.md");
const BEGIN = "<!-- BEGIN GENERATED OVERLAPS -->";
const END = "<!-- END GENERATED OVERLAPS -->";

const GUIDANCE = {
  duplicate: "Turn one of the two off; `typescript-eslint-compat` turns the unslop rule off.",
  related: "Both may run; the unslop rule is narrower and states the reason.",
};

function table() {
  const header = ["unslop rule", "Ecosystem", "Foreign rule", "Kind", "Guidance"];
  const rows = [];
  for (const pack of [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]) {
    for (const [key, rule] of Object.entries(pack.rules)) {
      for (const overlap of rule.overlaps) {
        rows.push([
          `\`unslop/${key}\``,
          overlap.ecosystem,
          `\`${overlap.rule}\``,
          overlap.kind,
          GUIDANCE[overlap.kind],
        ]);
      }
    }
  }
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [line(header), `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`, ...rows.map(line)].join("\n");
}

const readme = readFileSync(README, "utf8");
const start = readme.indexOf(BEGIN);
const end = readme.indexOf(END);
if (start < 0 || end < start) throw new Error("README has no generated-overlap markers");
const next = `${readme.slice(0, start + BEGIN.length)}\n\n${table()}\n\n${readme.slice(end)}`;

if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README overlap table is stale; run node scripts/generate_overlap_table.mjs");
    process.exit(1);
  }
  process.exit(0);
}
writeFileSync(README, next);
