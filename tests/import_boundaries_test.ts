/**
 * @module ImportBoundariesTest
 * @path tests/import_boundaries_test.ts
 * @description Zone cases for the import-boundaries rule: specifier, target, outside, except, and message text.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/import_boundaries.ts, src/rules/mod.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { CatalogError, type JsonValue } from "../mod.ts";
import { findingsOf, linesOf, runAt } from "./helpers/rule_runner.ts";
import { loadTestCatalog } from "./helpers/registry.ts";

const RULE = "import-boundaries";
const UI_FILE = "apps/ui/src/view.ts";
const NESTED_UI_FILE = "apps/ui/src/views/list.ts";

function zones(...entries: JsonValue[]): Record<string, JsonValue> {
  return { zones: entries };
}

function zone(id: string, deny: JsonValue[], extra: Record<string, JsonValue> = {}): JsonValue {
  return { id, files: ["apps/ui/src/**"], deny, ...extra };
}

const SERVICES = zone("ui-services", [{ specifier: "^(\\.\\.\\/)+services\\/", message: "Do not import services." }]);

Deno.test("a specifier condition denies a matching import at any parent depth", () => {
  for (const depth of ["../", "../../", "../../../"]) {
    const source = `import { a } from "${depth}services/x.ts";\n`;
    assertEquals(linesOf(RULE, runAt(source, UI_FILE, zones(SERVICES))), [1], depth);
  }
  assertEquals(linesOf(RULE, runAt('import { a } from "../lib/x.ts";\n', UI_FILE, zones(SERVICES))), []);
});

Deno.test("a rule outside the zone files stays silent", () => {
  const source = 'import { a } from "../services/x.ts";\n';
  assertEquals(linesOf(RULE, runAt(source, "apps/api/src/view.ts", zones(SERVICES))), []);
});

Deno.test("an except glob removes a file from the zone", () => {
  const withExcept = zone("ui", [{ specifier: "services", message: "no" }], { except: ["apps/ui/src/legacy/**"] });
  const source = 'import { a } from "../services/x.ts";\n';
  assertEquals(linesOf(RULE, runAt(source, "apps/ui/src/legacy/a.ts", zones(withExcept))), []);
  assertEquals(linesOf(RULE, runAt(source, "apps/ui/src/a.ts", zones(withExcept))), [1]);
});

Deno.test("a target condition matches the path that a relative specifier resolves to", () => {
  const targetZone = zone("no-api", [{ target: ["apps/api/**"], message: "Do not reach into the API." }]);
  const source = 'import { a } from "../../api/src/x.ts";\n';
  assertEquals(linesOf(RULE, runAt(source, NESTED_UI_FILE, zones(targetZone))), []);
  const direct = 'import { a } from "../../../api/src/x.ts";\n';
  assertEquals(linesOf(RULE, runAt(direct, NESTED_UI_FILE, zones(targetZone))), [1]);
  const sibling = 'import { a } from "./x.ts";\n';
  assertEquals(linesOf(RULE, runAt(sibling, NESTED_UI_FILE, zones(targetZone))), []);
});

Deno.test("a repo-rooted specifier is its own resolved path, and an alias or a scheme has none", () => {
  const targetZone = zone("no-tests", [{ target: ["tests", "tests/**"], message: "No test code." }]);
  assertEquals(linesOf(RULE, runAt('import { a } from "tests/helpers/x.ts";\n', UI_FILE, zones(targetZone))), [1]);
  assertEquals(linesOf(RULE, runAt('import { a } from "@scope/tests";\n', UI_FILE, zones(targetZone))), []);
  assertEquals(linesOf(RULE, runAt('import { a } from "npm:tests/x";\n', UI_FILE, zones(targetZone))), []);
  assertEquals(linesOf(RULE, runAt('import { a } from "../../../tests/x.ts";\n', UI_FILE, zones(targetZone))), [1]);
});

Deno.test("an outside condition denies a resolved path outside the glob", () => {
  const helpers = zone("ui-helpers", [{
    specifier: "^(\\.\\.\\/)+helpers\\/",
    outside: ["apps/ui/src/**"],
    message: "Helpers live under the source root.",
  }]);
  assertEquals(linesOf(RULE, runAt('import { a } from "../helpers/x.ts";\n', UI_FILE, zones(helpers))), [1]);
  assertEquals(linesOf(RULE, runAt('import { a } from "../helpers/x.ts";\n', NESTED_UI_FILE, zones(helpers))), []);
  assertEquals(linesOf(RULE, runAt('import { a } from "../../helpers/x.ts";\n', NESTED_UI_FILE, zones(helpers))), [1]);
});

Deno.test("every condition of a deny entry must hold", () => {
  const both = zone("both", [{ specifier: "services", target: ["apps/api/**"], message: "no" }]);
  assertEquals(
    linesOf(RULE, runAt('import { a } from "../../../api/src/services/x.ts";\n', NESTED_UI_FILE, zones(both))),
    [1],
  );
  assertEquals(
    linesOf(RULE, runAt('import { a } from "../../../api/src/other/x.ts";\n', NESTED_UI_FILE, zones(both))),
    [],
  );
});

Deno.test("a re-export, an export-all, and a type import count as imports", () => {
  const source = [
    'export { a } from "../services/x.ts";',
    'export * from "../services/y.ts";',
    'import type { T } from "../services/z.ts";',
    "",
  ].join("\n");
  assertEquals(linesOf(RULE, runAt(source, UI_FILE, zones(SERVICES))), [1, 2, 3]);
});

Deno.test("an import clause that spans lines is reported once, at the import", () => {
  const source = 'import {\n  a,\n  b,\n} from "../services/x.ts";\n';
  assertEquals(linesOf(RULE, runAt(source, UI_FILE, zones(SERVICES))), [1]);
});

Deno.test("import text in a comment or a string is not an import", () => {
  const source =
    '// import { a } from "../services/x.ts";\nexport const text = \'import { a } from "../services/x.ts"\';\n';
  assertEquals(linesOf(RULE, runAt(source, UI_FILE, zones(SERVICES))), []);
});

Deno.test("a report names the zone and fills the specifier and target placeholders", () => {
  const placeholders = zone("ui-api", [{
    target: ["apps/api/**"],
    message: "Import '{specifier}' resolves to '{target}'.",
  }]);
  const finding = findingsOf(RULE, runAt('import { a } from "../../api/src/x.ts";\n', UI_FILE, zones(placeholders)))[0];
  assertStringIncludes(finding.message, "ui-api");
  assertStringIncludes(finding.message, "Import '../../api/src/x.ts' resolves to 'apps/api/src/x.ts'.");
});

Deno.test("two zones can report the same import, and a zone reports it once", () => {
  const second = zone("second", [{ specifier: "services", message: "Second." }, {
    specifier: "x\\.ts",
    message: "Third.",
  }]);
  const source = 'import { a } from "../services/x.ts";\n';
  assertEquals(findingsOf(RULE, runAt(source, UI_FILE, zones(SERVICES, second))).length, 2);
});

function catalogWith(options: Record<string, JsonValue>): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: { test: ["**/tests/**"], fixture: [] },
    tagVocabulary: { boundary: { description: "Boundary rules." } },
    rules: {
      "demo/import-boundaries": { engine: "plugin", severity: "error", scope: "all", tags: ["boundary"], options },
    },
  };
}

Deno.test("parseCatalog rejects a deny entry with no condition and names the zone", () => {
  const broken = catalogWith(zones(zone("empty-entry", [{ message: "No condition." }])));
  const error = assertThrows(() => loadTestCatalog(broken), CatalogError);
  assertStringIncludes(error.message, "empty-entry");
});

Deno.test("parseCatalog rejects a specifier that does not compile and names the zone", () => {
  const broken = catalogWith(zones(zone("bad-regex", [{ specifier: "([unclosed", message: "Bad." }])));
  const error = assertThrows(() => loadTestCatalog(broken), CatalogError);
  assertStringIncludes(error.message, "bad-regex");
});

Deno.test("parseCatalog accepts a valid zone and a zone without except", () => {
  loadTestCatalog(catalogWith(zones(SERVICES)));
});
