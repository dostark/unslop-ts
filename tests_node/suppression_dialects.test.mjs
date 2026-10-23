/**
 * @module SuppressionDialectsTest
 * @path tests_node/suppression_dialects.test.mjs
 * @description Runs the suppression-dialect table on the ESLint and Oxlint hosts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import table from "../tests/cases/suppression_dialects.json" with { type: "json" };
import { runEslintHost } from "./hosts/eslint.mjs";
import { runOxlintHost } from "./hosts/oxlint.mjs";

const HOST_CASES = table.filter((entry) => entry.dialect !== "deno");

function count(diagnostics, rule) {
  return diagnostics.filter((entry) => entry.rule === `unslop/${rule}`).length;
}

for (const [label, runHost] of [["ESLint", runEslintHost], ["Oxlint", runOxlintHost]]) {
  test(`the ${label} host reports a reasonless and a forbidden directive for its dialects`, { timeout: 30000 }, () => {
    for (const entry of HOST_CASES) {
      const code = entry.code.replaceAll("{{plugin}}", "unslop");
      const needsReason = count(runHost({ rule: "ignore-needs-reason", code }), "ignore-needs-reason");
      const forbidden = count(runHost({ rule: "no-forbidden-lint-ignore", code }), "no-forbidden-lint-ignore");
      assert.equal(needsReason, entry.needsReason ? 1 : 0, `${label} ignore-needs-reason: ${entry.code}`);
      assert.equal(forbidden, entry.forbidden ? 1 : 0, `${label} no-forbidden-lint-ignore: ${entry.code}`);
    }
  });
}

test("the ESLint host reports both forbidden id spellings", () => {
  const options = { forbiddenRules: ["no-explicit-any", "@typescript-eslint/no-explicit-any"] };
  for (const id of options.forbiddenRules) {
    const code = `// eslint-disable-next-line ${id}\nexport const value = 1;\n`;
    const hits = runEslintHost({ rule: "no-forbidden-lint-ignore", code, options })
      .filter((entry) => entry.rule === "unslop/no-forbidden-lint-ignore");
    assert.equal(hits.length, 1, id);
  }
});
