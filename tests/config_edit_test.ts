/**
 * @module ConfigEditTest
 * @path tests/config_edit_test.ts
 * @description Pure targeted edits: shortest-form normalization, obsolete-field cleanup, inherited fields, and default-aware unset.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/config/edit.ts, tests/helpers/descriptor.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  compileConfig,
  disableRule,
  EditRefusalError,
  enableRule,
  type ICompiledConfig,
  type IEditContext,
  type JsonValue,
  setOption,
  unsetOption,
} from "../mod.ts";
import { effectiveEquals } from "../src/config/edit.ts";
import { testDescriptor } from "./helpers/descriptor.ts";
import { migrationDescriptor } from "./helpers/migration_descriptor.ts";

function context(config: JsonValue): IEditContext {
  const descriptor = testDescriptor();
  return { descriptor, compiled: compileConfig(config, descriptor) };
}

function compiledOf(config: JsonValue): ICompiledConfig {
  return compileConfig(config, testDescriptor());
}

function record(value: JsonValue): Record<string, JsonValue> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), "expected an object");
  return value;
}

const BASE_CONFIG = {
  version: 2,
  plugin: "demo",
  extends: ["unslop:recommended"],
  rules: {
    "demo/max-params": {
      level: "error",
      options: { max: 3 },
      scope: "prod",
      include: ["src/**"],
      exclude: ["src/vendor/**"],
    },
  },
} as JsonValue;

Deno.test("enable_disable_set_unset_produce_the_expected_file", () => {
  const enable = enableRule(BASE_CONFIG, context(BASE_CONFIG), "demo/no-boolean-assert");
  assertEquals(record(record(enable).rules)["demo/no-boolean-assert"], "error");
  const enabledModel = compiledOf(enable);
  assertEquals(enabledModel.rules["demo/no-boolean-assert"].configuredLevel, "error");
  assertEquals(enabledModel.rules["demo/no-chained-type-assertions"].configuredLevel, "error");

  const disable = disableRule(enable, context(enable), "demo/no-boolean-assert", "Not used here.", false);
  const disabledRule = record(record(disable).rules)["demo/no-boolean-assert"];
  assertEquals(disabledRule, { level: "off", reason: "Not used here." });
  assertEquals(compiledOf(disable).rules["demo/no-boolean-assert"].configuredLevel, "off");

  const parked = disableRule(enable, context(enable), "demo/no-boolean-assert", "Selected later.", true);
  assertEquals(record(record(record(parked).rules)["demo/no-boolean-assert"]).optIn, true);

  const reEnabled = enableRule(disable, context(disable), "demo/no-boolean-assert");
  assertEquals(record(record(reEnabled).rules)["demo/no-boolean-assert"], "error");

  const set = setOption(BASE_CONFIG, context(BASE_CONFIG), "demo/max-params", "max", 5);
  const setRule = record(record(set).rules)["demo/max-params"];
  assertEquals(record(setRule).options, { max: 5 });
  assertEquals(record(setRule).scope, "prod");
  assertEquals(record(setRule).include, ["src/**"]);
  assertEquals(record(setRule).exclude, ["src/vendor/**"]);
  assertEquals(compiledOf(set).rules["demo/max-params"].effectiveOptions, { max: 5 });
  assertEquals(compiledOf(set).rules["demo/no-chained-type-assertions"].configuredLevel, "error");

  const unset = unsetOption(set, context(set), "demo/max-params", "max");
  const unsetRule = record(record(unset).rules)["demo/max-params"];
  assertEquals(record(unsetRule).options, undefined);
  assertEquals(record(unsetRule).scope, "prod");
  assertEquals(record(unsetRule).level, "error");
  assertEquals(compiledOf(unset).rules["demo/max-params"].effectiveOptions, { max: 7 });

  const boundary = enableRule(BASE_CONFIG, context(BASE_CONFIG), "demo/import-boundaries");
  assertEquals(record(record(boundary).rules)["demo/import-boundaries"], "error");
  assertEquals(compiledOf(boundary).rules["demo/import-boundaries"].effectiveOptions, { zones: [] });
});

Deno.test("inherited_scope_exclusions_and_options_survive_targeted_edits", () => {
  const strict = {
    version: 2,
    plugin: "demo",
    extends: ["unslop:strict"],
    rules: {
      "demo/max-params": {
        level: "error",
        options: { max: 4 },
        scope: "prod",
        include: ["packages/**"],
        exclude: ["packages/vendor/**"],
        tags: ["type-safety"],
      },
    },
  } as JsonValue;

  const edited = setOption(strict, context(strict), "demo/max-params", "max", 9);
  assertEquals(record(record(record(edited).rules)["demo/max-params"]).options, { max: 9 });
  assertEquals(record(record(record(edited).rules)["demo/max-params"]).scope, "prod");
  assertEquals(record(record(record(edited).rules)["demo/max-params"]).include, ["packages/**"]);
  assertEquals(record(record(record(edited).rules)["demo/max-params"]).exclude, ["packages/vendor/**"]);
  assertEquals(record(record(record(edited).rules)["demo/max-params"]).tags, ["type-safety"]);
  assertEquals(compiledOf(edited).rules["demo/max-params"].effectiveOptions, { max: 9 });

  const disabled = disableRule(edited, context(edited), "demo/max-params", "Measured later.", false);
  assertEquals(record(record(record(disabled).rules)["demo/max-params"]).options, { max: 9 });
  assertEquals(record(record(record(disabled).rules)["demo/max-params"]).scope, "prod");
  assertEquals(compiledOf(disabled).rules["demo/max-params"].configuredLevel, "off");
  assertEquals(compiledOf(disabled).rules["demo/no-chained-type-assertions"].configuredLevel, "error");

  const inherited = disableRule(strict, context(strict), "demo/no-boolean-assert", "Not used.", false);
  assertEquals(record(record(record(inherited).rules)["demo/no-boolean-assert"]).level, "off");
  assertEquals(record(record(record(inherited).rules)["demo/no-boolean-assert"]).reason, "Not used.");
  assertEquals(compiledOf(inherited).rules["demo/max-params"].effectiveOptions, { max: 4 });

  assertEquals(
    assertThrows(
      () => unsetOption(strict, context(strict), "optional-params", "wrapperType"),
      EditRefusalError,
    ).path,
    "rules.optional-params.options.wrapperType",
  );

  const refused = assertThrows(
    () => enableRule(strict, context(strict), "optional-params"),
    EditRefusalError,
  );
  assertEquals(refused.path, "rules.optional-params.level");
});

Deno.test("edit_preserves_reason_on_an_enabled_rule", () => {
  const config = {
    version: 2,
    plugin: "demo",
    rules: {
      "demo/max-params": { level: "error", reason: "Team agreed on 2.", options: { max: 2 } },
    },
  } as JsonValue;
  const edited = setOption(config, context(config), "demo/max-params", "max", 3);
  assertEquals(record(record(record(edited).rules)["demo/max-params"]).reason, "Team agreed on 2.");
  assertEquals(compiledOf(edited).rules["demo/max-params"].reason, "Team agreed on 2.");
  assertEquals(compiledOf(edited).catalog.rules["demo/max-params"].reason, "Team agreed on 2.");
});

Deno.test("edit_preserves_opt_in_on_an_enabled_rule", () => {
  const config = {
    version: 2,
    plugin: "demo",
    rules: {
      "demo/max-params": { level: "error", optIn: true, reason: "Selected by tag.", options: { max: 2 } },
    },
  } as JsonValue;
  const set = setOption(config, context(config), "demo/max-params", "max", 4);
  assertEquals(record(record(record(set).rules)["demo/max-params"]).optIn, true);
  assertEquals(record(record(record(set).rules)["demo/max-params"]).reason, "Selected by tag.");
  const unset = unsetOption(set, context(set), "demo/max-params", "max");
  assertEquals(record(record(record(unset).rules)["demo/max-params"]).optIn, true);
  assertEquals(record(record(record(unset).rules)["demo/max-params"]).reason, "Selected by tag.");
});

Deno.test("edit_preserves_exclusion_codes_on_a_script_rule", () => {
  const descriptor = migrationDescriptor();
  const contextFor = (config: JsonValue): IEditContext => ({ descriptor, compiled: compileConfig(config, descriptor) });
  const config = {
    version: 2,
    plugin: "demo",
    rules: {
      "project-check": { level: "warn", exclusionCodes: { "a-code": "because" } },
    },
  } as JsonValue;
  const enabled = enableRule(config, contextFor(config), "project-check", "error");
  assertEquals(record(record(record(enabled).rules)["project-check"]).exclusionCodes, { "a-code": "because" });
  assertEquals(compileConfig(enabled, descriptor).rules["project-check"].exclusionCodes, { "a-code": "because" });
  const warn = enableRule(enabled, contextFor(enabled), "project-check", "warn");
  assertEquals(record(record(record(warn).rules)["project-check"]).exclusionCodes, { "a-code": "because" });
  assertEquals(compileConfig(warn, descriptor).catalog.rules["project-check"].exclusionCodes, {
    "a-code": "because",
  });
});

Deno.test("enable_of_an_off_rule_still_clears_reason_and_opt_in", () => {
  const config = {
    version: 2,
    plugin: "demo",
    rules: {
      "demo/max-params": { level: "off", optIn: true, reason: "Selected later.", options: { max: 2 } },
    },
  } as JsonValue;
  const enabled = enableRule(config, context(config), "demo/max-params");
  const compiled = compiledOf(enabled).rules["demo/max-params"];
  assertEquals(compiled.reason, null);
  assertEquals(compiled.optIn, false);
  assertEquals(JSON.stringify(record(enabled)).includes('"reason"'), false);
  assertEquals(JSON.stringify(record(enabled)).includes('"optIn"'), false);
});

Deno.test("effective_equality_fails_when_a_field_is_dropped", () => {
  const descriptor = migrationDescriptor();
  const withCodes = {
    version: 2,
    plugin: "demo",
    rules: { "project-check": { level: "warn", exclusionCodes: { "a-code": "because" } } },
  } as JsonValue;
  const without = {
    version: 2,
    plugin: "demo",
    rules: { "project-check": "warn" },
  } as JsonValue;
  const left = compileConfig(withCodes, descriptor).rules["project-check"];
  const right = compileConfig(without, descriptor).rules["project-check"];
  assertEquals(effectiveEquals(left, right), false);
  assertEquals(effectiveEquals(left, left), true);
});
