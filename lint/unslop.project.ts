/**
 * @module SelfLintProject
 * @path lint/unslop.project.ts
 * @description Descriptor of the engine's own lint project for the dogfood preset.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [lint/plugin.ts, lint/unslop.config.json]
 */

import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "../mod.ts";

const rootUrl = new URL("../", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "self",
  rootUrl,
  configUrl: new URL("lint/unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("lint/plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {},
};
