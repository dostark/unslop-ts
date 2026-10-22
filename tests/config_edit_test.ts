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
import { testDescriptor } from "./helpers/descriptor.ts";

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
