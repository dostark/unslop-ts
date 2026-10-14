/**
 * @module CheckProdTestsImportTest
 * @path packages/lint-rules/tests/check_prod_tests_import_test.ts
 * @description Tests for the production-module → tests/ import guard in
 *   packages/lint-rules/src/exaix/check_code_style.ts. Functional deployable modules (packages/,
 *   exaix-team/, apps/) must NOT depend on the tests/ folder — that is the
 *   layering violation that put EvalSqliteStore under tests/scenario_framework and
 *   broke a deployed exactl/daemon at module load. Test files themselves may import
 *   test helpers, so the guard excludes test files.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/exaix/check_code_style.ts]
 */

import { assertEquals } from "@std/assert";
import { isProductionToTestsImport } from "../src/exaix/check_code_style.ts";

Deno.test("[prod-tests-import] a packages/ module importing tests/ via a relative path is flagged", () => {
  assertEquals(
    isProductionToTestsImport(
      "packages/quality-gate/src/foo.ts",
      "../../../tests/scenario_framework/runner/history_sqlite.ts",
    ),
    true,
  );
});

Deno.test("[prod-tests-import] an apps/ module importing tests/ is flagged (the EvalHistory bug)", () => {
  assertEquals(
    isProductionToTestsImport(
      "apps/exactl/src/commands/eval_commands.ts",
      "../../../../tests/scenario_framework/runner/history_sqlite.ts",
    ),
    true,
  );
});

Deno.test("[prod-tests-import] a exaix-team/ module importing tests/ is flagged", () => {
  assertEquals(
    isProductionToTestsImport(
      "exaix-team/voting/src/bar.ts",
      "../../../tests/helpers/x.ts",
    ),
    true,
  );
});

Deno.test("[prod-tests-import] a TEST file importing tests/ is NOT flagged (test helpers are allowed)", () => {
  assertEquals(
    isProductionToTestsImport(
      "packages/quality-gate/tests/foo_test.ts",
      "../../../tests/helpers/x.ts",
    ),
    false,
  );
  assertEquals(
    isProductionToTestsImport(
      "apps/exactl/tests/eval_commands_test.ts",
      "../../../tests/fixtures/y.ts",
    ),
    false,
  );
});

Deno.test("[prod-tests-import] a production module importing a non-tests path is NOT flagged", () => {
  assertEquals(
    isProductionToTestsImport(
      "apps/exactl/src/commands/eval_commands.ts",
      "@exaix/eval-history",
    ),
    false,
  );
  assertEquals(
    isProductionToTestsImport(
      "packages/quality-gate/src/foo.ts",
      "../../core/mod.ts",
    ),
    false,
  );
});

Deno.test("[prod-tests-import] test-infrastructure modules (packages/testing, */testing/ shims) are NOT flagged", () => {
  // @exaix/testing and *-testing compat shims exist to provide test helpers; they never
  // ship in a production deploy, so bridging to tests/ is allowed.
  assertEquals(
    isProductionToTestsImport("packages/testing/mod.ts", "../../tests/integration/helpers/test_environment.ts"),
    false,
  );
  assertEquals(
    isProductionToTestsImport("packages/git/testing/mod.ts", "../../../tests/fixtures/x.ts"),
    false,
  );
});

Deno.test("[prod-tests-import] a non-production path (tests/, scripts/, docs/) is NOT flagged here", () => {
  // scripts/ and root tests/ are out of the production-module scope of this rule.
  assertEquals(
    isProductionToTestsImport("scripts/foo.ts", "../tests/helpers/x.ts"),
    false,
  );
  assertEquals(
    isProductionToTestsImport("tests/scenario_framework/runner/main.ts", "./history_sqlite.ts"),
    false,
  );
});
