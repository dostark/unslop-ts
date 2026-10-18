/**
 * @module PluginSelectionTest
 * @path packages/lint-rules/tests/plugin_selection_test.ts
 * @description `DEMO_LINT_RULES` selection, the `optIn` dispatch, and registration of every catalog rule.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/engine/plugin.ts]
 */

import { assertArrayIncludes, assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import { CatalogError, createLintPlugin, type JsonValue, runPlugin, selectionEnvName } from "../mod.ts";
import { lintJson, withDemoProject } from "./helpers/demo_project.ts";
import { createTestPlugin, loadTestCatalog, TEST_PLUGIN_NAME } from "./helpers/registry.ts";

const PROD_FILE = "packages/x/src/a.ts";
const SELECTION_VARIABLE = "DEMO_LINT_RULES";
const OFF_RULE = "no-explicit-unknown";
const TEST_ONLY_RULE = "no-boolean-assert";
const ALL_KEYS = ["ignore-needs-reason", OFF_RULE, "no-runtime-typeof", TEST_ONLY_RULE].sort();

/** One violation for each rule in the catalog below, except the test-only rule. */
const SOURCE = [
  "// deno-lint-ignore demo/a-rule",
  "export const kind = typeof input === 'string';",
  "export let loose: unknown = 1;",
  "",
].join("\n");

function buildCatalog(): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: {
      test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
      fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
    },
    tagVocabulary: {
      "type-safety": { description: "Rules that keep type evidence." },
      "module-structure": { description: "Rules on module and type structure." },
      "test-quality": { description: "Rules on test assertions.", requiresScope: ["test"] },
    },
    rules: {
      "demo/ignore-needs-reason": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["type-safety"],
        options: { separator: "--" },
      },
      "demo/no-runtime-typeof": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["type-safety"],
        options: { allowInTypeGuards: true },
      },
      "demo/no-explicit-unknown": {
        engine: "plugin",
        severity: "off",
        optIn: true,
        reason: "Manual today: the burn-down is open.",
        scope: "all",
        tags: ["module-structure"],
      },
      "demo/no-boolean-assert": {
        engine: "plugin",
        severity: "error",
        scope: "test",
        tags: ["test-quality"],
      },
    },
  };
}

/** Runs `body` with the selection variable set to `value` (null clears it), then restores it. */
function withSelection<T>(value: string | null, body: () => T): T {
  const previous = Deno.env.get(SELECTION_VARIABLE) ?? null;
  try {
    if (value === null) Deno.env.delete(SELECTION_VARIABLE);
    else Deno.env.set(SELECTION_VARIABLE, value);
    return body();
  } finally {
    if (previous === null) Deno.env.delete(SELECTION_VARIABLE);
    else Deno.env.set(SELECTION_VARIABLE, previous);
  }
}

/** The rule keys that Deno knows for one selection value. */
function registered(value: string | null): string[] {
  return withSelection(value, () => Object.keys(createTestPlugin(loadTestCatalog(buildCatalog())).rules).sort());
}

/** The rule keys that report on a production file for one selection value. */
function reporting(value: string | null): string[] {
  return withSelection(value, () => {
    const plugin = createTestPlugin(loadTestCatalog(buildCatalog()));
    const prefix = `${TEST_PLUGIN_NAME}/`;
    const ids = runPlugin(plugin, PROD_FILE, SOURCE).map((diagnostic) => diagnostic.id.replace(prefix, ""));
    return [...new Set(ids)].sort();
  });
}

Deno.test("with no selection, active rules report and an opt-in rule stays off", () => {
  assertEquals(reporting(null), ["ignore-needs-reason", "no-runtime-typeof"]);
});

Deno.test("a selected rule id narrows the run to that rule", () => {
  assertEquals(reporting("demo/ignore-needs-reason"), ["ignore-needs-reason"]);
});

Deno.test("an opt-in rule reports when it is selected explicitly", () => {
  assertEquals(reporting(`demo/${OFF_RULE}`), [OFF_RULE]);
});

Deno.test("a tag selector runs every rule with that tag", () => {
  assertEquals(reporting("tag:type-safety"), ["ignore-needs-reason", "no-runtime-typeof"]);
});

Deno.test("a tag selector runs an opt-in rule that carries the tag", () => {
  assertEquals(reporting("tag:module-structure"), [OFF_RULE]);
});

Deno.test("a selection that matches nothing reports no rule", () => {
  assertEquals(reporting("demo/does-not-exist"), []);
});

Deno.test("every catalog rule stays registered whatever its severity or selection", () => {
  for (const value of [null, "demo/ignore-needs-reason", `demo/${OFF_RULE}`, "demo/does-not-exist"]) {
    assertEquals(registered(value), ALL_KEYS, `selection ${value}`);
  }
});

Deno.test("an off rule is registered and reports nothing", () => {
  assertArrayIncludes(registered(null), [OFF_RULE]);
  assertEquals(reporting(null), ["ignore-needs-reason", "no-runtime-typeof"]);
});

Deno.test("an unselected rule is registered and reports nothing", () => {
  assertArrayIncludes(registered("demo/ignore-needs-reason"), ["no-runtime-typeof"]);
  assertEquals(reporting("demo/ignore-needs-reason"), ["ignore-needs-reason"]);
});

Deno.test("a test-scope rule is registered and reports nothing on a production file", () => {
  assertArrayIncludes(registered(null), [TEST_ONLY_RULE]);
  assertEquals(reporting(`demo/${TEST_ONLY_RULE}`), []);
});

Deno.test("createLintPlugin rejects a catalog whose plugin rule no registered pack defines", () => {
  const catalog = loadTestCatalog(buildCatalog());
  const error = assertThrows(() => createLintPlugin(TEST_PLUGIN_NAME, catalog, { rulePacks: [] }), CatalogError);
  assertInstanceOf(error, CatalogError);
  assertStringIncludes(error.path, "rules.demo/");
  assertStringIncludes(error.message, "no plugin rule implementation is registered for this id");
});

Deno.test("selectionEnvName derives the selection variable from the plugin name", () => {
  assertEquals(selectionEnvName(TEST_PLUGIN_NAME), SELECTION_VARIABLE);
  assertEquals(selectionEnvName("my-lint"), "MY_LINT_LINT_RULES");
});

Deno.test("a plugin ignores the selection variable of another plugin", () => {
  const other = "OTHER_LINT_RULES";
  Deno.env.set(other, "demo/does-not-exist");
  try {
    assertEquals(reporting(null), ["ignore-needs-reason", "no-runtime-typeof"]);
  } finally {
    Deno.env.delete(other);
  }
});

const TYPEOF_SOURCE = 'declare const input: string;\nexport const isText = typeof input === "string";\n';
const TYPEOF_RULE = `${TEST_PLUGIN_NAME}/no-runtime-typeof`;

async function typeofCodes(excluded: readonly string[]): Promise<(string | undefined)[]> {
  const options = { files: { "typeof.ts": TYPEOF_SOURCE }, lintRules: { exclude: excluded } };
  return await withDemoProject(options, async (dir) => {
    const report = await lintJson(dir, ["typeof.ts"], { [SELECTION_VARIABLE]: TYPEOF_RULE });
    return (report.diagnostics ?? []).map((diagnostic) => diagnostic.code);
  });
}

Deno.test("a selected rule reports under deno lint unless the Deno config excludes it", async () => {
  assertArrayIncludes(await typeofCodes([]), [TYPEOF_RULE]);
  assertEquals((await typeofCodes([TYPEOF_RULE])).filter((code) => code === TYPEOF_RULE), []);
});
