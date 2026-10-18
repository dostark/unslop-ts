/**
 * @module RuleRegistryTest
 * @path packages/lint-rules/tests/registry_test.ts
 * @description Rule-pack registry: id resolution, option schemas, and rejection of malformed packs.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/engine/registry.ts]
 */

import { assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import { z } from "zod";
import {
  createRuleRegistry,
  type IPluginRule,
  type IRulePack,
  RuleRegistryError,
  TYPESCRIPT_RULE_PACK,
} from "@exaix/lint-rules";

const NOOP_RULE: IPluginRule = { create: () => ({}) };
const NO_OPTIONS = z.object({}).strict();

function pack(name: string, keys: readonly string[]): IRulePack {
  return {
    name,
    rules: Object.fromEntries(keys.map((key) => [key, NOOP_RULE])),
    optionSchemas: Object.fromEntries(keys.map((key) => [key, NO_OPTIONS])),
  };
}

Deno.test("the registry resolves plugin-prefixed ids from each pack it is given", () => {
  const registry = createRuleRegistry("demo", [pack("first", ["one"]), pack("second", ["two"])]);
  assertEquals(registry.pluginName, "demo");
  assertEquals(registry.implementation("demo/one"), NOOP_RULE);
  assertEquals(registry.implementation("demo/two"), NOOP_RULE);
  assertEquals(registry.catalogIds(), ["demo/one", "demo/two"]);
});

Deno.test("the registry exposes the option schema of each rule", () => {
  const registry = createRuleRegistry("demo", [pack("first", ["one"])]);
  assertEquals(registry.optionSchema("demo/one"), NO_OPTIONS);
});

Deno.test("the registry returns null for an id that no pack defines", () => {
  const registry = createRuleRegistry("demo", [pack("first", ["one"])]);
  assertEquals(registry.implementation("demo/three"), null);
  assertEquals(registry.optionSchema("demo/three"), null);
});

Deno.test("the registry returns null for an id under another plugin name or without a prefix", () => {
  const registry = createRuleRegistry("demo", [pack("first", ["one"])]);
  assertEquals(registry.implementation("other/one"), null);
  assertEquals(registry.implementation("one"), null);
  assertEquals(registry.optionSchema("other/one"), null);
});

Deno.test("a rule key defined by two packs throws a RuleRegistryError naming both packs", () => {
  const error = assertThrows(
    () => createRuleRegistry("demo", [pack("first", ["one"]), pack("second", ["one"])]),
    RuleRegistryError,
  );
  assertInstanceOf(error, RuleRegistryError);
  assertStringIncludes(error.message, "first");
  assertStringIncludes(error.message, "second");
  assertStringIncludes(error.message, "one");
});

Deno.test("a rule without an option schema throws a RuleRegistryError naming the pack and key", () => {
  const broken: IRulePack = { name: "broken", rules: { lonely: NOOP_RULE }, optionSchemas: {} };
  const error = assertThrows(() => createRuleRegistry("demo", [broken]), RuleRegistryError);
  assertStringIncludes(error.message, "broken");
  assertStringIncludes(error.message, "lonely");
});

Deno.test("an option schema without a rule throws a RuleRegistryError naming the pack and key", () => {
  const broken: IRulePack = { name: "broken", rules: {}, optionSchemas: { orphan: NO_OPTIONS } };
  const error = assertThrows(() => createRuleRegistry("demo", [broken]), RuleRegistryError);
  assertStringIncludes(error.message, "broken");
  assertStringIncludes(error.message, "orphan");
});

const TYPESCRIPT_PACK_RULE_COUNT = 16;

Deno.test("the TypeScript rule pack holds the engine rules, each with an option schema and no prefix", () => {
  const keys = Object.keys(TYPESCRIPT_RULE_PACK.rules).sort();
  assertEquals(keys.length, TYPESCRIPT_PACK_RULE_COUNT);
  assertEquals(Object.keys(TYPESCRIPT_RULE_PACK.optionSchemas).sort(), keys);
  assertEquals(keys.filter((key) => key.includes("/")), []);
});
