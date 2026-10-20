/**
 * @module WholeTreeDuplicateCheck
 * @path src/rules/whole_tree/duplicate_check.ts
 * @description Walks a checkout and runs the duplicate-type or duplicate-constant check with the options of a catalog rule entry.
 * @architectural-layer Shared
 * @dependencies [@std/fs, @std/path, zod]
 * @related-files [src/rules/whole_tree/duplicate_type.ts, src/cli/whole_tree.ts]
 */

import { walk } from "@std/fs";
import { relative } from "@std/path";
import { z } from "zod";
import { CatalogError, classifyPath, type JsonValue } from "../../engine/catalog.ts";
import { matchesAnyGlob } from "../../engine/glob.ts";
import { findDuplicateConstants, validateConstantAllowEntries } from "./duplicate_constant.ts";
import type { IDuplicate, ISourceUnit } from "./duplicate_groups.ts";
import { findDuplicateTypes, validateTypeAllowEntries } from "./duplicate_type.ts";

/** The catalog key of each duplicate check. */
export const DUPLICATE_RULES = ["duplicate-type", "duplicate-constant"] as const;

export type DuplicateRuleKey = typeof DUPLICATE_RULES[number];

/** What a duplicate check found: the later copies and the allow entries that match nothing. */
export interface IDuplicateReport {
  readonly duplicates: readonly IDuplicate[];
  readonly staleAllow: readonly string[];
}

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const SKIPPED_DIRECTORIES = [/[/\\]\.git[/\\]/, /[/\\]node_modules[/\\]/];
const RULE_ID_SEPARATOR = "/";

const CatalogSchema = z.object({
  scopes: z.object({ test: z.array(z.string()), fixture: z.array(z.string()) }).default({ test: [], fixture: [] }),
  rules: z.record(
    z.string(),
    z.object({
      scope: z.enum(["prod", "test", "all"]).default("all"),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      options: z.record(z.string(), z.unknown()).default({}),
    }).loose(),
  ).default({}),
}).loose();

type RuleEntry = z.infer<typeof CatalogSchema>["rules"][string];

function entryFor(rules: Record<string, RuleEntry>, key: DuplicateRuleKey): RuleEntry {
  const id = Object.keys(rules).find((candidate) =>
    candidate === key || candidate.endsWith(`${RULE_ID_SEPARATOR}${key}`)
  );
  if (id === undefined) throw new CatalogError(`rules.${key}`, "the catalog has no entry for this rule");
  return rules[id];
}

async function readUnits(repoRoot: string): Promise<ISourceUnit[]> {
  const units: ISourceUnit[] = [];
  for await (
    const entry of walk(repoRoot, { includeDirs: false, exts: SOURCE_EXTENSIONS, skip: SKIPPED_DIRECTORIES })
  ) {
    units.push({ path: relative(repoRoot, entry.path), text: await Deno.readTextFile(entry.path) });
  }
  return units.sort((a, b) => a.path.localeCompare(b.path));
}

/** Runs one duplicate check over a checkout. Throws a {@link CatalogError} when the catalog lacks the rule. */
export async function checkDuplicates(
  repoRoot: string,
  catalog: JsonValue,
  key: DuplicateRuleKey,
): Promise<IDuplicateReport> {
  const parsed = CatalogSchema.safeParse(catalog);
  if (!parsed.success) throw new CatalogError("catalog", parsed.error.issues[0]?.message ?? "invalid catalog");
  const entry = entryFor(parsed.data.rules, key);
  const units = (await readUnits(repoRoot)).filter((unit) => {
    const pathClass = classifyPath(unit.path, parsed.data.scopes);
    if (pathClass === "fixture" || (entry.scope !== "all" && entry.scope !== pathClass)) return false;
    if (entry.include && !matchesAnyGlob(unit.path, entry.include)) return false;
    return !(entry.exclude && matchesAnyGlob(unit.path, entry.exclude));
  });
  if (key === "duplicate-type") {
    const options = entry.options;
    return {
      duplicates: findDuplicateTypes(units, options),
      staleAllow: validateTypeAllowEntries(units, options),
    };
  }
  return {
    duplicates: findDuplicateConstants(units, entry.options),
    staleAllow: validateConstantAllowEntries(units, entry.options),
  };
}
