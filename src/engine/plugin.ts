/**
 * @module LintPluginFactory
 * @path packages/lint-rules/src/engine/plugin.ts
 * @description Builds a Deno lint plugin from a validated catalog, honouring severity, scope, and local selection.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/catalog.ts, packages/lint-rules/src/rules/mod.ts]
 */

import { PLUGIN_RULE_IMPLEMENTATIONS } from "../rules/mod.ts";
import { classifyPath, type ICatalog, PATH_CLASS, type PathClass, type RuleScope, ruleSettings } from "./catalog.ts";

function parseSelection(value: string): Set<string> | null {
  if (value.trim() === "") return null;
  return new Set(value.split(",").map((token) => token.trim()).filter((token) => token.length > 0));
}

function isSelected(selection: Set<string>, id: string, key: string, tags: string[]): boolean {
  if (selection.has(id) || selection.has(key)) return true;
  for (const token of selection) {
    if (token.startsWith("tag:") && tags.includes(token.slice("tag:".length))) return true;
  }
  return false;
}

function scopeAllows(scope: RuleScope, pathClass: PathClass): boolean {
  if (pathClass === PATH_CLASS.fixture) return false;
  return scope === "all" || scope === pathClass;
}

export function createLintPlugin(name: string, catalog: ICatalog): Deno.lint.Plugin {
  const selection = parseSelection(Deno.env.get("EXAIX_LINT_RULES") ?? "");
  if (selection) {
    console.error(`[exaix-lint] EXAIX_LINT_RULES active: ${[...selection].join(", ")}`);
  }

  const rules: Record<string, Deno.lint.Rule> = {};
  for (const [id, implementation] of Object.entries(PLUGIN_RULE_IMPLEMENTATIONS)) {
    const entry = catalog.rules[id];
    if (!entry) continue;
    const settings = ruleSettings(catalog, id);
    if (settings.severity === "off") continue;
    const key = id.startsWith(`${name}/`) ? id.slice(name.length + 1) : id;
    if (selection && !isSelected(selection, id, key, entry.tags)) continue;

    rules[key] = {
      create(context) {
        const pathClass = classifyPath(context.filename, catalog.scopes);
        if (!scopeAllows(settings.scope, pathClass)) return {};
        return implementation.create(context, {
          options: settings.options,
          isTestFile: pathClass === PATH_CLASS.test,
          codeStyle: settings.codeStyle,
        });
      },
    };
  }

  return { name, rules };
}
