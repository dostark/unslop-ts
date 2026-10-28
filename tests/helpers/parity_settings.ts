/**
 * @module ParitySettingsHelper
 * @path tests/helpers/parity_settings.ts
 * @description The settings of a temporary repository whose production code sits under `packages/`, for the tests of the parity report.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/rules/whole_tree/options.ts]
 */

import type { IUnusedExportsSettings } from "../../src/rules/whole_tree/options.ts";

export const PARITY_SETTINGS: IUnusedExportsSettings = {
  productionRoots: ["packages/"],
  testSegments: ["/tests/"],
  testSuffixes: ["_test.ts"],
  entrypointSuffixes: ["/mod.ts"],
  mainEntrypointSuffixes: ["/main.ts"],
  scriptRoot: "scripts",
  walkSkipPatterns: ["node_modules"],
  strictSkipPrefixes: [],
  strictSkipSegments: [],
};
