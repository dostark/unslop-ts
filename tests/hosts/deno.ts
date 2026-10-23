/**
 * @module DenoHostRunner
 * @path tests/hosts/deno.ts
 * @description Runs one rule case on the Deno host and returns its diagnostics in the shared shape.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/helpers/registry.ts, tests_node/hosts/eslint.mjs]
 */

import { createDenoPlugin, runPlugin } from "../../deno.ts";
import { type JsonValue, parseCatalog } from "../../mod.ts";
import { createRuleRegistry } from "../../src/engine/registry.ts";
import { TEST_PLUGIN_NAME, TEST_RULE_PACKS } from "../helpers/registry.ts";

/** One rule case a host runner can execute. */
export interface IHostCase {
  readonly rule: string;
  readonly code: string;
  readonly filename?: string;
  readonly options?: Record<string, JsonValue>;
  readonly pluginName?: string;
}

/** One host diagnostic in the normalized runner shape. */
export interface IHostDiagnostic {
  readonly rule: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

function positionOf(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return { line, column };
}

/** Runs a case through the in-process Deno plugin, the API `deno lint` uses. */
export function runDenoHost(testCase: IHostCase): readonly IHostDiagnostic[] {
  const name = testCase.pluginName ?? TEST_PLUGIN_NAME;
  const id = `${name}/${testCase.rule}`;
  const catalog = {
    version: "1",
    scopes: { test: ["**/*_test.ts", "**/tests/**"], fixture: ["**/tests/fixtures/**"] },
    tagVocabulary: { comments: { description: "Comment discipline." } },
    rules: {
      [id]: {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["comments"],
        ...(testCase.options === undefined ? {} : { options: testCase.options }),
      },
    },
  };
  const registry = createRuleRegistry(name, TEST_RULE_PACKS);
  const plugin = createDenoPlugin(name, parseCatalog(catalog, { scriptRuleSchemas: null, registry }), {
    rulePacks: TEST_RULE_PACKS,
  });
  return runPlugin(plugin, testCase.filename ?? "src/a.ts", testCase.code).map((diagnostic) => ({
    rule: diagnostic.id,
    ...positionOf(testCase.code, diagnostic.range[0]),
    message: diagnostic.message,
  }));
}
