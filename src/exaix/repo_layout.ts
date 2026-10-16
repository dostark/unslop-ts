/**
 * @module RepoLayout
 * @path packages/lint-rules/src/exaix/repo_layout.ts
 * @description Repository path tokens the Exaix rule scripts read from the catalog.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [packages/lint-rules/mod.ts, packages/lint-rules/src/exaix/check_code_style.ts]
 */

import catalogJson from "../../../../scripts/config/style_rule_catalog.json" with { type: "json" };

/** Repository path tokens, defined once in the catalog's `layout` section. */
export interface IRepoLayout {
  readonly packageRoot: string;
  readonly appRoot: string;
  readonly teamRoot: string;
  readonly enterpriseRoot: string;
  readonly testsRoot: string;
  readonly scriptsRoot: string;
  readonly srcRoot: string;
  readonly testsSegment: string;
  readonly testingSegment: string;
  readonly srcSegment: string;
  readonly scriptsSegment: string;
  readonly copilotSegment: string;
  readonly fixturesSegment: string;
  readonly tuiSrcSegment: string;
  readonly tuiTestsSegment: string;
  readonly tuiTestDirSegment: string;
  readonly tuiPackageTestsSegment: string;
  readonly rootTestHelpers: string;
  readonly testingPackageRoot: string;
  readonly testingPackageRootBare: string;
  readonly aiTestAllow: string;
  readonly mcpServerPrefix: string;
  readonly mcpTestsPrefix: string;
  readonly markdownCompatSuffix: string;
  readonly packageRootPattern: string;
  readonly editionAppPrefixes: readonly string[];
  readonly teamAppBootstrap: string;
  readonly retiredRootHeaderRelatedFiles: readonly string[];
  readonly retiredRootImportPaths: readonly string[];
  readonly layerLeakExempt: readonly { readonly path: string; readonly reason: string }[];
}

export const LAYOUT: IRepoLayout = catalogJson.layout;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `^packages/<name>/mod.ts|index.ts$` — package root entrypoint. */
export const RE_PACKAGE_ROOT_ENTRYPOINT = new RegExp(
  `^${escapeRegExp(LAYOUT.packageRoot)}[^/]+/(mod|index)\\.ts$`,
);
/** `^packages/<name>/tests/helpers/` — package-local test helper. */
export const RE_PACKAGE_TEST_HELPERS = new RegExp(
  `^${escapeRegExp(LAYOUT.packageRoot)}[^/]+/${escapeRegExp(LAYOUT.testsRoot)}helpers/`,
);
/** `^packages/<name>/tests/` with the package name captured. */
export const RE_PACKAGE_TESTS_CAPTURE = new RegExp(
  `^${escapeRegExp(LAYOUT.packageRoot)}([^/]+)/${escapeRegExp(LAYOUT.testsRoot)}`,
);
/** `^packages/<name>` with the package name captured. */
export const RE_PACKAGE_NAME_CAPTURE = new RegExp(`^${escapeRegExp(LAYOUT.packageRoot)}([^/]+)`);
/** `^packages/<name>/src/` with the package name captured. */
export const RE_PACKAGE_SRC_CAPTURE = new RegExp(
  `^${escapeRegExp(LAYOUT.packageRoot)}([^/]+)/${escapeRegExp(LAYOUT.srcRoot)}`,
);
