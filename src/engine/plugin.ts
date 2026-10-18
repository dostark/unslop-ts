/**
 * @module LintPluginFactory
 * @path packages/lint-rules/src/engine/plugin.ts
 * @description Builds a Deno lint plugin from a validated catalog and rule packs, honouring severity, scope, and local selection.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/catalog.ts, packages/lint-rules/src/engine/registry.ts]
 */

import { globToRegExp } from "@std/path";
import {
  classifyPath,
  type ICatalog,
  PATH_CLASS,
  type PathClass,
  requireRegisteredPluginRules,
  type RuleScope,
  ruleSettings,
  type RuleSeverity,
} from "./catalog.ts";
import { createRuleRegistry, type IRulePack } from "./registry.ts";

/** Rule packs the plugin factory registers. */
export interface ILintPluginOptions {
  readonly rulePacks: readonly IRulePack[];
}

type CatalogRule = ICatalog["rules"][string];

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

const compiledGlobs = new Map<string, RegExp>();

function globRegex(glob: string): RegExp {
  let regex = compiledGlobs.get(glob);
  if (!regex) {
    regex = globToRegExp(glob, { extended: true, globstar: true });
    compiledGlobs.set(glob, regex);
  }
  return regex;
}

function matchesAnyGlob(repoPath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globRegex(glob).test(repoPath));
}

/** The repository-relative path for a filename Deno lint reports as absolute. */
function repoRelative(filename: string): string {
  const cwd = Deno.cwd();
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return filename.startsWith(prefix) ? filename.slice(prefix.length) : filename;
}

/** True when scope, include, and exclude all allow the rule on this path. */
function allows(repoPath: string, pathClass: PathClass, settings: ReturnType<typeof ruleSettings>): boolean {
  if (!scopeAllows(settings.scope, pathClass)) return false;
  if (settings.include && !matchesAnyGlob(repoPath, settings.include)) return false;
  if (settings.exclude && matchesAnyGlob(repoPath, settings.exclude)) return false;
  return true;
}

/** True when the rule should report: severity, opt-in, and the local selection all allow it. */
function isRuleActive(
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

/** Builds the plugin. An inactive rule stays registered and returns no visitors, so Deno treats its ignores as known. */
export function createLintPlugin(name: string, catalog: ICatalog, options: ILintPluginOptions): Deno.lint.Plugin {
  const registry = createRuleRegistry(name, options.rulePacks);
  requireRegisteredPluginRules(catalog, registry);
  const selection = parseSelection(Deno.env.get("EXAIX_LINT_RULES") ?? "");
  if (selection) {
    console.error(`[exaix-lint] EXAIX_LINT_RULES active: ${[...selection].join(", ")}`);
  }

  const rules: Record<string, Deno.lint.Rule> = {};
  for (const id of registry.catalogIds()) {
    const implementation = registry.implementation(id);
    const entry = catalog.rules[id];
    if (!implementation || !entry) continue;
    const settings = ruleSettings(catalog, id, registry);
    const key = id.slice(registry.pluginName.length + 1);
    const active = isRuleActive(entry, settings.severity, selection, { id, key });

    rules[key] = {
      create(context) {
        if (!active) return {};
        const repoPath = repoRelative(context.filename);
        const pathClass = classifyPath(repoPath, catalog.scopes);
        if (!allows(repoPath, pathClass, settings)) return {};
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
