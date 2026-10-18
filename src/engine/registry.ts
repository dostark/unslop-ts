/**
 * @module RuleRegistry
 * @path packages/lint-rules/src/engine/registry.ts
 * @description Resolves catalog rule ids to rule implementations and option schemas from the rule packs a consumer registers.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [packages/lint-rules/src/engine/plugin.ts, packages/lint-rules/src/engine/catalog.ts, packages/lint-rules/src/rules/types.ts]
 */

import type { z } from "zod";
import type { IPluginRule } from "../rules/types.ts";

/** A set of rules a consumer registers with the engine. Keys are bare rule keys, such as `no-runtime-typeof`. */
export interface IRulePack {
  /** Names the pack in registry errors. */
  readonly name: string;
  readonly rules: Readonly<Record<string, IPluginRule>>;
  /** One option schema for each rule key. */
  readonly optionSchemas: Readonly<Record<string, z.ZodTypeAny>>;
}

/** Resolves catalog ids of the form `<pluginName>/<ruleKey>` to the rules of the registered packs. */
export interface IRuleRegistry {
  readonly pluginName: string;
  /** The rule for a catalog id, or null when no pack defines it or the id has another plugin name. */
  implementation(catalogId: string): IPluginRule | null;
  /** The option schema for a catalog id, or null under the same conditions. */
  optionSchema(catalogId: string): z.ZodTypeAny | null;
  /** Every catalog id the registered packs define, in registration order. */
  catalogIds(): readonly string[];
}

/** Thrown when the packs given to {@link createRuleRegistry} are inconsistent. */
export class RuleRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleRegistryError";
  }
}

/** Throws when a pack lacks an option schema for a rule, or holds a schema for no rule. */
function validatePack(pack: IRulePack): void {
  for (const key of Object.keys(pack.rules)) {
    if (!(key in pack.optionSchemas)) {
      throw new RuleRegistryError(`pack '${pack.name}' defines rule '${key}' without an option schema`);
    }
  }
  for (const key of Object.keys(pack.optionSchemas)) {
    if (!(key in pack.rules)) {
      throw new RuleRegistryError(`pack '${pack.name}' defines an option schema for '${key}' but no rule`);
    }
  }
}

/** Builds the registry for one plugin name. A rule key that two packs define throws a {@link RuleRegistryError}. */
export function createRuleRegistry(pluginName: string, packs: readonly IRulePack[]): IRuleRegistry {
  const rules = new Map<string, IPluginRule>();
  const schemas = new Map<string, z.ZodTypeAny>();
  const owners = new Map<string, string>();
  for (const pack of packs) {
    validatePack(pack);
    for (const [key, rule] of Object.entries(pack.rules)) {
      const owner = owners.get(key);
      if (owner !== undefined) {
        throw new RuleRegistryError(`rule '${key}' is defined by pack '${owner}' and by pack '${pack.name}'`);
      }
      owners.set(key, pack.name);
      rules.set(key, rule);
      schemas.set(key, pack.optionSchemas[key]);
    }
  }

  const prefix = `${pluginName}/`;
  const keyOf = (catalogId: string): string | null =>
    catalogId.startsWith(prefix) ? catalogId.slice(prefix.length) : null;

  return {
    pluginName,
    implementation(catalogId: string): IPluginRule | null {
      const key = keyOf(catalogId);
      return key === null ? null : rules.get(key) ?? null;
    },
    optionSchema(catalogId: string): z.ZodTypeAny | null {
      const key = keyOf(catalogId);
      return key === null ? null : schemas.get(key) ?? null;
    },
    catalogIds(): readonly string[] {
      return [...rules.keys()].map((key) => `${prefix}${key}`);
    },
  };
}
