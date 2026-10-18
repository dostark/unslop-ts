/**
 * @module DenoBuiltinOverlapTest
 * @path packages/lint-rules/tests/deno_builtin_overlap_test.ts
 * @description Keeps the engine rule packs from duplicating or shadowing a built-in `deno lint` rule.
 * @architectural-layer Test
 * @dependencies [@exaix/lint-rules]
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/src/rules/type_safety_rules.ts]
 */

import { assertArrayIncludes, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { DENO_RULE_PACK, type JsonValue, TYPESCRIPT_RULE_PACK } from "@exaix/lint-rules";

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
  /** Every built-in code that fires on the snippet, with the reason it may. */
  readonly expectedBuiltins: Readonly<Record<string, OverlapKind>>;
}

interface ICollectedCase {
  readonly builtins: readonly string[];
  readonly ownRuleReported: boolean;
}

interface ILintDiagnostic {
  readonly filename?: string;
  readonly code?: string;
}

interface ILintReport {
  readonly diagnostics?: readonly ILintDiagnostic[];
  readonly errors?: readonly JsonValue[];
}

const DEMO_PLUGIN_NAME = "exaix";
const DEMO_TAG = "demo";
/** The non-recommended built-ins the Exaix `lint` task enables. */
const CONSUMER_BUILTIN_RULES = ["explicit-module-boundary-types"];
const DEMO_OPTIONS: Readonly<Record<string, Record<string, number>>> = {
  "max-cyclomatic-complexity": { max: 1 },
  "max-class-size": { minClassLines: 1, threshold: 1 },
};
const DECLARATIONS = "declare const input: string;\n";

const CASES: readonly IOverlapCase[] = [
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
    name: "an ignore of an exaix rule without a reason",
    source: "// deno-lint-ignore exaix/no-runtime-typeof\nexport const value = 1;\n",
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
];

/** A cast to any, which the built-in no-explicit-any reports. */
const SEEDED_ANY_CASE: IOverlapCase = {
  rule: null,
  name: "an as any cast",
  source: `${DECLARATIONS}export const value = input as any;\n`,
  expectedBuiltins: {},
};

const EMPTY_INTERFACE_CASE: IOverlapCase = {
  rule: null,
  name: "an empty interface, declared incidental",
  source: "export interface IEmpty {}\n",
  expectedBuiltins: { "no-empty-interface": OVERLAP_KIND.incidental },
};

function caseFileName(index: number, entry: IOverlapCase): string {
  return `case_${index}${entry.isTestFile ? "_test" : ""}.ts`;
}

function packRuleKeys(): string[] {
  return [...Object.keys(TYPESCRIPT_RULE_PACK.rules), ...Object.keys(DENO_RULE_PACK.rules)];
}

function demoCatalog(): Record<string, JsonValue> {
  const rules: Record<string, JsonValue> = {};
  for (const key of packRuleKeys()) {
    rules[`${DEMO_PLUGIN_NAME}/${key}`] = {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: [DEMO_TAG],
      ...(key in DEMO_OPTIONS ? { options: DEMO_OPTIONS[key] } : {}),
    };
  }
  return {
    version: "1",
    scopes: {
      test: ["**/*_test.ts"],
      fixture: ["**/tests/fixtures/**"],
    },
    tagVocabulary: { [DEMO_TAG]: { description: "Rules under the overlap check." } },
    rules,
  };
}

function demoPluginSource(): string {
  return [
    'import { createLintPlugin, createRuleRegistry, DENO_RULE_PACK, parseCatalog, TYPESCRIPT_RULE_PACK } from "@exaix/lint-rules";',
    "const packs = [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK];",
    `const registry = createRuleRegistry(${JSON.stringify(DEMO_PLUGIN_NAME)}, packs);`,
    `const catalog = parseCatalog(${JSON.stringify(demoCatalog())}, { scriptRuleSchemas: null, registry });`,
    `export default createLintPlugin(${JSON.stringify(DEMO_PLUGIN_NAME)}, catalog, { rulePacks: packs });`,
    "",
  ].join("\n");
}

async function projectConfig(): Promise<string> {
  const rootConfig = JSON.parse(await Deno.readTextFile(new URL("../../../deno.json", import.meta.url)));
  return JSON.stringify({
    imports: {
      "@exaix/lint-rules": new URL("../mod.ts", import.meta.url).href,
      zod: rootConfig.imports.zod,
    },
    lint: {
      plugins: ["./plugin.ts"],
      rules: { tags: ["recommended"], include: CONSUMER_BUILTIN_RULES },
    },
  });
}

async function runDeno(args: string[], cwd: string): Promise<string> {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env: { EXAIX_LINT_RULES: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(output.stdout);
}

/** The built-in rule codes of the installed Deno. */
async function builtinCodes(): Promise<Set<string>> {
  const listing = JSON.parse(await runDeno(["lint", "--rules", "--json"], Deno.cwd())) as {
    rules: { code: string }[];
  };
  return new Set(listing.rules.map((rule) => rule.code));
}

/** Lints every case in one temp project and returns what fired on each. */
async function collect(entries: readonly IOverlapCase[]): Promise<ICollectedCase[]> {
  const dir = await Deno.makeTempDir({ prefix: "overlap_" });
  try {
    await Deno.writeTextFile(join(dir, "deno.json"), await projectConfig());
    await Deno.writeTextFile(join(dir, "plugin.ts"), demoPluginSource());
    const names = entries.map((entry, index) => caseFileName(index, entry));
    for (const [index, entry] of entries.entries()) await Deno.writeTextFile(join(dir, names[index]), entry.source);
    const report = JSON.parse(await runDeno(["lint", "--json", "--config", "deno.json", ...names], dir)) as ILintReport;
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
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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

Deno.test("an empty interface declared incidental passes", async () => {
  const [collected] = await collect([EMPTY_INTERFACE_CASE]);
  assertArrayIncludes([...collected.builtins], ["no-empty-interface"]);
  assertEquals(undeclared(EMPTY_INTERFACE_CASE, collected), []);
});
