/**
 * @module CheckConstantRestatementTest
 * @path packages/lint-rules/tests/whole_tree_constant_restatement_test.ts
 * @description Phase 142 Step 19 (GAP-3) — a test must derive a constant's value, not restate it.
 *
 *   Step 7 added two hosts to `DAEMON_DEFAULT_NET_HOSTS`. Four tests carried a hardcoded copy of
 *   the previous two-host list and broke — three in `dogfood_net_resolver_test.ts`, one in
 *   `daemon_least_privilege_test.ts`. Every static gate stayed green while those four tests
 *   disagreed with shipped behaviour, and the breakage appeared far from the change.
 *
 *   This is the same defect class the phase removed from its own parity gates: an expectation
 *   derived from a stale copy rather than from the source of truth.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/whole_tree/constant_restatement.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { checkRepository, findRestatements, parseListConstants } from "../src/rules/whole_tree/constant_restatement.ts";
import { WHOLE_TREE_SETTINGS } from "../src/rules/whole_tree/options.ts";

const CONSTANTS_SOURCE = `
export const DAEMON_DEFAULT_NET_HOSTS: readonly string[] = [
  "api.anthropic.com",
  "api.openai.com",
  // a comment between entries must not become an element
  "generativelanguage.googleapis.com",
];

export const SCALAR_CONSTANT = "not-a-list";

export const NUMERIC_LIST = [50, 100, 200];
`;

Deno.test("[constant-restatement] list-valued string constants are parsed; scalars and numbers are not", () => {
  const constants = parseListConstants(CONSTANTS_SOURCE);

  assertEquals(constants.get("DAEMON_DEFAULT_NET_HOSTS"), [
    "api.anthropic.com",
    "api.openai.com",
    "generativelanguage.googleapis.com",
  ]);
  assertEquals(constants.has("SCALAR_CONSTANT"), false);
  assertEquals(constants.has("NUMERIC_LIST"), false);
});

Deno.test("[constant-restatement] a test hardcoding a constant's joined value is reported", () => {
  const constants = parseListConstants(CONSTANTS_SOURCE);
  const findings = findRestatements(constants, [{
    path: "tests/integration/dogfood_net_resolver_test.ts",
    // The pre-fix shape, verbatim: the joined value written out, no import of the constant.
    source: 'const DEFAULT_NET = "--allow-net=api.anthropic.com,api.openai.com,generativelanguage.googleapis.com";',
  }]);

  assertEquals(findings.length, 1);
  assertEquals(findings[0].constant, "DAEMON_DEFAULT_NET_HOSTS");
  assertEquals(findings[0].file, "tests/integration/dogfood_net_resolver_test.ts");
});

Deno.test("[constant-restatement] a test importing the constant and deriving the value is not reported", () => {
  const constants = parseListConstants(CONSTANTS_SOURCE);
  const findings = findRestatements(constants, [{
    path: "tests/integration/dogfood_net_resolver_test.ts",
    // The corrected shape that ships today.
    source: [
      'import { DAEMON_DEFAULT_NET_HOSTS } from "@exaix/core/types";',
      'const DEFAULT_NET = `--allow-net=${DAEMON_DEFAULT_NET_HOSTS.join(",")}`;',
    ].join("\n"),
  }]);

  assertEquals(findings, []);
});

Deno.test("[constant-restatement] a partial copy of the list is reported too", () => {
  // The stale copy is by definition a *prefix* of the extended list — reporting only exact
  // whole-list matches would miss every real instance of this defect.
  const constants = parseListConstants(CONSTANTS_SOURCE);
  const findings = findRestatements(constants, [{
    path: "apps/exactl/tests/daemon_least_privilege_test.ts",
    source: 'assertEquals(netFlag, "--allow-net=api.anthropic.com,api.openai.com");',
  }]);

  assertEquals(findings.length, 1);
  assertEquals(findings[0].value, "api.anthropic.com,api.openai.com");
});

Deno.test("[constant-restatement] a single element is not treated as a restatement", () => {
  // One host in a string is an ordinary fixture value, not a copy of the list. Flagging it would
  // make the check noisy enough to be turned off, which is worse than not having it.
  const constants = parseListConstants(CONSTANTS_SOURCE);
  const findings = findRestatements(constants, [{
    path: "packages/ai-anthropic/tests/base_url_test.ts",
    source: 'assertEquals(host, "api.anthropic.com");',
  }]);

  assertEquals(findings, []);
});

Deno.test("[constant-restatement] the real repository is clean", async () => {
  // The check is only worth registering if the tree currently satisfies it — a gate that is
  // red on arrival gets ignored.
  const findings = await checkRepository(Deno.cwd(), WHOLE_TREE_SETTINGS.constantRestatement);
  assertEquals(
    findings.map((f) => `${f.file}: ${f.constant} restated as "${f.value}"`),
    [],
  );
});
