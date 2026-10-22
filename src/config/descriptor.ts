/**
 * @module ProjectDescriptor
 * @path src/config/descriptor.ts
 * @description Configuration-independent project input and the resolved-rule model that the compiler emits.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/rules/meta.ts, src/engine/catalog.ts, src/engine/registry.ts]
 */

import type { z } from "zod";
import type { ICatalog, JsonValue, RuleScope, RuleSeverity } from "../engine/catalog.ts";
import type { IRulePack } from "../engine/registry.ts";
import type { IRuleMeta, RuleEngine } from "../rules/meta.ts";

/** A field that a named host actually reads, so an edit command may change it. */
export type RuleControl = "level" | "scope" | "include" | "exclude" | "options";

/** What an owner lets a user change, and which host flags fix the runtime severity. */
export interface IRuleControls {
  readonly editable: readonly RuleControl[];
  readonly fixedLevel: RuleSeverity | null;
  readonly fixedScope: RuleScope | null;
  readonly fixedInclude: readonly string[] | null;
  readonly fixedExclude: readonly string[] | null;
  readonly hostModes: Readonly<Record<string, RuleSeverity>>;
}

/** Where an emitted catalog field came from. */
export type RuleOrigin = `preset:${string}` | `config:rules.${string}` | "default";

/** The origin of each field an emitted rule entry carries. */
export interface IRuleSources {
  readonly fields: Readonly<Record<string, RuleOrigin>>;
}

/** A consumer script rule the project registers beside the engine packs. */
export interface IScriptRuleSpec {
  readonly meta: IRuleMeta;
  /** Null means the script accepts no options; `{}` is then the only valid value. */
  readonly optionSchema: z.ZodTypeAny | null;
  readonly controls: IRuleControls;
  /** The host command that runs the script. */
  readonly command: readonly string[];
}

/** A consumer override of a whole-tree check's applicability and command. */
export interface IWholeTreeHostSpec {
  readonly controls: IRuleControls;
  readonly command: readonly string[];
}

/** The configuration-independent project input. It never imports a plugin instance or the config file. */
export interface IProjectDescriptor {
  readonly pluginName: string;
  /** The project root. Reserved for the Phase 232 Step 2 run binding; no Phase 231 reader. */
  readonly rootUrl: URL;
  readonly configUrl: URL;
  /** The lint config. Reserved for the Phase 232 Step 2 run binding; no Phase 231 reader. */
  readonly lintConfigUrl: URL;
  /** The plugin entry. Reserved for the Phase 232 Step 2 run binding; no Phase 231 reader. */
  readonly pluginUrl: URL;
  readonly packs: readonly IRulePack[];
  readonly scriptRules: Readonly<Record<string, IScriptRuleSpec>>;
  readonly wholeTreeHosts: Readonly<Record<string, IWholeTreeHostSpec>>;
}

/** One rule as the configuration resolves it. */
export interface IResolvedRule {
  readonly id: string;
  readonly engine: RuleEngine;
  readonly meta: IRuleMeta;
  readonly configuredLevel: RuleSeverity;
  /** Equal to `configuredLevel` here; selection-aware commands compute their own view. */
  readonly effectiveLevel: RuleSeverity;
  readonly configuredOptions: Readonly<Record<string, JsonValue>>;
  /** Engine defaults, or null when parsing them needs project input. */
  readonly defaultOptions: Readonly<Record<string, JsonValue>> | null;
  readonly effectiveOptions: Readonly<Record<string, JsonValue>> | null;
  readonly scope: RuleScope;
  readonly include: readonly string[] | null;
  readonly exclude: readonly string[] | null;
  readonly optIn: boolean;
  readonly reason: string | null;
  /** Consumer script exclusion codes; null for an engine-owned rule. */
  readonly exclusionCodes: Readonly<Record<string, string>> | null;
  readonly docs: string;
  readonly tags: readonly string[];
  /** The engine owner's limit, before an authored override. */
  readonly defaultLimits: string | null;
  readonly controls: IRuleControls;
  readonly command: readonly string[] | null;
  readonly sources: IRuleSources;
}

/** The legacy catalog plus the resolved index that the CLI reads. */
export interface ICompiledConfig {
  readonly catalog: ICatalog;
  readonly rules: Readonly<Record<string, IResolvedRule>>;
}

/** The host mode a check runs in when no host flag changes it. */
export const DEFAULT_HOST_MODE = "default";

/** The severity a host reports in its default mode, unless the owner fixes the level. */
export function hostBaseLevel(controls: IRuleControls): RuleSeverity {
  return controls.fixedLevel ?? controls.hostModes[DEFAULT_HOST_MODE] ?? "off";
}

/** The editable controls of every plugin rule. `deno lint` reports a selected plugin finding as an error. */
export const PLUGIN_RULE_CONTROLS: IRuleControls = {
  editable: ["level", "scope", "include", "exclude", "options"],
  fixedLevel: null,
  fixedScope: null,
  fixedInclude: null,
  fixedExclude: null,
  hostModes: { [DEFAULT_HOST_MODE]: "error" },
};
