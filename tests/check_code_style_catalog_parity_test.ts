/**
 * @module CheckCodeStyleCatalogParityTest
 * @path packages/lint-rules/tests/check_code_style_catalog_parity_test.ts
 * @description Parity between the catalog, the generated rule reference, both engines,
 *   `deno.json`, and the repository path policy.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/docs/style_rules.md, packages/lint-rules/src/exaix/check_code_style.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { PLUGIN_RULE_IMPLEMENTATIONS } from "@exaix/lint-rules";
import { IMPLEMENTED_SCRIPT_RULE_IDS } from "../src/exaix/check_code_style.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
const DOC_PATH = join(REPO_ROOT, "packages/lint-rules/docs/style_rules.md");
const CATALOG_PATH = join(REPO_ROOT, "scripts/config/style_rule_catalog.json");

interface IRuleEntry {
  engine: string;
  tags: string[];
  exclusionCodes?: Record<string, string>;
}
interface ICatalog {
  tagVocabulary: Record<string, { description?: string }>;
  rules: Record<string, IRuleEntry>;
}

const catalog = JSON.parse(await Deno.readTextFile(CATALOG_PATH)) as ICatalog;
const doc = await Deno.readTextFile(DOC_PATH);

/** Parses the generated `## Rule reference` table into id → tags. */
function parseDocRules(markdown: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const section = markdown.split("## Rule reference")[1]?.split("## Tag index")[0] ?? "";
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 7 || !/^`.+`$/.test(cells[1])) continue;
    const id = cells[1].slice(1, -1);
    const tags = [...cells[5].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    result.set(id, tags);
  }
  return result;
}

const docRules = parseDocRules(doc);

Deno.test("catalog rule ids and tags equal the generated rule reference", () => {
  const catalogIds = new Set(Object.keys(catalog.rules));
  assertEquals(new Set(docRules.keys()), catalogIds);
  for (const [id, entry] of Object.entries(catalog.rules)) {
    assertEquals([...docRules.get(id)!].sort(), [...entry.tags].sort(), `tags differ for ${id}`);
  }
});

Deno.test("every rule id is implemented by exactly one engine", () => {
  for (const [id, entry] of Object.entries(catalog.rules)) {
    if (entry.engine === "plugin") {
      assert(id in PLUGIN_RULE_IMPLEMENTATIONS, `plugin rule ${id} has no implementation`);
      assert(!IMPLEMENTED_SCRIPT_RULE_IDS.has(id), `plugin rule ${id} is also a script rule`);
    } else {
      assert(IMPLEMENTED_SCRIPT_RULE_IDS.has(id), `script rule ${id} has no implementation`);
      assert(!(id in PLUGIN_RULE_IMPLEMENTATIONS), `script rule ${id} is also a plugin rule`);
    }
  }
  for (const id of IMPLEMENTED_SCRIPT_RULE_IDS) {
    assertEquals(catalog.rules[id]?.engine, "script", `implemented script rule ${id} is not in the catalog`);
  }
});

Deno.test("deno.json lint.rules.exclude lists no exaix rule id", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as {
    lint?: { rules?: { exclude?: string[] } };
  };
  for (const id of denoJson.lint?.rules?.exclude ?? []) {
    assert(!id.startsWith("exaix/"), `deno.json excludes the exaix rule ${id}`);
  }
});

Deno.test("every exclusion code is used by a style-exclude line in the tree", async () => {
  const used = new Set<string>();
  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      skip: [/[/\\]\.git[/\\]/, /[/\\]node_modules[/\\]/, /[/\\]dist[/\\]/, /[/\\]coverage[/\\]/],
    })
  ) {
    const text = await Deno.readTextFile(entry.path);
    for (const match of text.matchAll(/style-exclude:([A-Z0-9_]+)/g)) used.add(match[1]);
  }
  for (const [id, entry] of Object.entries(catalog.rules)) {
    for (const code of Object.keys(entry.exclusionCodes ?? {})) {
      assert(used.has(code), `exclusion code ${code} of ${id} is never used by a style-exclude line`);
    }
  }
});

/** Removes comments and import/export module specifiers, keeping executable code. */
function stripNonCode(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .filter((line) => !/^\s*(import|export)\b.*\bfrom\b/.test(line))
    .join("\n");
}

const PATH_TOKEN = /(?<!@)(?:packages\/|apps\/|exaix-team\/|exaix-enterprise\/|tests\/|scripts\/|src\/)/g;
const EXAIX_SYMBOL = /@exaix\/|EventLogger|ConfigService/;

Deno.test("no repository path literal lives in the package sources", async () => {
  for await (
    const entry of walk(join(REPO_ROOT, "packages/lint-rules/src"), { includeDirs: false, exts: [".ts"] })
  ) {
    const code = stripNonCode(await Deno.readTextFile(entry.path));
    const matches = [...code.matchAll(PATH_TOKEN)].map((m) => m[0]);
    assertEquals(matches, [], `${entry.path} contains repository path literal(s): ${matches.join(", ")}`);
  }
});

Deno.test("the generic rule areas name no Exaix symbol", async () => {
  for (const area of ["engine", "rules"]) {
    for await (
      const entry of walk(join(REPO_ROOT, "packages/lint-rules/src", area), { includeDirs: false, exts: [".ts"] })
    ) {
      const code = stripNonCode(await Deno.readTextFile(entry.path));
      assert(
        !EXAIX_SYMBOL.test(code),
        `${entry.path} names an Exaix symbol in the generic rule area`,
      );
      assertEquals([...code.matchAll(PATH_TOKEN)].length, 0, `${entry.path} contains a repository path literal`);
    }
  }
});

Deno.test("the generated reference renders every tag", () => {
  for (const tag of Object.keys(catalog.tagVocabulary)) {
    assertStringIncludes(doc, `\`${tag}\``, `tag ${tag} is missing from the reference`);
  }
});
