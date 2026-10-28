/**
 * @module RuleGate
 * @path src/engine/rule_gate.ts
 * @description Pure gate helpers shared by the hosts: selection names and parsing, scope and skip decisions.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/catalog.ts, src/engine/plugin.ts, src/engine/trace.ts]
 */

import { PATH_CLASS } from "./catalog.ts";
import type { ICatalog, IResolvedRuleSettings, PathClass, RuleSeverity } from "./catalog.ts";
import { matchesAnyGlob } from "./glob.ts";
import type { SkipReason } from "./trace.ts";

type CatalogRule = ICatalog["rules"][string];

const RULE_ID_SEPARATOR = "/";
const NON_NAME_CHARS = /[^A-Z0-9]+/g;
const SELECTION_ENV_SUFFIX = "_LINT_RULES";

/** The variable that selects a plugin's rules locally: "demo" gives "DEMO_LINT_RULES". */
export function selectionEnvName(pluginName: string): string {
  return `${pluginName.toUpperCase().replace(NON_NAME_CHARS, "_")}${SELECTION_ENV_SUFFIX}`;
}

/** The selection variable of the plugin that owns a catalog id of the form `<plugin>/<key>`. */
export function selectionEnvNameForRule(ruleId: string): string {
  return selectionEnvName(ruleId.split(RULE_ID_SEPARATOR)[0]);
}

/** Parses a selection list into its tokens, or null when nothing is selected. */
export function parseSelection(value: string): Set<string> | null {
  if (value.trim() === "") return null;
  return new Set(value.split(",").map((token) => token.trim()).filter((token) => token.length > 0));
}

/** True when the selection names the rule by id, bare key, or tag. */
function isSelected(selection: Set<string>, id: string, key: string, tags: string[]): boolean {
  if (selection.has(id) || selection.has(key)) return true;
  for (const token of selection) {
    if (token.startsWith("tag:") && tags.includes(token.slice("tag:".length))) return true;
  }
  return false;
}

/** The repository-relative path for a filename the host reports as absolute. */
export function repoRelative(filename: string, cwd: string): string {
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return filename.startsWith(prefix) ? filename.slice(prefix.length) : filename;
}

/** The first condition that stops a rule on this path, or null when the rule may run. */
export function skipReasonOf(
  repoPath: string,
  pathClass: PathClass,
  settings: IResolvedRuleSettings,
): SkipReason | null {
  if (pathClass === PATH_CLASS.fixture) return "fixture";
  if (settings.scope !== "all" && settings.scope !== pathClass) return "scope";
  if (settings.include && !matchesAnyGlob(repoPath, settings.include)) return "include";
  if (settings.exclude && matchesAnyGlob(repoPath, settings.exclude)) return "exclude";
  return null;
}

/** True when the rule should report: severity, opt-in, and the local selection all allow it. */
export function isRuleActive(
  entry: CatalogRule,
  severity: RuleSeverity,
  selection: Set<string> | null,
  names: { readonly id: string; readonly key: string },
): boolean {
  const selected = selection !== null && isSelected(selection, names.id, names.key, entry.tags);
  // An `off` rule runs only when it is opt-in and explicitly selected.
  if (severity === "off") return entry.optIn === true && selected;
  return selection === null || selected;
}
