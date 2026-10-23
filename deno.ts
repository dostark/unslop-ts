/**
 * @module DenoHost
 * @path deno.ts
 * @description Deno host entry point: the Deno lint plugin factory, the project builder, and the in-process runner.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [mod.ts, src/engine/rule_gate.ts, src/engine/run_plugin.ts]
 */

import { compileConfig } from "./src/config/compile.ts";
import type { ICompiledConfig, IProjectDescriptor } from "./src/config/descriptor.ts";
import {
  CatalogError,
  classifyPath,
  type ICatalog,
  type JsonValue,
  PATH_CLASS,
  requireRegisteredPluginRules,
  ruleSettings,
} from "./src/engine/catalog.ts";
import { matchesAnyGlob } from "./src/engine/glob.ts";
import { createRuleRegistry, type IRulePack } from "./src/engine/registry.ts";
import { isRuleActive, parseSelection, repoRelative, selectionEnvName, skipReasonOf } from "./src/engine/rule_gate.ts";
import {
  formatTraceRecord,
  INTERNAL_COVERAGE_RULE,
  type ITraceRecord,
  resolveTraceRunId,
  type SkipReason,
  traceEnvName,
} from "./src/engine/trace.ts";

export { runPlugin } from "./src/engine/run_plugin.ts";

/** Rule packs the plugin factory registers. */
export interface ILintPluginOptions {
  readonly rulePacks: readonly IRulePack[];
  /** A selection list that replaces the selection variable, so a caller need not change the process environment. */
  readonly selection?: string;
  /** A trace run id that replaces the trace variable, so a caller need not change the process environment. */
  readonly trace?: string;
}

/** Reads a variable the host may forbid, so a sandboxed run disables the feature instead of failing. */
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Builds the Deno lint plugin. An inactive rule stays registered and returns no visitors, so Deno treats its ignores as known. */
export function createDenoPlugin(name: string, catalog: ICatalog, options: ILintPluginOptions): Deno.lint.Plugin {
  const registry = createRuleRegistry(name, options.rulePacks);
  requireRegisteredPluginRules(catalog, registry);
  const envName = selectionEnvName(name);
  const selection = parseSelection(options.selection ?? readEnv(envName) ?? "");
  if (selection) {
    console.error(`[${name}-lint] ${envName} active: ${[...selection].join(", ")}`);
  }

  const ignored = (catalog.ignore ?? []).map((entry) => entry.glob);
  const reservedId = `${name}/${INTERNAL_COVERAGE_RULE}`;
  if (registry.catalogIds().includes(reservedId)) {
    throw new CatalogError(`rules.${reservedId}`, "the rule key 'internal-coverage' is reserved for trace observation");
  }
  const traceRunId = resolveTraceRunId(options.trace, readEnv(traceEnvName(name)));
  const emit = traceRunId === null ? null : (record: ITraceRecord) => console.error(formatTraceRecord(record));
  const rules: Record<string, Deno.lint.Rule> = {};
  if (traceRunId !== null) {
    rules[INTERNAL_COVERAGE_RULE] = {
      create(context) {
        emit?.({
          kind: "observed",
          runId: traceRunId,
          plugin: name,
          file: repoRelative(context.filename, Deno.cwd()),
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
        const repoPath = repoRelative(context.filename, Deno.cwd());
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

/** The input of {@link createUnslopProject}. */
export interface IUnslopProjectInput {
  readonly descriptor: IProjectDescriptor;
  readonly config: JsonValue;
}

/** A configured project: the descriptor, its compiled model, and the plugin Deno lint loads. */
export interface IUnslopProject {
  readonly descriptor: IProjectDescriptor;
  readonly compiled: ICompiledConfig;
  readonly plugin: Deno.lint.Plugin;
}

/** Compiles a configuration and builds its lint plugin. The entry file exports the result of this call. */
export function createUnslopProject(input: IUnslopProjectInput): IUnslopProject {
  const compiled = compileConfig(input.config, input.descriptor);
  const plugin = createDenoPlugin(input.descriptor.pluginName, compiled.catalog, {
    rulePacks: input.descriptor.packs,
  });
  return { descriptor: input.descriptor, compiled, plugin };
}
