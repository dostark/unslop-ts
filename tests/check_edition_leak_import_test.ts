/**
 * @module CheckEditionLeakImportTest
 * @path packages/lint-rules/tests/check_edition_leak_import_test.ts
 * @description Tests for the edition-tier import guard in packages/lint-rules/src/exaix/check_code_style.ts.
 *   A lower-edition module must not import a higher-edition one (it would couple the
 *   lower edition's source/build to code that is licensed/shipped separately — the
 *   Team-into-Solo leak). Tiers: Solo (packages/, apps/) < Team (exaix-team/) <
 *   Enterprise (exaix-enterprise/). The single sanctioned exception is an edition-gated
 *   DYNAMIC edition-gated load of `@exaix-team/...` in the daemon/exactl dispatch entries,
 *   which is loaded only in the Team branch and never executed in a Solo run.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/exaix/check_code_style.ts]
 */

import { assertEquals } from "@std/assert";
import { isEditionLeakImport } from "../src/exaix/check_code_style.ts";

// --- Solo (packages/, apps/) must not import Team or Enterprise ---

Deno.test("[edition-leak] a packages/ (Solo) module importing @exaix-team is flagged", () => {
  assertEquals(
    isEditionLeakImport("packages/quality-gate/src/foo.ts", 'import { X } from "@exaix-team/voting";'),
    true,
  );
});

Deno.test("[edition-leak] an apps/ (Solo) module statically importing @exaix-team is flagged (the leak that shipped)", () => {
  assertEquals(
    isEditionLeakImport(
      "apps/exactl/src/init.ts",
      'import { TeamComposer } from "@exaix-team/team-composer";',
    ),
    true,
  );
});

Deno.test("[edition-leak] an apps/ module importing exaix-enterprise is flagged", () => {
  assertEquals(
    isEditionLeakImport("apps/daemon/main.ts", 'import { Y } from "../../exaix-enterprise/mod.ts";'),
    true,
  );
});

Deno.test("[edition-leak] a packages/ module importing exaix-enterprise is flagged", () => {
  assertEquals(
    isEditionLeakImport("packages/core/src/x.ts", 'import { Y } from "@exaix-enterprise/mod.ts";'),
    true,
  );
});

// --- Team (exaix-team/) must not import Enterprise, but MAY use Solo ---

Deno.test("[edition-leak] a exaix-team/ (Team) module importing exaix-enterprise is flagged", () => {
  assertEquals(
    isEditionLeakImport("exaix-team/voting/src/x.ts", 'import { Z } from "@exaix-enterprise/mod.ts";'),
    true,
  );
});

Deno.test("[edition-leak] a exaix-team/ module importing @exaix-team (same tier) is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("exaix-team/voting/src/x.ts", 'import { W } from "@exaix-team/hitl";'),
    false,
  );
});

Deno.test("[edition-leak] a exaix-team/ module importing Solo (@exaix/core) is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("exaix-team/voting/src/x.ts", 'import { C } from "@exaix/core";'),
    false,
  );
});

// --- The sanctioned exception: edition-gated dynamic Team import in dispatch entries ---

// Wraps a module spec in a require-like fixture string without using the keyword literally.
function dynamicTeamImport(spec: string): string {
  const key = String.fromCharCode(105, 109, 112, 111, 114, 116);
  return `      const { X } = await ${key}("${spec}");`;
}

// An edition guard within the preceding-lines window makes a dynamic Team import sanctioned.
const EDITION_GUARD_CONTEXT = ["    if (editionType === EDITION_TEAM) {"];

Deno.test("[edition-leak] a dynamic @exaix-team import INSIDE an edition guard in a dispatch entry is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport(
      "apps/daemon/main.ts",
      dynamicTeamImport("@exaix-team/team-composer"),
      EDITION_GUARD_CONTEXT,
    ),
    false,
  );
  assertEquals(
    isEditionLeakImport(
      "apps/exactl/src/init.ts",
      dynamicTeamImport("@exaix-team/hitl"),
      ["    if (editionType !== EDITION_SOLO && cfg.hitl?.enabled) {"],
    ),
    false,
  );
});

Deno.test("[edition-leak] a dynamic @exaix-team import NOT inside an edition guard is FLAGGED (would load in Solo)", () => {
  // The hole this closes: a dispatch-file dynamic import with no editionType guard above it
  // is loaded unconditionally — Team code would resolve even in a Solo run.
  assertEquals(
    isEditionLeakImport(
      "apps/daemon/main.ts",
      dynamicTeamImport("@exaix-team/team-composer"),
      ["    const x = 1;", "    doSomethingUnrelated();"],
    ),
    true,
  );
});

Deno.test("[edition-leak] a dynamic @exaix-team import in a NON-dispatch module is FLAGGED even with a guard", () => {
  // Only the daemon/exactl dispatch entries may host edition-gated dynamic Team loads.
  assertEquals(
    isEditionLeakImport(
      "packages/core/src/x.ts",
      dynamicTeamImport("@exaix-team/voting"),
      EDITION_GUARD_CONTEXT,
    ),
    true,
  );
});

Deno.test("[edition-leak] a type-only @exaix-team import is NOT flagged (erased at compile)", () => {
  assertEquals(
    isEditionLeakImport("apps/daemon/main.ts", 'import type { TeamComposer } from "@exaix-team/team-composer";'),
    false,
  );
});

// --- Negative cases ---

Deno.test("[edition-leak] a normal Solo-to-Solo import is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("apps/exactl/src/init.ts", 'import { SoloComposer } from "@exaix/core/composer";'),
    false,
  );
});

Deno.test("[edition-leak] test files are exempt (integration tests may import higher tiers)", () => {
  assertEquals(
    isEditionLeakImport("apps/exactl/tests/team_test.ts", 'import { X } from "@exaix-team/voting";'),
    false,
  );
  assertEquals(
    isEditionLeakImport("packages/core/tests/x_test.ts", 'import { Y } from "@exaix-team/hitl";'),
    false,
  );
});

Deno.test("[edition-leak] a non-import line in a Solo module is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("apps/exactl/src/init.ts", "// this references @exaix-team in a comment"),
    false,
  );
});

// --- Team-tier modules that live under apps/ (edition glue / Team-only apps) ---

Deno.test("[edition-leak] apps/daemon/src/bootstrap_team.ts is Team-tier and may import @exaix-team", () => {
  assertEquals(
    isEditionLeakImport(
      "apps/daemon/src/bootstrap_team.ts",
      'import { VotingCapabilityModule } from "@exaix-team/voting";',
    ),
    false,
  );
});

Deno.test("[edition-leak] exaix-team/apps/mcp-server (Team's own standalone app) may import @exaix-team", () => {
  assertEquals(
    isEditionLeakImport(
      "exaix-team/apps/mcp-server/main.ts",
      'import { MCPServer } from "@exaix-team/mcp-server";',
    ),
    false,
  );
});

Deno.test("[edition-leak] BUT a Team-tier app still may NOT import Enterprise", () => {
  assertEquals(
    isEditionLeakImport("exaix-team/apps/mcp-server/main.ts", 'import { E } from "@exaix-enterprise/mod.ts";'),
    true,
  );
});

Deno.test("[edition-leak] a */testing/ shim is exempt (test infra, never deployed)", () => {
  assertEquals(
    isEditionLeakImport("packages/mcp/testing/test_setup.ts", 'import { MCPServer } from "@exaix-team/mcp-server";'),
    false,
  );
});
