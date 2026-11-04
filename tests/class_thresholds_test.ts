/**
 * @module ClassThresholdsTest
 * @path tests/class_thresholds_test.ts
 * @description Proves that every default class detection threshold carries a value, an https source, an ISO retrieval date and the second-hand label, and that the rule options read their defaults from the one constants module.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/metrics/class_thresholds.ts, src/rules/rule_options.ts, src/metrics/constants.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { z } from "zod";
import * as constants from "../src/metrics/constants.ts";
import { CLASS_THRESHOLDS, SECOND_HAND_LABEL } from "../src/metrics/class_thresholds.ts";
import { TYPESCRIPT_OPTION_SCHEMAS } from "../src/rules/rule_options.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GodClassLimits = z.object({ wmcVeryHigh: z.number(), tccLimit: z.number(), atfdFew: z.number() });

Deno.test("thresholds-sourced: every default threshold has a value, an https source, an ISO retrieval date and the second-hand label", () => {
  const entries = Object.entries(CLASS_THRESHOLDS);
  assert(entries.length > 0, "no thresholds are recorded");
  for (const [name, threshold] of entries) {
    assert(Number.isFinite(threshold.value), `${name} has no numeric value`);
    assert(threshold.sources.length > 0, `${name} has no source`);
    for (const source of threshold.sources) assert(new URL(source).protocol === "https:", `${name}: ${source}`);
    assert(ISO_DATE.test(threshold.retrieved), `${name} has no ISO retrieval date`);
    assertFalse(Number.isNaN(Date.parse(threshold.retrieved)), `${name}: ${threshold.retrieved}`);
    assertEquals(threshold.label, SECOND_HAND_LABEL, name);
  }
});

Deno.test("thresholds-sourced: the rule options default to the recorded values and no second copy remains", () => {
  const defaults = GodClassLimits.parse(TYPESCRIPT_OPTION_SCHEMAS["max-class-size"].parse({}));
  assertEquals(defaults.wmcVeryHigh, CLASS_THRESHOLDS.wmcVeryHigh.value);
  assertEquals(defaults.tccLimit, CLASS_THRESHOLDS.tccLimit.value);
  assertEquals(defaults.atfdFew, CLASS_THRESHOLDS.atfdFew.value);
  const duplicated = Object.keys(constants).filter((name) => name.startsWith("DEFAULT_GOD_CLASS_"));
  assertEquals(duplicated, []);
});
