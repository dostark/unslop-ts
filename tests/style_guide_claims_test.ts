/**
 * @module StyleGuideClaimsTest
 * @path tests/style_guide_claims_test.ts
 * @description Proves that the rule ids and the default limits that the style guide states match the rule packs and the option schemas.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [mod.ts, src/rules/mod.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  DENO_RULE_PACK,
  type IRulePack,
  type JsonValue,
  parseWholeTreeSettings,
  TYPESCRIPT_RULE_PACK,
} from "../mod.ts";

const GUIDE = await Deno.readTextFile(new URL("../docs/style_guide.md", import.meta.url));
const WHOLE_TREE_CHECKS = ["magic-literals", "duplicate-constant", "duplicate-type", "optional-params"];
const TABLE_RULE_ROW = /^\| `([a-z][a-z-]*)`/gm;
const BACKTICKED = /`([a-z][a-z-]*)`/g;

interface IDefaultClaim {
  readonly pack: IRulePack;
  readonly rule: string;
  readonly option: string;
  readonly value: JsonValue;
  readonly fragment: string;
}

const DEFAULT_CLAIMS: readonly IDefaultClaim[] = [
  { pack: TYPESCRIPT_RULE_PACK, rule: "max-params", option: "max", value: 7, fragment: "at most 7 parameters" },
  { pack: TYPESCRIPT_RULE_PACK, rule: "max-cyclomatic-complexity", option: "max", value: 15, fragment: "limit is 15" },
  {
    pack: TYPESCRIPT_RULE_PACK,
    rule: "max-class-size",
    option: "minClassLines",
    value: 200,
    fragment: "at least 200 lines",
  },
  { pack: TYPESCRIPT_RULE_PACK, rule: "max-class-size", option: "threshold", value: 60, fragment: "score of 60" },
  {
    pack: TYPESCRIPT_RULE_PACK,
    rule: "long-comment",
    option: "maxLines",
    value: 3,
    fragment: "longer than three lines",
  },
  {
    pack: TYPESCRIPT_RULE_PACK,
    rule: "test-inline-multiline-fixture",
    option: "minLines",
    value: 7,
    fragment: "at least 7 lines",
  },
  {
    pack: TYPESCRIPT_RULE_PACK,
    rule: "require-module-header",
    option: "maxStartLine",
    value: 5,
    fragment: "(5 by default)",
  },
  {
    pack: TYPESCRIPT_RULE_PACK,
    rule: "exported-interface-naming",
    option: "prefix",
    value: "I",
    fragment: "capital `I`",
  },
  {
    pack: TYPESCRIPT_RULE_PACK,
    rule: "require-optional-wrapper",
    option: "wrapperType",
    value: "Opt",
    fragment: "`Opt` by default",
  },
  {
    pack: DENO_RULE_PACK,
    rule: "require-deno-shebang",
    option: "shebang",
    value: "#!/usr/bin/env -S deno run -A",
    fragment: "#!/usr/bin/env -S deno run -A",
  },
  {
    pack: DENO_RULE_PACK,
    rule: "require-script-usage",
    option: "maxHeaderLines",
    value: 15,
    fragment: "first 15 lines",
  },
  {
    pack: DENO_RULE_PACK,
    rule: "ignore-needs-reason",
    option: "separator",
    value: "--",
    fragment: "(`--` by default)",
  },
];

function defaultOptions(pack: IRulePack, rule: string): Record<string, JsonValue> {
  const schema = pack.optionSchemas?.[rule];
  assert(schema !== undefined, `${rule} has no option schema`);
  return JSON.parse(JSON.stringify(schema.parse({})));
}

Deno.test("every rule id in a guide table is a rule of a pack or a whole-tree check", () => {
  const known = new Set([
    ...Object.keys(TYPESCRIPT_RULE_PACK.rules),
    ...Object.keys(DENO_RULE_PACK.rules),
    ...WHOLE_TREE_CHECKS,
  ]);
  const unknown = [...GUIDE.matchAll(TABLE_RULE_ROW)].map((match) => match[1]).filter((id) => !known.has(id));
  assertEquals(unknown, []);
});

Deno.test("every rule of both packs is named in the guide", () => {
  const named = new Set([...GUIDE.matchAll(BACKTICKED)].map((match) => match[1]));
  const missing = [...Object.keys(TYPESCRIPT_RULE_PACK.rules), ...Object.keys(DENO_RULE_PACK.rules)]
    .filter((id) => !named.has(id));
  assertEquals(missing, []);
});

Deno.test("the default limits that the guide states equal the option defaults", () => {
  for (const claim of DEFAULT_CLAIMS) {
    const options = defaultOptions(claim.pack, claim.rule);
    assertEquals(options[claim.option], claim.value, `${claim.rule}.${claim.option}`);
    assertStringIncludes(GUIDE, claim.fragment);
  }
});

Deno.test("the magic-literal defaults and the forbidden-ignore default in the guide equal the schemas", () => {
  const settings = parseWholeTreeSettings({ wholeTree: { magicLiterals: {} } });
  assertEquals(settings.magicLiterals?.thresholds, {
    localString: 3,
    globalString: 5,
    localNumber: 4,
    globalNumber: 6,
  });
  assertStringIncludes(GUIDE, "| Module (within a file) | more than 3 uses | more than 4 uses |");
  assertStringIncludes(GUIDE, "| Global (across files)  | more than 5 uses | more than 6 uses |");
  assertEquals(settings.magicLiterals?.minStringLength, 4);
  assertStringIncludes(GUIDE, "strings shorter than 4 characters");
  assertEquals(settings.magicLiterals?.minNumber, 100);
  assertStringIncludes(GUIDE, "absolute value below 100");
  assertEquals(defaultOptions(DENO_RULE_PACK, "no-forbidden-lint-ignore").forbiddenRules, ["no-explicit-any"]);
});
