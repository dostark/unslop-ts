/**
 * @module ConfigRegistry
 * @path src/config/registry.ts
 * @description The unique rule index that a descriptor contributes: plugin rules, whole-tree checks, and consumer scripts.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/config/descriptor.ts, src/config/compile.ts, src/rules/whole_tree/checks.ts]
 */

import type { z } from "zod";
import type { IRuleMeta, RuleEngine } from "../rules/meta.ts";
import { WHOLE_TREE_CHECKS, type WholeTreeCheckKey } from "../rules/whole_tree/checks.ts";
import {
  type IProjectDescriptor,
  type IRuleControls,
  type IWholeTreeHostSpec,
  PLUGIN_RULE_CONTROLS,
} from "./descriptor.ts";
import { ConfigError } from "./schema.ts";

/** One rule as the registries declare it. `engine` comes from the registry that owns the id. */
export interface IRegistryEntry {
  readonly id: string;
  readonly engine: RuleEngine;
  readonly meta: IRuleMeta;
  /** Null means the rule accepts no options. */
  readonly optionSchema: z.ZodTypeAny | null;
  readonly controls: IRuleControls;
  /** The host command that runs a check or script, or null for a plugin rule. */
  readonly command: readonly string[] | null;
  /** True when the engine owns the docs anchor, so `docsBase` applies. */
  readonly engineOwned: boolean;
}

/** The whole-tree checks a consumer descriptor may specialize. */
const SPECIALIZABLE_CHECKS: ReadonlySet<string> = new Set(["duplicate-type", "duplicate-constant"]);

function addEntry(index: Map<string, IRegistryEntry>, entry: IRegistryEntry, source: string): void {
  const existing = index.get(entry.id);
  if (existing) {
    throw new ConfigError(source, `rule id '${entry.id}' collides with a registered ${existing.engine} rule`);
  }
  index.set(entry.id, entry);
}

function pluginEntries(descriptor: IProjectDescriptor, index: Map<string, IRegistryEntry>): void {
  for (const pack of descriptor.packs) {
    for (const [key, rule] of Object.entries(pack.rules)) {
      if (key.includes("/")) {
        throw new ConfigError(`packs.${pack.name}`, `plugin rule key '${key}' must not contain '/'`);
      }
      addEntry(
        index,
        {
          id: `${descriptor.pluginName}/${key}`,
          engine: "plugin",
          meta: rule.meta,
          optionSchema: pack.optionSchemas[key] ?? null,
          controls: PLUGIN_RULE_CONTROLS,
          command: null,
          engineOwned: true,
        },
        `packs.${pack.name}`,
      );
    }
  }
}

function hostSpecFor(descriptor: IProjectDescriptor, id: string): IWholeTreeHostSpec | undefined {
  return SPECIALIZABLE_CHECKS.has(id) ? descriptor.wholeTreeHosts[id] : undefined;
}

function validateHostOverrides(descriptor: IProjectDescriptor): void {
  for (const id of Object.keys(descriptor.wholeTreeHosts)) {
    if (!(id in WHOLE_TREE_CHECKS)) {
      throw new ConfigError(`wholeTreeHosts.${id}`, "no whole-tree check has this id");
    }
    if (!SPECIALIZABLE_CHECKS.has(id)) {
      throw new ConfigError(
        `wholeTreeHosts.${id}`,
        "only duplicate-type and duplicate-constant accept a host override",
      );
    }
  }
}

function wholeTreeEntries(descriptor: IProjectDescriptor, index: Map<string, IRegistryEntry>): void {
  for (const [key, check] of Object.entries(WHOLE_TREE_CHECKS)) {
    const id = key as WholeTreeCheckKey;
    const host = hostSpecFor(descriptor, id);
    addEntry(
      index,
      {
        id,
        engine: "whole-tree",
        meta: check.meta,
        optionSchema: check.optionSchema,
        controls: host?.controls ?? check.controls,
        command: host?.command ?? check.command,
        engineOwned: true,
      },
      `wholeTreeHosts.${id}`,
    );
  }
}

function scriptEntries(descriptor: IProjectDescriptor, index: Map<string, IRegistryEntry>): void {
  for (const [id, spec] of Object.entries(descriptor.scriptRules)) {
    addEntry(
      index,
      {
        id,
        engine: "script",
        meta: spec.meta,
        optionSchema: spec.optionSchema,
        controls: spec.controls,
        command: spec.command,
        engineOwned: false,
      },
      `scriptRules.${id}`,
    );
  }
}

/** Builds the unique engine and consumer rule index, rejecting collisions and unknown host overrides. */
export function buildRegistryIndex(descriptor: IProjectDescriptor): ReadonlyMap<string, IRegistryEntry> {
  validateHostOverrides(descriptor);
  const index = new Map<string, IRegistryEntry>();
  pluginEntries(descriptor, index);
  wholeTreeEntries(descriptor, index);
  scriptEntries(descriptor, index);
  return index;
}
