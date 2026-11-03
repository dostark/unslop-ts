/**
 * @module HeritageTest
 * @path tests/heritage_test.ts
 * @description The shared heritage reader: class heritage names on the Deno host AST and the resolution through bindings.
 * @architectural-layer Test
 * @related-files [src/metrics/heritage.ts, src/rules/whole_tree/unused_class_members.ts, tests/helpers/class_measurement.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { heritageNamesOfClass, resolveHeritage } from "../src/metrics/heritage.ts";
import { classNodesOf } from "./helpers/class_measurement.ts";

Deno.test("heritage-shared: the names of extends and implements are read, and a computed base is null", () => {
  const [plain, computed] = classNodesOf(
    "class A extends B implements C, D {}\nclass E extends mixin(F) {}\nclass G {}",
  );
  assertEquals(heritageNamesOfClass(plain), ["B", "C", "D"]);
  assertEquals(heritageNamesOfClass(computed), [null]);
  assertEquals(heritageNamesOfClass(classNodesOf("class G {}")[0]), []);
});

Deno.test("heritage-shared: a name resolves through the lookup and a base that is not a plain name resolves to nothing", () => {
  const bindings = new Map([["B", ["defB"]], ["C", ["defC1", "defC2"]]]);
  const found = resolveHeritage(["B", null, "C", "Missing"], (name) => bindings.get(name) ?? []);
  assertEquals(found, ["defB", "defC1", "defC2"]);
});

Deno.test("heritage-shared: the unused-member check reads its parents through the shared resolution", async () => {
  const source = await Deno.readTextFile(new URL("../src/rules/whole_tree/unused_class_members.ts", import.meta.url));
  assertStringIncludes(source, 'from "../../metrics/heritage.ts"');
  assertStringIncludes(source, "resolveHeritage(");
});
