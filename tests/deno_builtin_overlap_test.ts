/**
 * @module DenoBuiltinOverlapTest
 * @path tests/deno_builtin_overlap_test.ts
 * @description Keeps the engine rule packs from duplicating or shadowing a built-in `deno lint` rule.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/rules/type_safety_rules.ts]
 */

import { assertArrayIncludes, assertEquals, assertNotEquals } from "@std/assert";
import { DEMO_PLUGIN_NAME, lintJson, packRuleKeys, runDeno, withDemoProject } from "./helpers/demo_project.ts";

const OVERLAP_KIND = {
  duplicate: "duplicate",
  related: "related",
  incidental: "incidental",
} as const;

type OverlapKind = typeof OVERLAP_KIND[keyof typeof OVERLAP_KIND];

interface IOverlapCase {
  /** The bare pack rule the snippet must trigger, or null for a snippet that only exercises the runner. */
  readonly rule: string | null;
  readonly name: string;
  readonly source: string;
  readonly isTestFile?: boolean;
  /** A file name that replaces the generated one, for a rule that reads the name. */
  readonly fileName?: string;
  /** Every built-in code that fires on the snippet, with the reason it may. */
  readonly expectedBuiltins: Readonly<Record<string, OverlapKind>>;
}

interface ICollectedCase {
  readonly builtins: readonly string[];
  readonly ownRuleReported: boolean;
}

/** Non-recommended built-ins that a consumer enables on top of the recommended set. */
const CONSUMER_BUILTIN_RULES = ["explicit-module-boundary-types"];
const DECLARATIONS = "declare const input: string;\n";

const IMPORT_CALL = "import";
const RESPONSE_PROMISE = ["Promise", "<Response>"].join("");
const PRAGMA_IGNORE = ["@ts", "ignore"].join("-");
const MULTILINE_YAML = "export const yaml = `\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\nf: 6\ng: 7\n`;\n";
const FAST_OR_SLOW = ['"fast"', '"slow"'].join(" | ");

