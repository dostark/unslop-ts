/**
 * @module ConfigMigrateTest
 * @path tests/config_migrate_test.ts
 * @description Version 1 migration preserves the semantic projection, splits layout, carries custom limits, and shrinks the large fixture.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/config/migrate.ts, tests/helpers/migration_descriptor.ts, tests/cases/catalog_v1_example.json]
 */

import { assert, assertEquals } from "@std/assert";
import { type JsonValue, NOT_ENABLED_REASON, TYPESCRIPT_RULE_PACK } from "../mod.ts";
import { compileConfig, migrateCatalog, semanticCatalogProjection, semanticCompiledProjection } from "../mod.ts";
import { migrationDescriptor } from "./helpers/migration_descriptor.ts";

const EXAMPLE_URL = new URL("./cases/catalog_v1_example.json", import.meta.url);
const LARGE_URL = new URL("./cases/catalog_v1_large.json", import.meta.url);

const SETTINGS_SECTIONS = [
  ["magicLiterals", "magic-literals"],
  ["constantRestatement", "constant-restatement"],
  ["unusedExports", "unused-exports"],
  ["unusedFiles", "unused-files"],
  ["optionalParams", "optional-params"],
  ["duplicateCode", "duplicate-code"],
] as const;

async function readFixture(url: URL): Promise<JsonValue> {
  return JSON.parse(await Deno.readTextFile(url)) as JsonValue;
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  assert(
    value !== undefined && typeof value === "object" && value !== null && !Array.isArray(value),
    "expected an object",
  );
  return value;
}

function rulesOf(config: JsonValue): Record<string, JsonValue> {
  return record(record(config).rules);
}

function ruleOf(config: JsonValue, id: string): Record<string, JsonValue> {
  return record(rulesOf(config)[id]);
}

function originalIds(v1: JsonValue): string[] {
  const catalog = record(v1);
  const ids = Object.keys(record(catalog.rules));
  const wholeTree = catalog.wholeTree === undefined ? {} : record(catalog.wholeTree);
  for (const [section, id] of SETTINGS_SECTIONS) {
    if (wholeTree[section] !== undefined) ids.push(id);
  }
  return ids;
}

Deno.test("migration_preserves_semantic_projection", async () => {
  const v1 = await readFixture(EXAMPLE_URL);
  const descriptor = migrationDescriptor();
  const { config } = migrateCatalog(v1, descriptor);
  const compiled = compileConfig(config, descriptor);
  const ids = originalIds(v1);
  assertEquals(
    semanticCompiledProjection(compiled, descriptor, ids),
    semanticCatalogProjection(v1, descriptor, ids),
  );

  assertEquals(record(config).docsBase, "unslop-ts/docs/style_guide.md");
  assertEquals(ruleOf(config, "demo/max-params").docs, "docs/custom-guide.md#limits");
  assertEquals(ruleOf(config, "demo/no-chained-type-assertions").docs, undefined);
  assertEquals(ruleOf(config, "demo/max-params").tags, ["project-tag"]);
  assertEquals(ruleOf(config, "demo/no-chained-type-assertions").tags, undefined);
  assertEquals(record(config).tags, {
    "project-tag": { description: "A tag this project chose.", requiresScope: ["prod", "all"] },
  });
  assertEquals(record(record(config).paths).ignore, [
    { glob: "**/vendor/**", reason: "Vendored code is not reviewed." },
  ]);
  assertEquals(ruleOf(config, "optional-params").level, "warn");
  assertEquals(ruleOf(config, "magic-literals").level, "error");
  assertEquals(ruleOf(config, "duplicate-type").scope, undefined);
  assertEquals(ruleOf(config, "duplicate-type").include, undefined);

  const added = Object.keys(compiled.rules).filter((id) => !ids.includes(id));
  assert(added.length > 0);
  for (const id of added) {
    const rule = compiled.rules[id];
    assertEquals(rule.configuredLevel, "off", id);
    assertEquals(rule.optIn, true, id);
    assertEquals(rule.reason, NOT_ENABLED_REASON, id);
  }
});

Deno.test("migration_splits_layout_out", async () => {
  const v1 = await readFixture(EXAMPLE_URL);
  const descriptor = migrationDescriptor();
  const { config, layout } = migrateCatalog(v1, descriptor);
  assertEquals(layout, record(v1).layout);
  assertEquals(Object.keys(record(config)).includes("layout"), false);
  assertEquals(`${JSON.stringify(config, null, 2)}\n`.endsWith("\n"), true);

  const mutated = structuredClone(v1);
  record(record(mutated).rules)["demo/max-params"] = {
    ...ruleOf(mutated, "demo/max-params"),
    limits: "A custom limit.",
  };
  const custom = migrateCatalog(mutated, descriptor).config;
  assertEquals(ruleOf(custom, "demo/max-params").limits, "A custom limit.");

  const largeText = await Deno.readTextFile(LARGE_URL);
  const large = JSON.parse(largeText) as JsonValue;
  const largeConfig = migrateCatalog(large, descriptor).config;
  const migratedText = `${JSON.stringify(largeConfig, null, 2)}\n`;
  assert(migratedText.split("\n").length < largeText.split("\n").length);
  const largeCompiled = compileConfig(largeConfig, descriptor);
  const largeIds = originalIds(large);
  assertEquals(
    semanticCompiledProjection(largeCompiled, descriptor, largeIds),
    semanticCatalogProjection(large, descriptor, largeIds),
  );
});

Deno.test("legacy_limits_round_trip_without_projection_loss", async () => {
  const v1 = await readFixture(EXAMPLE_URL);
  const descriptor = migrationDescriptor();
  const ownerLimits = TYPESCRIPT_RULE_PACK.rules["max-params"].meta.limits;
  const mutated = structuredClone(v1);
  record(record(mutated).rules)["demo/max-params"] = {
    ...ruleOf(mutated, "demo/max-params"),
    limits: "A custom limit.",
  };
  const { config } = migrateCatalog(mutated, descriptor);
  const compiled = compileConfig(config, descriptor);
  const ids = originalIds(mutated);
  assertEquals(
    semanticCompiledProjection(compiled, descriptor, ids),
    semanticCatalogProjection(mutated, descriptor, ids),
  );
  assertEquals(record(ruleOf(config, "demo/max-params")).limits, "A custom limit.");
  assertEquals(compiled.rules["demo/max-params"].meta.limits, "A custom limit.");
  assertEquals(compiled.rules["demo/max-params"].defaultLimits, ownerLimits);
  assertEquals(compiled.catalog.rules["demo/max-params"].limits, "A custom limit.");
  assertEquals(TYPESCRIPT_RULE_PACK.rules["max-params"].meta.limits, ownerLimits);
});
