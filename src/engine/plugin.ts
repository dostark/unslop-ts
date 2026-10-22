/**
 * @module LintPluginFactory
 * @path src/engine/plugin.ts
 * @description Builds a Deno lint plugin from a validated catalog and rule packs, honouring severity, scope, and local selection.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/catalog.ts, src/engine/registry.ts]
 */

import { matchesAnyGlob } from "./glob.ts";
import {
  CatalogError,
  classifyPath,
  type ICatalog,
  PATH_CLASS,
  type PathClass,
  requireRegisteredPluginRules,
  ruleSettings,
  type RuleSeverity,
} from "./catalog.ts";
import { createRuleRegistry, type IRulePack } from "./registry.ts";
import {
  formatTraceRecord,
  INTERNAL_COVERAGE_RULE,
  type ITraceRecord,
  resolveTraceRunId,
  type SkipReason,
} from "./trace.ts";

/** Rule packs the plugin factory registers. */
export interface ILintPluginOptions {
  readonly rulePacks: readonly IRulePack[];
  /** A selection list that replaces the selection variable, so a caller need not change the process environment. */
  readonly selection?: string;
  /** A trace run id that replaces the trace variable, so a caller need not change the process environment. */
  readonly trace?: string;
}

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

/** The repository-relative path for a filename Deno lint reports as absolute. */
function repoRelative(filename: string): string {
  const cwd = Deno.cwd();
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return filename.startsWith(prefix) ? filename.slice(prefix.length) : filename;
}

/** The first condition that stops a rule on this path, or null when the rule may run. */
function skipReasonOf(
  repoPath: string,
  pathClass: PathClass,
  settings: ReturnType<typeof ruleSettings>,
): SkipReason | null {
  if (pathClass === PATH_CLASS.fixture) return "fixture";
  if (settings.scope !== "all" && settings.scope !== pathClass) return "scope";
  if (settings.include && !matchesAnyGlob(repoPath, settings.include)) return "include";
  if (settings.exclude && matchesAnyGlob(repoPath, settings.exclude)) return "exclude";
  return null;
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
  const envName = selectionEnvName(name);
  const selection = parseSelection(options.selection ?? Deno.env.get(envName) ?? "");
  if (selection) {
    console.error(`[${name}-lint] ${envName} active: ${[...selection].join(", ")}`);
  }

  const ignored = (catalog.ignore ?? []).map((entry) => entry.glob);
  const reservedId = `${name}/${INTERNAL_COVERAGE_RULE}`;
  if (registry.catalogIds().includes(reservedId)) {
    throw new CatalogError(`rules.${reservedId}`, "the rule key 'internal-coverage' is reserved for trace observation");
  }
  const traceRunId = resolveTraceRunId(name, options.trace);
  const emit = traceRunId === null ? null : (record: ITraceRecord) => console.error(formatTraceRecord(record));
  const rules: Record<string, Deno.lint.Rule> = {};
  if (traceRunId !== null) {
    rules[INTERNAL_COVERAGE_RULE] = {
      create(context) {
        emit?.({
          kind: "observed",
          runId: traceRunId,
          plugin: name,
          file: repoRelative(context.filename),
          rule: INTERNAL_COVERAGE_RULE,
        });
        return {};
      },
    };
  }
  for (const id of registry.catalogIds()) {
    const implementation = registry.implementation(id);
    if (!implementation) continue;
    const key = id.slice(registry.pluginName.length + 1);
    const entry = catalog.rules[id];
    if (!entry) {
      rules[key] = { create: () => ({}) };
      continue;
    }
    const settings = ruleSettings(catalog, id, registry);
    const active = isRuleActive(entry, settings.severity, selection, { id, key });

    rules[key] = {
      create(context) {
        if (!active) return {};
        const repoPath = repoRelative(context.filename);
        const terminal = (kind: "checked" | "skipped", reason?: SkipReason): void => {
          if (traceRunId === null) return;
          if (kind === "checked") {
            emit?.({ kind: "checked", runId: traceRunId, plugin: name, file: repoPath, rule: id });
            return;
          }
          emit?.({
            kind: "skipped",
            runId: traceRunId,
            plugin: name,
            file: repoPath,
            rule: id,
            reason: reason ?? "scope",
          });
        };
        if (matchesAnyGlob(repoPath, ignored)) {
          terminal("skipped", "ignored");
          return {};
        }
        const pathClass = classifyPath(repoPath, catalog.scopes);
        const reason = skipReasonOf(repoPath, pathClass, settings);
        if (reason !== null) {
          terminal("skipped", reason);
          return {};
        }
        const visitors = implementation.create(context, {
          options: settings.options,
          repoPath,
          isTestFile: pathClass === PATH_CLASS.test,
          codeStyle: settings.codeStyle,
          pluginName: name,
        });
        terminal("checked");
        return visitors;
      },
    };
  }

  return { name, rules };
}
