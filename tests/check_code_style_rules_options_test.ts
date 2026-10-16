/**
 * @module CheckCodeStyleRulesOptionsTest
 * @path packages/lint-rules/tests/check_code_style_rules_options_test.ts
 * @description In-process `checkSource` cases proving catalog options drive rule behavior.
 */

import { assertEquals } from "@std/assert";
import { type ICatalog, type JsonValue, parseCatalog } from "@exaix/lint-rules";
import { checkSource } from "../src/exaix/check_code_style.ts";
import catalogJson from "../../../scripts/config/style_rule_catalog.json" with { type: "json" };

const PROD = "packages/x/src/a.ts";

function catalogWith(patch: (rules: Record<string, JsonValue>) => void): ICatalog {
  const clone = structuredClone(catalogJson) as Record<string, JsonValue>;
  patch(clone.rules as Record<string, JsonValue>);
  return parseCatalog(clone);
}

Deno.test("catalog max-params lowers the parameter ceiling", () => {
  const source =
    "export function f(a: number, b: number, c: number, d: number): number {\n  return a + b + c + d;\n}\n";
  const catalog = catalogWith((rules) => {
    (rules["max-params"] as Record<string, JsonValue>).options = { max: 3 };
  });
  assertEquals(checkSource(PROD, source, catalog).filter((f) => f.rule === "max-params").length, 1);
});

Deno.test("catalog long-comment maxLines raises the accepted comment length", () => {
  const source = "export const x = 1;\n/**\n * one\n * two\n */\nexport const y = 2;\n";
  const raised = catalogWith((rules) => {
    (rules["long-comment"] as Record<string, JsonValue>).options = { maxLines: 5 };
  });
  assertEquals(checkSource(PROD, source, raised).filter((f) => f.rule === "long-comment").length, 0);
});

Deno.test("default long-comment maxLines reports the same comment", () => {
  const source = "export const x = 1;\n/**\n * one\n * two\n */\nexport const y = 2;\n";
  const findings = checkSource(PROD, source, parseCatalog(catalogJson)).filter((f) => f.rule === "long-comment");
  assertEquals(findings.length, 1);
});

Deno.test("checkSource returns in-process findings without printing", () => {
  const source = "export type A = Promise<" + "Response>;\nexport function f(): Promise<" +
    "Response> {\n  return fetch('x');\n}\n";
  const findings = checkSource(PROD, source, parseCatalog(catalogJson));
  assertEquals(
    findings.some((f) => f.rule === "promise-response-alias" && f.line === 1 && f.severity === "error"),
    true,
  );
  assertEquals(findings.some((f) => f.rule === "promise-response-return" && f.line === 2), true);
});

Deno.test("a long YAML comment is reported under the configured extensions", () => {
  const source = "key: value\n# one\n# two\n# three\n# four\nother: value\n";
  const findings = checkSource("configs/probe.yaml", source, parseCatalog(catalogJson)).filter((f) =>
    f.rule === "long-comment"
  );
  assertEquals(findings.length, 1);
});

Deno.test("catalog long-comment maxLines raises the YAML comment length too", () => {
  const source = "key: value\n# one\n# two\n# three\n# four\nother: value\n";
  const raised = catalogWith((rules) => {
    (rules["long-comment"] as Record<string, JsonValue>).options = { maxLines: 5, extensions: [".yaml"] };
  });
  assertEquals(checkSource("configs/probe.yaml", source, raised).filter((f) => f.rule === "long-comment").length, 0);
});

Deno.test("catalog long-comment extensions filter a file out", () => {
  const source = "key: value\n# one\n# two\n# three\n# four\nother: value\n";
  const filtered = catalogWith((rules) => {
    (rules["long-comment"] as Record<string, JsonValue>).options = { maxLines: 3, extensions: [".ts"] };
  });
  assertEquals(checkSource("configs/probe.yaml", source, filtered).filter((f) => f.rule === "long-comment").length, 0);
});

Deno.test("a leading YAML comment block is exempt, like a module header", () => {
  const source = "# one\n# two\n# three\n# four\nkey: value\n";
  assertEquals(
    checkSource("configs/probe.yaml", source, parseCatalog(catalogJson)).filter((f) => f.rule === "long-comment")
      .length,
    0,
  );
});

Deno.test("the shipped TOML override raises the limit, and removing it reports the comment", () => {
  const source = 'key = "value"\n# one\n# two\n# three\n# four\n# five\nother = "v"\n';
  assertEquals(
    checkSource("configs/probe.toml", source, parseCatalog(catalogJson)).filter((f) => f.rule === "long-comment")
      .length,
    0,
  );
  const withoutOverride = catalogWith((rules) => {
    (rules["long-comment"] as Record<string, JsonValue>).options = {
      maxLines: 3,
      extensions: [".toml"],
      overrides: {},
    };
  });
  assertEquals(
    checkSource("configs/probe.toml", source, withoutOverride).filter((f) => f.rule === "long-comment").length,
    1,
  );
});

Deno.test("a long JSONC line comment is reported", () => {
  const source = '{\n  // one\n  // two\n  // three\n  // four\n  "a": 1\n}\n';
  assertEquals(
    checkSource("configs/probe.jsonc", source, parseCatalog(catalogJson)).filter((f) => f.rule === "long-comment")
      .length,
    1,
  );
});
