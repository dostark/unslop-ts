/**
 * @module RuleMetaTest
 * @path tests/rule_meta_test.ts
 * @description Proves every engine descriptor carries complete metadata and that category, preset, and guide anchor match the plan table.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/rules/meta.ts, src/rules/mod.ts, src/rules/whole_tree/checks.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  DENO_RULE_PACK,
  DESCRIPTION_MAX_LENGTH,
  type IRuleControls,
  type IRuleMeta,
  PLUGIN_RULE_CONTROLS,
  PRESET_MEMBERSHIPS,
  RULE_CATEGORIES,
  TYPESCRIPT_RULE_PACK,
  WHOLE_TREE_CHECKS,
} from "../mod.ts";
import { ESLINT_RULE_TYPE } from "../eslint.ts";
import table from "./cases/rule_meta_table.json" with { type: "json" };

interface IDescriptor {
  readonly id: string;
  readonly meta: IRuleMeta;
  readonly controls: IRuleControls;
}

const PACK_RULE_COUNT = 40;
const WHOLE_TREE_CHECK_COUNT = 7;
const DESCRIPTOR_COUNT = PACK_RULE_COUNT + WHOLE_TREE_CHECK_COUNT;
const GUIDE_ANCHOR = /^#[a-z0-9-]+$/;
const EMPTY = 0;
const FIRST_CHARACTER = 0;
const SORTED_ORDER = (left: string, right: string): number => left.localeCompare(right);

function descriptors(): IDescriptor[] {
  const found: IDescriptor[] = [];
  for (const pack of [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]) {
    for (const [id, rule] of Object.entries(pack.rules)) {
      found.push({ id, meta: rule.meta, controls: PLUGIN_RULE_CONTROLS });
    }
  }
  for (const [id, check] of Object.entries(WHOLE_TREE_CHECKS)) {
    found.push({ id, meta: check.meta, controls: check.controls });
  }
  return found;
}

function tableRows(): { id: string; category: string; preset: string; docs: string }[] {
  return [...table.rules].sort((left, right) => SORTED_ORDER(left.id, right.id));
}

Deno.test("every_rule_and_check_has_metadata", () => {
  const found = descriptors();
  assertEquals(found.length, DESCRIPTOR_COUNT);
  assertEquals(
    Object.keys(TYPESCRIPT_RULE_PACK.rules).length + Object.keys(DENO_RULE_PACK.rules).length,
    PACK_RULE_COUNT,
  );
  assertEquals(Object.keys(WHOLE_TREE_CHECKS).length, WHOLE_TREE_CHECK_COUNT);
  for (const descriptor of found) {
    const { id, meta, controls } = descriptor;
    assert(meta.description.trim().length > EMPTY, `${id} has an empty description`);
    assert(meta.description.length <= DESCRIPTION_MAX_LENGTH, `${id} description is too long`);
    assertEquals(
      meta.description[FIRST_CHARACTER],
      meta.description[FIRST_CHARACTER].toUpperCase(),
      `${id} starts lower case`,
    );
    assert(RULE_CATEGORIES.includes(meta.category), `${id} has an unknown category`);
    assert(PRESET_MEMBERSHIPS.includes(meta.preset), `${id} has an unknown preset`);
    assert(GUIDE_ANCHOR.test(meta.docs), `${id} has a malformed docs anchor`);
    assert(meta.limits === null || meta.limits.length > EMPTY, `${id} has an empty limits text`);
    assert(controls.editable.length > EMPTY, `${id} declares no editable field`);
    assert(Object.keys(controls.hostModes).length > EMPTY, `${id} declares no host mode`);
  }
});

Deno.test("metadata_matches_the_category_table", () => {
  const actual = descriptors()
    .map(({ id, meta }) => ({ id, category: meta.category, preset: meta.preset, docs: meta.docs }))
    .sort((left, right) => SORTED_ORDER(left.id, right.id));
  assertEquals(actual, tableRows());
});

Deno.test("every_docs_anchor_exists_in_the_guide", async () => {
  const guide = await Deno.readTextFile(new URL("../docs/style_guide.md", import.meta.url));
  for (const { id, meta } of descriptors()) {
    assertStringIncludes(guide, `{#${meta.docs.slice(1)}}`, `${id} anchor ${meta.docs} is missing`);
  }
});

Deno.test("whole_tree_checks_declare_only_option_edits_and_their_host_modes", () => {
  const expectedFixedLevel = {
    "duplicate-type": "error",
    "duplicate-constant": "error",
    "magic-literals": "error",
    "constant-restatement": "error",
    "unused-exports": null,
    "unused-files": null,
    "optional-params": null,
  };
  for (const [id, check] of Object.entries(WHOLE_TREE_CHECKS)) {
    assertEquals(check.controls.editable, ["options"], `${id} must allow option edits only`);
    assertEquals(
      check.controls.fixedLevel,
      expectedFixedLevel[id as keyof typeof expectedFixedLevel],
      `${id} declares the wrong fixed level`,
    );
    assert(check.command.length > EMPTY, `${id} declares no host command`);
    assertStringIncludes(check.command.join(" "), `--rule=${id}`);
  }
  assertEquals(Object.keys(WHOLE_TREE_CHECKS["unused-exports"].controls.hostModes).includes("--fail"), true);
  assertEquals(WHOLE_TREE_CHECKS["unused-exports"].controls.hostModes["--fail"], "error");
  assertEquals(WHOLE_TREE_CHECKS["optional-params"].controls.hostModes["--fail"], "error");
  assertEquals(WHOLE_TREE_CHECKS["optional-params"].controls.hostModes["--staged"], "error");
});

Deno.test("every plugin rule declares requiresTestGlobs and only the test-aware rules set it", () => {
  const testAware = new Set([
    "barrel-only-reexports",
    "no-chained-type-assertions",
    "no-typeof-escape",
    "require-module-header",
  ]);
  for (const pack of [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]) {
    for (const [key, rule] of Object.entries(pack.rules)) {
      assertEquals(typeof rule.requiresTestGlobs, "boolean", key);
      assertEquals(rule.requiresTestGlobs, testAware.has(key), key);
    }
  }
});

Deno.test("the ESLint type map covers every rule category", () => {
  assertEquals(Object.keys(ESLINT_RULE_TYPE).sort(), [...RULE_CATEGORIES].sort());
});
