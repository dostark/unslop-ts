/**
 * @module BundleEngine
 * @path src/bundle/engine.ts
 * @description Library entry for the prebuilt Deno bundle: the Deno plugin factory, catalog, registry, and packs.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [deno.ts, mod.ts, scripts/bundle.ts]
 */

export { createDenoPlugin, createUnslopProject } from "../../deno.ts";
export { CatalogError, parseCatalog } from "../engine/catalog.ts";
export type { ICatalog } from "../engine/catalog.ts";
export { createRuleRegistry } from "../engine/registry.ts";
export type { IRulePack, IRuleRegistry } from "../engine/registry.ts";
export { compileConfig } from "../config/compile.ts";
export type { ICompiledConfig, IProjectDescriptor } from "../config/descriptor.ts";
export { PRESETS } from "../config/presets.ts";
export { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../rules/mod.ts";
export type { IPluginRule } from "../rules/types.ts";
