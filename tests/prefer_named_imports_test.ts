/**
 * @module PreferNamedImportsTest
 * @path tests/prefer_named_imports_test.ts
 * @description Positive, negative, and pragma cases for the prefer-named-imports rule.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/rules/prefer_named_imports.ts, src/rules/mod.ts]
 */

import { assertEquals } from "@std/assert";
import { findingsOf, linesOf, plainRun, runAt } from "./helpers/rule_runner.ts";

const RULE = "prefer-named-imports";
const NAMESPACE = 'import * as M from "./a.ts";\n';
const MEMBERS = "\nexport const value = M.alpha + M.beta;\n";

Deno.test("prefer-named-imports reports a namespace read only through static members", () => {
  assertEquals(linesOf(RULE, plainRun(NAMESPACE + MEMBERS)), [1]);
});

Deno.test("prefer-named-imports suggests the named import", () => {
  const [finding] = findingsOf(RULE, plainRun(NAMESPACE + MEMBERS));
  assertEquals(finding.message.includes("alpha, beta"), true);
  assertEquals(finding.hint, 'import { alpha, beta } from "./a.ts";');
});

Deno.test("prefer-named-imports reports a type namespace import", () => {
  const code = 'import type * as T from "./a.ts";\n\nexport const value: T.Kind = "a";\n';
  assertEquals(linesOf(RULE, plainRun(code)), [1]);
});

Deno.test("prefer-named-imports skips a spread use of the namespace", () => {
  assertEquals(linesOf(RULE, plainRun(NAMESPACE + "\nexport const value = { ...M };\n")), []);
});

Deno.test("prefer-named-imports skips a computed member access", () => {
  assertEquals(linesOf(RULE, plainRun(NAMESPACE + "\ndeclare const key: string;\nexport const value = M[key];\n")), []);
});

Deno.test("prefer-named-imports skips a whole-object use of the namespace", () => {
  assertEquals(linesOf(RULE, plainRun(NAMESPACE + "\nexport const value = M;\n")), []);
});

Deno.test("prefer-named-imports skips a namespace import with no member reads", () => {
  assertEquals(linesOf(RULE, plainRun(NAMESPACE)), []);
});

Deno.test("prefer-named-imports honours the pragma", () => {
  const code = `// unslop-ignore-next-line ${RULE}\n${NAMESPACE}${MEMBERS}`;
  assertEquals(linesOf(RULE, runAt(code, "packages/x/src/a.ts", {})), []);
});
