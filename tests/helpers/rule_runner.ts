/**
 * @module RuleRunnerTestHelper
 * @path tests/helpers/rule_runner.ts
 * @description Runs one catalogued plugin rule over a source and returns its findings with line numbers.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/helpers/registry.ts]
 */

import { type JsonValue, runPlugin } from "../../mod.ts";
import { createTestPlugin, loadTestCatalog, TEST_PLUGIN_NAME } from "./registry.ts";

export interface IRuleFinding {
  readonly line: number;
  readonly message: string;
  readonly hint: string;
}

export interface IRuleRun {
  readonly source: string;
  readonly filename: string;
  readonly options: Record<string, JsonValue>;
  /** Path globs the catalog entry limits the rule to. */
  readonly include?: readonly string[];
}

const DEFAULT_FILENAME = "packages/x/src/a.ts";
const NEWLINE = "\n";

/** A run of `source` at the default path with no options. */
export function plainRun(source: string): IRuleRun {
  return { source, filename: DEFAULT_FILENAME, options: {} };
}

/** A run at the given path with options. */
export function runAt(source: string, filename: string, options: Record<string, JsonValue>): IRuleRun {
  return { source, filename, options };
}

function catalogFor(
  key: string,
  options: Record<string, JsonValue>,
  include: readonly string[] | undefined,
): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: { test: ["**/tests/**", "**/*_test.ts"], fixture: ["**/tests/fixtures/**"] },
    tagVocabulary: { "module-structure": { description: "Rules about module layout." } },
    rules: {
      [`${TEST_PLUGIN_NAME}/${key}`]: {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["module-structure"],
        options,
        ...(include ? { include: [...include] } : {}),
      },
    },
  };
}

/** The findings of the rule `key` on one run, in source order. */
export function findingsOf(key: string, run: IRuleRun): IRuleFinding[] {
  const plugin = createTestPlugin(loadTestCatalog(catalogFor(key, run.options, run.include)));
  return runPlugin(plugin, run.filename, run.source).map((diagnostic) => ({
    line: run.source.slice(0, diagnostic.range[0]).split(NEWLINE).length,
    message: diagnostic.message,
    hint: diagnostic.hint ?? "",
  }));
}

/** The lines of the findings of the rule `key`. */
export function linesOf(key: string, run: IRuleRun): number[] {
  return findingsOf(key, run).map((finding) => finding.line);
}
