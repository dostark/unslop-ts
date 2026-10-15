/**
 * @module PluginSelectionTest
 * @path packages/lint-rules/tests/plugin_selection_test.ts
 * @description `EXAIX_LINT_RULES` selection and the `optIn` dispatch.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/engine/plugin.ts]
 */

import { assertEquals } from "@std/assert";
import { createLintPlugin, type JsonValue, parseCatalog } from "@exaix/lint-rules";

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
    },
    rules: {
      "exaix/ignore-needs-reason": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["type-safety"],
        options: { separator: "--" },
      },
      "exaix/no-runtime-typeof": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["type-safety"],
        options: { allowInTypeGuards: true },
      },
      "exaix/max-class-size": {
        engine: "plugin",
        severity: "off",
        optIn: true,
        reason: "Manual today: the class-size report runs on demand.",
        scope: "all",
        tags: ["module-structure"],
        options: { minClassLines: 200, threshold: 60 },
      },
    },
  };
}

/** The rule keys registered for one `EXAIX_LINT_RULES` value (null clears the variable). */
function registered(value: string | null): string[] {
  const previous = Deno.env.get("EXAIX_LINT_RULES") ?? null;
  try {
    if (value === null) Deno.env.delete("EXAIX_LINT_RULES");
    else Deno.env.set("EXAIX_LINT_RULES", value);
    const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog()));
    return Object.keys(plugin.rules).sort();
  } finally {
    if (previous === null) Deno.env.delete("EXAIX_LINT_RULES");
    else Deno.env.set("EXAIX_LINT_RULES", previous);
  }
}

Deno.test("with no selection, active rules register and an opt-in rule stays off", () => {
  assertEquals(registered(null), ["ignore-needs-reason", "no-runtime-typeof"]);
});

Deno.test("a selected rule id narrows the run to that rule", () => {
  assertEquals(registered("exaix/ignore-needs-reason"), ["ignore-needs-reason"]);
});

Deno.test("an opt-in rule registers when it is selected explicitly", () => {
  assertEquals(registered("exaix/max-class-size"), ["max-class-size"]);
});

Deno.test("a tag selector registers every rule with that tag", () => {
  assertEquals(registered("tag:type-safety"), ["ignore-needs-reason", "no-runtime-typeof"]);
});

Deno.test("a tag selector registers an opt-in rule that carries the tag", () => {
  assertEquals(registered("tag:module-structure"), ["max-class-size"]);
});

Deno.test("a selection that matches nothing registers no rule", () => {
  assertEquals(registered("exaix/does-not-exist"), []);
});
