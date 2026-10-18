/**
 * @module WholeTreeSettingsTestHelper
 * @path packages/lint-rules/tests/helpers/whole_tree_settings.ts
 * @description Whole-tree settings for the unit tests of the optional-parameter and constant-restatement rules.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/whole_tree/options.ts]
 */

import type { IConstantRestatementSettings, IOptionalParamsSettings } from "../../src/rules/whole_tree/options.ts";

export const OPTIONAL_PARAMS_SETTINGS: IOptionalParamsSettings = {
  wrapperType: "Opt",
  wrapperImport: "lib/types",
  reasonExamples: ["TraceAbsent", "OptionalInput", "OptionalContext"],
  testSegments: ["/tests/"],
  testSuffixes: ["_test.ts"],
  skipSegments: ["/scripts/", "/tests/fixtures/"],
  walkSkipSegments: ["/types/"],
  pluginRuleId: "demo/require-optional-wrapper",
};

export const CONSTANT_RESTATEMENT_SETTINGS: IConstantRestatementSettings = {
  constantModules: ["src/constants.ts"],
  testRoots: ["src", "tests"],
  minRestatedElements: 2,
};
