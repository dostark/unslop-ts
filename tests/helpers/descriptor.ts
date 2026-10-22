/**
 * @module ProjectDescriptorTestHelper
 * @path tests/helpers/descriptor.ts
 * @description Builds configuration-independent project descriptors for the compiler and CLI tests.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/config/descriptor.ts, tests/helpers/registry.ts]
 */

import { DENO_RULE_PACK, type IProjectDescriptor, type IRulePack, TYPESCRIPT_RULE_PACK } from "../../mod.ts";
import { TEST_PLUGIN_NAME } from "./registry.ts";

export interface ITestDescriptorOptions {
  readonly packs?: readonly IRulePack[];
  readonly scriptRules?: IProjectDescriptor["scriptRules"];
  readonly wholeTreeHosts?: IProjectDescriptor["wholeTreeHosts"];
}

const ROOT_URL = new URL("file:///project/");
const ENGINE_PACKS: readonly IRulePack[] = [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK];

/** A descriptor for the engine packs in a project named `demo`, with no consumer extension by default. */
export function testDescriptor(options?: ITestDescriptorOptions): IProjectDescriptor {
  return {
    pluginName: TEST_PLUGIN_NAME,
    rootUrl: ROOT_URL,
    configUrl: new URL("unslop.config.json", ROOT_URL),
    lintConfigUrl: new URL("deno.json", ROOT_URL),
    pluginUrl: new URL("lint_plugin.ts", ROOT_URL),
    packs: options?.packs ?? ENGINE_PACKS,
    scriptRules: options?.scriptRules ?? {},
    wholeTreeHosts: options?.wholeTreeHosts ?? {},
  };
}