const CASES: readonly IOverlapCase[] = [
  {
    rule: "barrel-only-reexports",
    name: "a named re-export outside a barrel",
    source: 'export { join } from "@std/path";\n',
    expectedBuiltins: {},
  },
  {
    rule: "prefer-named-imports",
    name: "a namespace import read only through members",
    source: 'import * as path from "@std/path";\n\nexport const joined = path.join("a", "b");\n',
    expectedBuiltins: {},
  },
  {
    rule: "no-chained-type-assertions",
    name: "an as unknown as chain",
    source: `${DECLARATIONS}export const value = input as unknown as number;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "no-explicit-unknown",
    name: "an unknown annotation",
    source: "export const loose: unknown = 1;\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-unsafe-dictionary",
    name: "a Record with unknown values",
    source: "export const table: Record<string, unknown> = {};\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-typeof-escape",
    name: "an as typeof cast",
    source: `${DECLARATIONS}export const value = input as typeof Math;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "no-pass-through-type-alias",
    name: "an alias of an alias",
    source: 'type Base = string;\ntype Same = Base;\nexport const value: Same = "";\n',
    expectedBuiltins: {},
  },
  {
    rule: "no-object-parameters",
    name: "an object parameter",
    source: "export function take(value: object): number {\n  return Object.keys(value).length;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "require-safety-comment",
    name: "a type assertion without a marker",
    source: `${DECLARATIONS}export const value = input as string;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "no-runtime-typeof",
    name: "a typeof comparison",
    source: `${DECLARATIONS}export const isText = typeof input === "string";\n`,
    expectedBuiltins: {},
  },
  {
    rule: "no-conditional-empty-object-spread",
    name: "a spread of a conditional with an empty branch",
    source: "export const merged = { ...(Math.random() > 0.5 ? { a: 1 } : {}) };\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-boolean-assert",
    name: "assertEquals on includes and true",
    isTestFile: true,
    source: 'export function check(): void {\n  assertEquals("abc".includes("b"), true);\n}\n',
    expectedBuiltins: {},
  },
  {
    rule: "no-repeated-assert-call",
    name: "two adjacent assertions on one call",
    isTestFile: true,
    source: "export function check(x: number): void {\n  assertEquals(f(x), 1);\n  assertEquals(f(x), 2);\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-constant-substring-assert",
    name: "a substring assertion on an imported constant",
    isTestFile: true,
    source: 'import { THINGS } from "./t.ts";\nexport function check(): void {\n  assert(THINGS.includes("X"));\n}\n',
    expectedBuiltins: {},
  },
  {
    rule: "max-cyclomatic-complexity",
    name: "a function with a branch",
    source: "export function pick(flag: boolean): number {\n  if (flag) return 1;\n  return 2;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "max-class-size",
    name: "a class with methods",
    source: "export class Big {\n  one(): number {\n    return 1;\n  }\n  two(): number {\n    return 2;\n  }\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "require-optional-wrapper",
    name: "a bare optional parameter",
    source: "export function take(value?: string): string {\n  return String(value);\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "ignore-needs-reason",
    name: "an ignore of a plugin rule without a reason",
    source: "// deno-lint-ignore demo/no-runtime-typeof\nexport const value = 1;\n",
    expectedBuiltins: { "ban-unused-ignore": OVERLAP_KIND.incidental },
  },
  {
    rule: "no-forbidden-lint-ignore",
    name: "an ignore of no-explicit-any",
    source: "// deno-lint-ignore no-explicit-any\nexport const value: any = 1;\n",
    expectedBuiltins: {},
  },
  {
    rule: "require-deno-shebang",
    name: "a file without a shebang",
    source: "export const value = 1;\n",
    expectedBuiltins: {},
  },
  {
    rule: "prefer-named-imports",
    name: "a namespace import read only through members",
    source: 'import * as path from "@std/path";\n\nexport const joined = path.join("a", "b");\n',
    expectedBuiltins: {},
  },
  {
    rule: "no-chained-type-assertions",
    name: "an angle-bracket chain",
    source: `${DECLARATIONS}export const value = <number> (<unknown> input);\n`,
    expectedBuiltins: {},
  },
  {
    rule: "no-explicit-unknown",
    name: "an unknown array parameter",
    source: "export function sizeOf(items: unknown[]): number {\n  return items.length;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-unsafe-dictionary",
    name: "a Map with unknown values",
    source: "export const cache: Map<string, unknown> = new Map();\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-typeof-escape",
    name: "an angle-bracket typeof cast",
    source: `${DECLARATIONS}export const value = <typeof Math> input;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "no-object-parameters",
    name: "an object parameter of an arrow function",
    source: "export const sizeOf = (value: object): number => Object.keys(value).length;\n",
    expectedBuiltins: {},
  },
  {
    rule: "require-safety-comment",
    name: "an angle-bracket assertion without a marker",
    source: `${DECLARATIONS}export const value = <string> input;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "no-runtime-typeof",
    name: "a misspelled typeof comparison",
    source: `${DECLARATIONS}export const isText = typeof input === "strng";\n`,
    expectedBuiltins: { "valid-typeof": OVERLAP_KIND.related },
  },
  {
    rule: "no-conditional-empty-object-spread",
    name: "a spread with the empty branch second",
    source: "export const merged = { ...(Math.random() > 0.5 ? {} : { a: 1 }) };\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-boolean-assert",
    name: "assert on startsWith",
    isTestFile: true,
    source: 'export function check(): void {\n  assert("abc".startsWith("a"));\n}\n',
    expectedBuiltins: {},
  },
  {
    rule: "no-repeated-assert-call",
    name: "two adjacent assertStrictEquals calls",
    isTestFile: true,
    source:
      "export function check(x: number): void {\n  assertStrictEquals(f(x), 1);\n  assertStrictEquals(f(x), 2);\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-constant-substring-assert",
    name: "assertStringIncludes on an imported constant",
    isTestFile: true,
    source:
      'import { THINGS } from "./t.ts";\nexport function check(): void {\n  assertStringIncludes(THINGS, "X");\n}\n',
    expectedBuiltins: {},
  },
  {
    rule: "max-cyclomatic-complexity",
    name: "a function with a ternary",
    source: "export function pick(flag: boolean): number {\n  return flag ? 1 : 2;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "require-optional-wrapper",
    name: "a bare undefined union parameter",
    source: "export function take(value: string | undefined): string {\n  return String(value);\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "ignore-needs-reason",
    name: "a file ignore of a plugin rule without a reason",
    source: "// deno-lint-ignore-file demo/no-runtime-typeof\nexport const value = 1;\n",
    expectedBuiltins: { "ban-unused-ignore": OVERLAP_KIND.incidental },
  },
  {
    rule: "no-forbidden-lint-ignore",
    name: "a file ignore of no-explicit-any",
    source: "// deno-lint-ignore-file no-explicit-any\nexport const value: any = 1;\n",
    expectedBuiltins: {},
  },
  {
    rule: "import-inside-statement",
    name: "a dynamic import inside a function",
    source: `export function load(): Promise<unknown> {\n  return ${IMPORT_CALL}("./b.ts");\n}\n`,
    expectedBuiltins: {},
  },
  {
    rule: "import-inside-statement",
    name: "a dynamic import inside an if block",
    source:
      `export async function load(flag: boolean): Promise<void> {\n  if (flag) {\n    await ${IMPORT_CALL}("./b.ts");\n  }\n}\n`,
    expectedBuiltins: {},
  },
  {
    rule: "dynamic-import",
    name: "a dynamic import at the top level",
    source: `export const loaded = await ${IMPORT_CALL}("./b.ts");\n`,
    expectedBuiltins: {},
  },
  {
    rule: "dynamic-import",
    name: "a dynamic import returned from a function",
    source: `export function load(): Promise<unknown> {\n  return ${IMPORT_CALL}("./b.ts");\n}\n`,
    expectedBuiltins: {},
  },
  {
    rule: "inline-type-import",
    name: "an import type with a member in a type argument",
    source: `export type Loaded = Promise<${IMPORT_CALL}("./b.ts").IThing>;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "inline-type-import",
    name: "an import type with a member in a return type",
    source: `export function find(): ${IMPORT_CALL}("./b.ts").IThing | null {\n  return null;\n}\n`,
    expectedBuiltins: {},
  },
  {
    rule: "re-export-imported",
    name: "a named export from another module",
    source: 'export { value } from "./b.ts";\n',
    expectedBuiltins: {},
  },
  {
    rule: "re-export-imported",
    name: "an export of everything from another module",
    source: 'export * from "./b.ts";\n',
    expectedBuiltins: {},
  },
  {
    rule: "import-placement",
    name: "an import after a constant",
    source: 'export const first = 1;\nimport "./b.ts";\n',
    expectedBuiltins: {},
  },
  {
    rule: "import-placement",
    name: "an import after an interface",
    source: 'export interface IThing {\n  readonly a: number;\n}\nimport "./b.ts";\n',
    expectedBuiltins: {},
  },
  {
    rule: "exported-interface-placement",
    name: "an exported interface after a constant",
    source: "export const first = 1;\nexport interface IThing {\n  readonly a: number;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "long-comment",
    name: "a four-line comment below the code",
    source: "export const first = 1;\n// one\n// two\n// three\n// four\nexport const second = 2;\n",
    expectedBuiltins: {},
  },
  {
    rule: "long-comment",
    name: "a five-line block comment below the code",
    source: "export const first = 1;\n/*\n * one\n * two\n * three\n */\nexport const second = 2;\n",
    expectedBuiltins: {},
  },
  {
    rule: "ephemeral-comment",
    name: "a calendar date in a comment",
    source: "// done on 2026-10-20\nexport const value = 1;\n",
    expectedBuiltins: {},
  },
  {
    rule: "ephemeral-comment",
    name: "a narration of a prior attempt",
    source: "export const first = 1;\n// we tried a loop first\nexport const second = 2;\n",
    expectedBuiltins: {},
  },
  {
    rule: "decorative-comment",
    name: "a separator line of equal signs",
    source: "export const first = 1;\n// ==========\nexport const second = 2;\n",
    expectedBuiltins: {},
  },
  {
    rule: "decorative-comment",
    name: "a separator line inside a block comment",
    source: "export const first = 1;\n/*\n * ------\n */\nexport const second = 2;\n",
    expectedBuiltins: {},
  },
  {
    rule: "max-params",
    name: "a function with eight parameters",
    source:
      "export function take(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {\n  return a + b + c + d + e + f + g + h;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "max-params",
    name: "an arrow function with eight parameters",
    source:
      "export const take = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number =>\n  a + b + c + d + e + f + g + h;\n",
    expectedBuiltins: {},
  },
  {
    rule: "test-inline-multiline-fixture",
    name: "a named multi-line template",
    source: MULTILINE_YAML,
    expectedBuiltins: {},
  },
  {
    rule: "test-inline-multiline-fixture",
    name: "a document fixture of any size",
    source: "export const anything = `\nschema_version: 1\n`;\n",
    expectedBuiltins: {},
  },
  {
    rule: "require-module-header",
    name: "a file with no comment",
    source: "export const value = 1;\n",
    expectedBuiltins: {},
  },
  {
    rule: "require-module-header",
    name: "a file whose only comment follows the code",
    source: "export const value = 1;\n// late note\n",
    expectedBuiltins: {},
  },
  {
    rule: "ephemeral-filename",
    name: "a numbered phase in a test file name",
    source: "export const value = 1;\n",
    isTestFile: true,
    fileName: "case_phase12_test.ts",
    expectedBuiltins: {},
  },
  {
    rule: "require-script-usage",
    name: "a header without a usage section",
    source: "/**\n * @module S\n */\nexport const value = 1;\n",
    expectedBuiltins: {},
  },
  {
    rule: "exported-interface-naming",
    name: "an exported interface without the prefix",
    source: "export interface Thing {\n  readonly a: number;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "exported-interface-naming",
    name: "an exported interface whose second letter is lowercase",
    source: "export interface Ithing {\n  readonly a: number;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "no-interface-rename-on-import",
    name: "an interface renamed on import",
    source: 'import { IThing as Thing } from "./b.ts";\nexport const value = Thing;\n',
    expectedBuiltins: {},
  },
  {
    rule: "no-interface-rename-on-import",
    name: "a type import that renames an interface",
    source: 'import type { IThing as Thing } from "./b.ts";\nexport type Alias = Thing;\n',
    expectedBuiltins: {},
  },
  {
    rule: "import-boundaries",
    name: "an import that a zone denies",
    source: 'import { value } from "./forbidden.ts";\nexport const other = value;\n',
    expectedBuiltins: {},
  },
  {
    rule: "import-boundaries",
    name: "a re-export that a zone denies",
    source: 'export { value } from "./forbidden.ts";\n',
    expectedBuiltins: {},
  },
  {
    rule: "exported-interface-placement",
    name: "an exported interface after a function",
    source: "export function f(): void {}\nexport interface IOther {\n  readonly b: number;\n}\n",
    expectedBuiltins: {},
  },
  {
    rule: "promise-response-alias",
    name: "an alias of the weak promise",
    source: `export type Fetcher = ${RESPONSE_PROMISE};\n`,
    expectedBuiltins: {},
  },
  {
    rule: "promise-response-alias",
    name: "an alias of a function that returns the weak promise",
    source: `export type Fetcher = () => ${RESPONSE_PROMISE};\n`,
    expectedBuiltins: {},
  },
  {
    rule: "promise-response-return",
    name: "a function that returns the weak promise",
    source: `export function get(): ${RESPONSE_PROMISE} {\n  return fetch("x");\n}\n`,
    expectedBuiltins: {},
  },
  {
    rule: "promise-response-return",
    name: "a method signature that returns the weak promise",
    source: `export interface IClient {\n  send(): ${RESPONSE_PROMISE};\n}\n`,
    expectedBuiltins: {},
  },
  {
    rule: "ts-suppression-pragmas",
    name: "a suppression pragma with a description",
    source: `// ${PRAGMA_IGNORE} legacy value\nexport const value = 1;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "ts-suppression-pragmas",
    name: "a block comment pragma with a description",
    source: `/* ${PRAGMA_IGNORE} legacy value */\nexport const value = 1;\n`,
    expectedBuiltins: {},
  },
  {
    rule: "magic-union-type",
    name: "a parameter with a string union",
    source: `export function mode(value: ${FAST_OR_SLOW}): string {\n  return value;\n}\n`,
    expectedBuiltins: {},
  },
  {
    rule: "magic-union-type",
    name: "an interface member with a string union",
    source: `export interface IOptions {\n  readonly speed: ${FAST_OR_SLOW};\n}\n`,
    expectedBuiltins: {},
  },
];

/** A cast to any, which the built-in no-explicit-any reports. */
const SEEDED_ANY_CASE: IOverlapCase = {
  rule: null,
  name: "an as any cast",
  source: `${DECLARATIONS}export const value = input as any;\n`,
  expectedBuiltins: {},
};

/** The misspelled typeof case with its built-in left undeclared, which the check must refuse. */
const SEEDED_TYPEOF_CASE: IOverlapCase = {
  rule: null,
  name: "a misspelled typeof comparison, undeclared",
  source: `${DECLARATIONS}export const isText = typeof input === "strng";\n`,
  expectedBuiltins: {},
};

const EMPTY_INTERFACE_CASE: IOverlapCase = {
  rule: null,
  name: "an empty interface, declared incidental",
  source: "export interface IEmpty {}\n",
  expectedBuiltins: { "no-empty-interface": OVERLAP_KIND.incidental },
};

function caseFileName(index: number, entry: IOverlapCase): string {
  return entry.fileName ?? `case_${index}${entry.isTestFile ? "_test" : ""}.ts`;
}

/** The built-in rule codes of the installed Deno. */
async function builtinCodes(): Promise<Set<string>> {
  const result = await runDeno(["lint", "--rules", "--json"], Deno.cwd());
  const listing = JSON.parse(result.stdout) as { rules: { code: string }[] };
  return new Set(listing.rules.map((rule) => rule.code));
}

/** Lints every case in one temp project and returns what fired on each. */
function collect(entries: readonly IOverlapCase[]): Promise<ICollectedCase[]> {
  const names = entries.map((entry, index) => caseFileName(index, entry));
  const files = Object.fromEntries(entries.map((entry, index) => [names[index], entry.source]));
  return withDemoProject({ files, lintRules: { include: CONSUMER_BUILTIN_RULES } }, async (dir) => {
    const report = await lintJson(dir, names);
    assertEquals(report.errors ?? [], [], "the demo project must lint without errors");
    return entries.map((entry, index) => {
      const codes = (report.diagnostics ?? [])
        .filter((diagnostic) => diagnostic.filename?.endsWith(`/${names[index]}`))
        .map((diagnostic) => diagnostic.code ?? "");
      return {
        builtins: [...new Set(codes.filter((code) => !code.includes("/")))].sort(),
        ownRuleReported: entry.rule !== null && codes.includes(`${DEMO_PLUGIN_NAME}/${entry.rule}`),
      };
    });
  });
}

/** The built-in codes a case fired but did not declare. */
function undeclared(entry: IOverlapCase, collected: ICollectedCase): string[] {
  return collected.builtins.filter((code) => !(code in entry.expectedBuiltins));
}

function declaredDuplicates(entry: IOverlapCase): string[] {
  return Object.entries(entry.expectedBuiltins)
    .filter(([, kind]) => kind === OVERLAP_KIND.duplicate)
    .map(([code]) => code);
}

Deno.test("no pack rule key equals a built-in deno lint code", async () => {
  const builtins = await builtinCodes();
  assertNotEquals(builtins.size, 0, "the built-in rule list must not be empty");
  assertEquals(packRuleKeys().filter((key) => builtins.has(key)), []);
});

Deno.test("every pack rule has a case, and the case triggers that rule", async () => {
  const collected = await collect(CASES);
  assertEquals(
    packRuleKeys().filter((key) => !CASES.some((entry) => entry.rule === key)),
    [],
    "a pack rule without an overlap case",
  );
  const silent = CASES.filter((_, index) => !collected[index].ownRuleReported).map((entry) => entry.rule);
  assertEquals(silent, [], "cases that do not trigger their own rule");
});

Deno.test("every built-in that fires on a case is declared, and none is a duplicate", async () => {
  const collected = await collect(CASES);
  const problems = CASES.flatMap((entry, index) => [
    ...undeclared(entry, collected[index]).map((code) => `${entry.rule}: undeclared built-in ${code}`),
    ...declaredDuplicates(entry).map((code) => `${entry.rule}: ${code} duplicates the pack rule`),
  ]);
  assertEquals(problems, []);
});

Deno.test("an as any case is reported as an undeclared no-explicit-any", async () => {
  const [collected] = await collect([SEEDED_ANY_CASE]);
  assertArrayIncludes(undeclared(SEEDED_ANY_CASE, collected), ["no-explicit-any"]);
});

Deno.test("an undescribed pragma is reported by ban-ts-comment only, and the pack rule stays silent", async () => {
  const bare: IOverlapCase = {
    rule: "ts-suppression-pragmas",
    name: "a suppression pragma without a description",
    source: `// ${PRAGMA_IGNORE}\nexport const value: number = "x";\n`,
    expectedBuiltins: { "ban-ts-comment": OVERLAP_KIND.related },
  };
  const [collected] = await collect([bare]);
  assertEquals(collected.ownRuleReported, false);
  assertArrayIncludes([...collected.builtins], ["ban-ts-comment"]);
  assertEquals(undeclared(bare, collected), []);
});

Deno.test("an empty interface declared incidental passes", async () => {
  const [collected] = await collect([EMPTY_INTERFACE_CASE]);
  assertArrayIncludes([...collected.builtins], ["no-empty-interface"]);
  assertEquals(undeclared(EMPTY_INTERFACE_CASE, collected), []);
});

Deno.test("a misspelled typeof comparison is reported as an undeclared valid-typeof", async () => {
  const [collected] = await collect([SEEDED_TYPEOF_CASE]);
  assertArrayIncludes(undeclared(SEEDED_TYPEOF_CASE, collected), ["valid-typeof"]);
});

Deno.test("each rule with two reporting forms has a case for each form", () => {
  const perRule = new Map<string, number>();
  for (const entry of CASES) if (entry.rule !== null) perRule.set(entry.rule, (perRule.get(entry.rule) ?? 0) + 1);
  const twoForms = ["no-chained-type-assertions", "no-explicit-unknown", "no-unsafe-dictionary", "no-typeof-escape"];
  const single = twoForms.filter((rule) => (perRule.get(rule) ?? 0) < 2);
  assertEquals(single, []);
  assertEquals((perRule.get("no-runtime-typeof") ?? 0) >= 2, true);
});
