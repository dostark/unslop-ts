/**
 * @module CheckCodeStyleRulesTest
 * @path packages/lint-rules/tests/check_code_style_rules_test.ts
 * @description Named valid and invalid case per style rule id, grouped by tag.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/exaix/check_code_style.ts, packages/lint-rules/tests/check_code_style_catalog_parity_test.ts]
 */

import { assertEquals } from "@std/assert";
import { parseCatalog } from "@exaix/lint-rules";
import { checkSource } from "../src/exaix/check_code_style.ts";
import catalogJson from "../../../scripts/config/style_rule_catalog.json" with { type: "json" };

const catalog = parseCatalog(catalogJson);
const ROOT = Deno.cwd();
const abs = (rel: string) => `${ROOT}/${rel}`;
const PROD = abs("packages/x/src/sample.ts");
const TEST = abs("packages/x/tests/sample_test.ts");
const SCRIPT = abs("scripts/sample_tool.ts");

interface IRuleCase {
  readonly id: string;
  readonly invalid: string;
  readonly valid: string;
  readonly path?: string;
}

const HEADER = "/**\n * @module Sample\n * @path packages/x/src/sample.ts\n * @description Sample module.\n */\n";

const CASES: IRuleCase[] = [
  // type-safety
  {
    id: "promise-response-alias",
    invalid: "export type A = Promise<Response>;\n",
    valid: "export type A = Promise<string>;\n",
  },
  {
    id: "promise-response-return",
    invalid: "export function f(): Promise<Response> {\n  return fetch('x');\n}\n",
    valid: "export function f(): Promise<string> {\n  return Promise.resolve('');\n}\n",
  },
  {
    id: "ts-suppression-pragmas",
    invalid: "// @ts-ignore\nexport const a = 1;\n",
    valid: "export const a = 1;\n",
  },
  {
    id: "deno-lint-no-explicit-any",
    invalid: "// deno-lint-ignore no-explicit-any\nexport const a = 1;\n",
    valid: "export const a = 1;\n",
  },

  // imports
  {
    id: "import-inside-statement",
    invalid: "export function f() {\n  return import('./a.ts');\n}\n",
    valid: "export const a = 1;\n",
  },
  { id: "dynamic-import", invalid: "export const p = import('./a.ts');\n", valid: "export const a = 1;\n" },
  {
    id: "inline-type-import",
    invalid: "export function f(x: import('./a.ts').IFoo): void {}\n",
    valid: "export function f(x: string): void {}\n",
  },
  { id: "re-export-imported", invalid: "export { Foo } from './foo.ts';\n", valid: "export const x = 1;\n" },
  {
    id: "package-entrypoint-root-src-reexport",
    invalid: "export { Foo } from '../src/foo.ts';\n",
    valid: "export { Foo } from './foo.ts';\n",
    path: abs("packages/x/mod.ts"),
  },
  {
    id: "no-interface-rename-on-import",
    invalid: "import { IFoo as Foo } from './foo.ts';\nexport const x = Foo;\n",
    valid: "import { IFoo } from './foo.ts';\nexport const x: IFoo = { a: 1 };\n",
  },

  // module-structure
  { id: "module-header", invalid: "export const a = 1;\n", valid: HEADER + "export const a = 1;\n" },
  {
    id: "module-header-tag",
    invalid: "/**\n * @module Sample\n * @path packages/x/src/sample.ts\n */\nexport const a = 1;\n",
    valid: HEADER + "export const a = 1;\n",
  },
  {
    id: "exported-interface-naming",
    invalid: "export interface Foo { a: string }\n",
    valid: "export interface IFoo { a: string }\n",
  },
  {
    id: "exported-interface-placement",
    invalid: "export function f(): number {\n  return 1;\n}\nexport interface IFoo { a: string }\n",
    valid: "export interface IFoo { a: string }\nexport function f(): number {\n  return 1;\n}\n",
  },
  {
    id: "max-params",
    invalid:
      "export function f(a: number, b: number, c: number, d: number, e: number, g: number, h: number, i: number): number {\n  return a + b + c + d + e + g + h + i;\n}\n",
    valid: "export function f(a: number, b: number): number {\n  return a + b;\n}\n",
  },

  // comments
  {
    id: "long-comment",
    invalid: "export const x = 1;\n/**\n * one\n * two\n * three\n * four\n */\nexport const y = 2;\n",
    valid: "export const x = 1;\n/**\n * one\n */\nexport const y = 2;\n",
  },
  {
    id: "ephemeral-comment",
    invalid: "export const x = 1;\n// phase 5 did this\n",
    valid: "export const x = 1;\n// plain note\n",
  },
  {
    id: "decorative-comment",
    invalid: "export const x = 1;\n// ==========\n",
    valid: "export const x = 1;\n// plain note\n",
  },

  // magic-values
  {
    id: "magic-union-type",
    invalid: 'export const x: "a" | "b" = "a";\n',
    valid: 'export type T = "a" | "b";\nexport const x: T = "a";\n',
  },

  // scripts
  {
    id: "script-shebang",
    invalid: "/**\n * @module S\n * @path scripts/sample_tool.ts\n * @description d.\n */\nexport const a = 1;\n",
    valid: "#!/usr/bin/env -S deno run -A\n/**\n * @module S\n * @description d.\n */\nexport const a = 1;\n",
    path: SCRIPT,
  },
  {
    id: "script-usage",
    invalid: "#!/usr/bin/env -S deno run -A\n/**\n * @module S\n * @description d.\n */\nexport const a = 1;\n",
    valid:
      "#!/usr/bin/env -S deno run -A\n/**\n * @module S\n * @description d.\n *\n * Usage:\n *   deno run -A scripts/sample_tool.ts\n */\nexport const a = 1;\n",
    path: SCRIPT,
  },
  {
    id: "script-placement",
    invalid:
      "#!/usr/bin/env -S deno run -A\n/**\n * @module S\n * @path scripts/debug_sample.ts\n * @description d.\n *\n * Usage:\n *   deno run -A scripts/debug_sample.ts\n */\nexport const a = 1;\n",
    valid: "export const a = 1;\n",
    path: abs("scripts/debug_sample.ts"),
  },

  // edition
  {
    id: "edition-conditional-outside-composer",
    invalid: "export const s = edition === 'solo';\n",
    valid: "export const a = 1;\n",
  },
  {
    id: "edition-leak",
    invalid: "import { X } from '@exaix-team/voting';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
  },

  // boundary / tui / cli
  {
    id: "tui-boundary-cli",
    invalid: "import { X } from '../../cli/x.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("apps/tui/src/sample.ts"),
  },
  {
    id: "tui-boundary-services",
    invalid: "import { X } from '../../services/x.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("apps/tui/src/sample.ts"),
  },
  {
    id: "tui-boundary-config",
    invalid: "import { X } from '../../config/x.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("apps/tui/src/sample.ts"),
  },
  {
    id: "tui-boundary-helpers",
    invalid: "import { X } from '../../../helpers/x.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("apps/tui/src/views/sample.ts"),
  },
  {
    id: "core-boundary-tui-helpers",
    invalid: "import { X } from '../../tui/helpers/x.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("packages/x/src/sample.ts"),
  },
  {
    id: "cli-boundary-services",
    invalid: "import { X } from '../../services/x.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("apps/exactl/src/commands/sample.ts"),
  },
  {
    id: "cli-boundary-config",
    invalid: "import { X } from '../../config/service.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("apps/exactl/src/commands/sample.ts"),
  },
  {
    id: "core-boundary-cli-helpers",
    invalid: "import { X } from '../../../apps/exactl/src/helpers/x.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("packages/x/src/sample.ts"),
  },

  // package
  {
    id: "package-boundary",
    invalid: "import { X } from '../../other/src/x.ts';\nexport const a = X;\n",
    valid: "import { X } from './sibling.ts';\nexport const a = X;\n",
  },
  {
    id: "package-src-boundary",
    invalid: "import { X } from '../../../src/services/core/db.ts';\nexport const a = X;\n",
    valid: "import { X } from './sibling.ts';\nexport const a = X;\n",
  },
  {
    id: "package-related-files-boundary",
    invalid:
      "/**\n * @module Sample\n * @path packages/x/src/sample.ts\n * @description d.\n * @related-files [src/services/core/db.ts]\n */\nexport const a = 1;\n",
    valid: HEADER + "export const a = 1;\n",
  },
  {
    id: "package-subpath-promotion",
    invalid: "export * from './src/status/mod.ts';\n",
    valid: "export const X = 1;\n",
    path: abs("packages/core/mod.ts"),
  },
  {
    id: "package-testing-import",
    invalid: "import { X } from '../../git/tests/helpers/constants.ts';\nexport const a = X;\n",
    valid: "export const a = 1;\n",
    path: abs("packages/x/tests/sample_test.ts"),
  },
  {
    id: "package-canonical-import",
    invalid: "import { X } from '../../core/src/types/mod.ts';\nexport const a = X;\n",
    valid: "import { X } from '@exaix/core/types';\nexport const a = X;\n",
  },
  {
    id: "package-instantiates-event-logger",
    invalid: "export const a = new EventLogger('x');\n",
    valid: "export const a = 1;\n",
  },
  {
    id: "package-concrete-logger-type",
    invalid: "import { EventLogger } from '@exaix/core/runtime';\nexport const a = EventLogger;\n",
    valid: "export const a = 1;\n",
  },
  {
    id: "package-uses-config-reader",
    invalid: "export const a = new ConfigService();\n",
    valid: "export const a = 1;\n",
  },

  // test-quality
  {
    id: "test-inline-multiline-fixture",
    invalid: "const markdown = `\n# Title\nline two\nline three\nline four\nline five\nline six\nline seven\n`;\n",
    valid: "export const a = 1;\n",
    path: TEST,
  },

  // boundary
  {
    id: "concrete-cross-domain",
    invalid: "import { ExecutionLoop } from '@exaix/execution';\nexport const a = new ExecutionLoop();\n",
    valid: "export const a = 1;\n",
    path: abs("packages/flow/src/sample.ts"),
  },
  {
    id: "layer-constant-leak",
    invalid: "import { DEFAULT_MCP_TIMEOUT } from '@exaix/mcp';\nexport const a = DEFAULT_MCP_TIMEOUT;\n",
    valid: "export const a = 1;\n",
    path: abs("packages/flow/src/sample.ts"),
  },
  {
    id: "import-placement",
    invalid: "export const a = 1;\nexport const b = 2;\nimport { z } from './z.ts';\nexport const c = z;\n",
    valid: "import { z } from './z.ts';\nexport const c = z;\n",
  },
];

for (const testCase of CASES) {
  const path = testCase.path ?? PROD;
  Deno.test(`${testCase.id}: invalid case is reported`, () => {
    const findings = checkSource(path, testCase.invalid, catalog).filter((f) => f.rule === testCase.id);
    assertEquals(findings.length >= 1, true, `expected ${testCase.id} to fire on the invalid case`);
  });

  Deno.test(`${testCase.id}: valid case is not reported`, () => {
    const findings = checkSource(path, testCase.valid, catalog).filter((f) => f.rule === testCase.id);
    assertEquals(findings.length, 0, `expected ${testCase.id} not to fire on the valid case`);
  });
}

// Whole-tree script rules have dedicated test files rather than a per-file case.
const WHOLE_TREE_RULE_IDS = new Set(["duplicate-constant", "duplicate-type"]);

Deno.test("every implemented script rule id has a named case", () => {
  const withCases = new Set(CASES.map((c) => c.id));
  const missing = [...Object.entries(catalog.rules)]
    .filter(([id, entry]) => entry.engine === "script" && !withCases.has(id) && !WHOLE_TREE_RULE_IDS.has(id))
    .map(([id]) => id);
  assertEquals(missing, []);
});
