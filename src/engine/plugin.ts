/**
 * @module LintPluginFactory
 * @path packages/lint-rules/src/engine/plugin.ts
 * @description Builds a Deno lint plugin from a validated catalog, honouring severity, scope, and local selection.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/catalog.ts, packages/lint-rules/src/rules/mod.ts]
 */

import { globToRegExp } from "@std/path";
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
    const key = id.startsWith(`${name}/`) ? id.slice(name.length + 1) : id;
    const selected = selection !== null && isSelected(selection, id, key, entry.tags);
    if (settings.severity === "off") {
      // An `off` rule runs only when it is opt-in AND explicitly selected.
      if (!(entry.optIn === true && selected)) continue;
    } else if (selection && !selected) {
      continue;
    }

    rules[key] = {
      create(context) {
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
