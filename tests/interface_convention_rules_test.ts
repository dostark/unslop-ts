/**
 * @module InterfaceConventionRulesTest
 * @path tests/interface_convention_rules_test.ts
 * @description Cases for the interface naming and rename rules, their prefix option, and their off-by-default state in the example catalog.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/interface_convention_rules.ts, examples/unslop.config.json]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { findingsOf, linesOf, plainRun, runAt } from "./helpers/rule_runner.ts";
import { runDeno } from "./helpers/demo_project.ts";

const NAMING = "exported-interface-naming";
const RENAME = "no-interface-rename-on-import";

Deno.test("exported-interface-naming accepts names with a capital I prefix", () => {
  const valid: readonly (readonly [string, string])[] = [
    ["a prefixed name", "export interface IFoo {}"],
    ["the bare letter I", "export interface I {}"],
    ["a digit after the I", "export interface I2c {}"],
    ["an underscore after the I", "export interface I_x {}"],
    ["a non-exported interface", "interface Foo {}"],
    ["a type alias", "export type Foo = string;"],
    ["a default export, which the rule does not cover", "export default interface Foo {}"],
  ];
  for (const [name, source] of valid) assertEquals(linesOf(NAMING, plainRun(source)), [], name);
});

Deno.test("exported-interface-naming reports names without a capital I prefix", () => {
  const invalid: readonly (readonly [string, string, string])[] = [
    ["no prefix", "export interface Foo {}", "Foo"],
    ["a lowercase letter after the I", "export interface Ifoo {}", "Ifoo"],
    ["a word that starts with I", "export interface Interface {}", "Interface"],
    ["a declared interface", "export declare interface Foo {}", "Foo"],
  ];
  for (const [name, source, interfaceName] of invalid) {
    const found = findingsOf(NAMING, plainRun(source));
    assertEquals(found.length, 1, name);
    assertStringIncludes(found[0].message, `'${interfaceName}'`);
    assertStringIncludes(found[0].message, "capital 'I'");
  }
});

Deno.test("exported-interface-naming takes the prefix from options", () => {
  const options = { prefix: "T" };
  assertEquals(linesOf(NAMING, runAt("export interface TFoo {}", "packages/x/src/a.ts", options)), []);
  const found = findingsOf(NAMING, runAt("export interface IFoo {}", "packages/x/src/a.ts", options));
  assertEquals(found.length, 1);
  assertStringIncludes(found[0].message, "must start with a capital 'T'");
});

Deno.test("no-interface-rename-on-import reports an interface that an import renames", () => {
  const source = 'import { IFoo as Foo } from "./a.ts";\nimport type { IBar as Bar, Baz } from "./b.ts";\n';
  assertEquals(linesOf(RENAME, plainRun(source)), [1, 2]);
  const finding = findingsOf(RENAME, plainRun(source))[0];
  assertStringIncludes(finding.message, "Renaming interface 'IFoo' to 'Foo' is prohibited");
});

Deno.test("no-interface-rename-on-import reports a rename to another interface name", () => {
  assertEquals(linesOf(RENAME, plainRun('import { IFoo as IBar } from "./a.ts";\n')), [1]);
});

Deno.test("no-interface-rename-on-import reads a specifier on its own line", () => {
  const source = 'import {\n  IFoo as Foo,\n  Bar,\n} from "./a.ts";\n';
  assertEquals(linesOf(RENAME, plainRun(source)), [2]);
});

Deno.test("no-interface-rename-on-import ignores plain names, lowercase after the prefix, and unrenamed imports", () => {
  const source = [
    'import { Foo as Bar } from "./a.ts";',
    'import { Iron as Fe } from "./a.ts";',
    'import { IFoo } from "./a.ts";',
    'import IBaz from "./a.ts";',
    'import * as IQux from "./a.ts";',
    'export { IFoo as Foo } from "./a.ts";',
    "",
  ].join("\n");
  assertEquals(linesOf(RENAME, plainRun(source)), []);
});

Deno.test("no-interface-rename-on-import ignores import text in a comment or a string", () => {
  const source = '// import { IFoo as Foo } from "./a.ts";\nexport const text = "import { IFoo as Foo } from x";\n';
  assertEquals(linesOf(RENAME, plainRun(source)), []);
});

Deno.test("no-interface-rename-on-import takes the prefix from options", () => {
  const source = 'import { TFoo as Foo } from "./a.ts";\nimport { IBar as Bar } from "./b.ts";\n';
  assertEquals(linesOf(RENAME, runAt(source, "packages/x/src/a.ts", { prefix: "T" })), [1]);
});

const EXAMPLE_FILES = ["unslop.config.json", "unslop.project.ts", "lint_plugin.ts"];
const RENAME_VIOLATION = 'import { IFoo as Foo } from "./a.ts";\nexport interface Bar {}\nexport const x = Foo;\n';

async function exampleProject(dir: string): Promise<void> {
  const own = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
  await Deno.mkdir(join(dir, "examples"));
  for (const name of EXAMPLE_FILES) {
    await Deno.copyFile(new URL(`../examples/${name}`, import.meta.url), join(dir, "examples", name));
  }
  await Deno.writeTextFile(
    join(dir, "deno.json"),
    JSON.stringify({
      imports: { "@dostark/unslop-ts": new URL("../mod.ts", import.meta.url).href, zod: own.imports.zod },
      lint: { plugins: ["./examples/lint_plugin.ts"] },
    }),
  );
  await Deno.writeTextFile(join(dir, "violation.ts"), RENAME_VIOLATION);
}

async function codesOf(dir: string, env: Record<string, string>): Promise<(string | undefined)[]> {
  const result = await runDeno(["lint", "--json", "violation.ts"], dir, env);
  const report = JSON.parse(result.stdout) as { diagnostics?: { code?: string }[] };
  return (report.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}

Deno.test("the example configuration keeps both interface rules off until they are selected", async () => {
  const dir = await Deno.makeTempDir({ prefix: "interface_example_" });
  try {
    await exampleProject(dir);
    const silent = await codesOf(dir, {});
    assertEquals(silent.filter((code) => code?.startsWith("demo/")), []);
    const selected = await codesOf(dir, { DEMO_LINT_RULES: `demo/${NAMING},demo/${RENAME}` });
    assertEquals(selected.includes(`demo/${NAMING}`), true);
    assertEquals(selected.includes(`demo/${RENAME}`), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
