/**
 * @module ExampleProjectDescriptor
 * @path examples/unslop.project.ts
 * @description Configuration-independent descriptor of the example project: its plugin name, packs, and file locations.
 * @architectural-layer Example
 * @dependencies [@dostark/unslop-ts]
 * @related-files [examples/lint_plugin.ts, examples/unslop.config.json, tests/project_descriptor_test.ts]
 *
 * Usage:
 *   Import `descriptor` when the version 2 configuration is absent or invalid. It compiles nothing and reads no file.
 */

import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("../", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("examples/unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("examples/lint_plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {},
};
