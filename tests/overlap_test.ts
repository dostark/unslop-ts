/**
 * @module OverlapTest
 * @path tests/overlap_test.ts
 * @description Keeps every engine rule's declared overlaps in step with the Deno built-in rule set.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [tests/cases/overlap_expectations.json, src/rules/mod.ts, tests/hosts/deno.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../mod.ts";
import table from "./cases/overlap_expectations.json" with { type: "json" };
import { canWriteTo } from "./helpers/permissions.ts";

interface IExpectation {
  readonly rule: string;
  readonly source: string;
  readonly expected: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const CASES: readonly IExpectation[] = table.map((entry) => ({
  rule: entry.rule,
  source: entry.source,
  expected: Object.fromEntries(
    Object.entries(entry.expected).map(([host, codes]) => [
      host,
      Object.fromEntries(
        Object.entries(codes).filter(([, kind]) => typeof kind === "string"),
      ) as Record<string, string>,
    ]),
  ) as Record<string, Record<string, string>>,
}));
const HOST = "deno";

interface IDenoDiagnostic {
  readonly filename: string;
  readonly message: string;
  readonly code: string | null;
}

function fileOf(index: number): string {
  return `case_${String(index).padStart(2, "0")}.ts`;
}

/** The built-in codes Deno reports for every case, grouped by case index. */
async function collect(): Promise<readonly (readonly string[])[]> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_overlap_", dir: ROOT });
  try {
    await Promise.all(CASES.map((entry, index) => Deno.writeTextFile(join(dir, fileOf(index)), entry.source)));
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["lint", "--no-config", "--json", "."],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const diagnostics = (JSON.parse(new TextDecoder().decode(result.stdout)) as {
      diagnostics: readonly IDenoDiagnostic[];
    }).diagnostics;
    const codes = CASES.map(() => [] as string[]);
    for (const diagnostic of diagnostics) {
      if (typeof diagnostic.code !== "string") continue;
      const match = /case_(\d+)\.ts$/.exec(diagnostic.filename);
      if (match === null) continue;
      codes[Number(match[1])].push(diagnostic.code);
    }
    return codes;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function undeclared(actual: readonly string[], expected: Readonly<Record<string, string>>): string[] {
  return [...new Set(actual)].filter((code) => !(code in expected));
}

Deno.test("every pack rule declares an overlaps list", () => {
  for (const pack of [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]) {
    for (const [key, rule] of Object.entries(pack.rules)) {
      assert(Array.isArray(rule.overlaps), key);
      assert(rule.overlaps.every((overlap) => overlap.kind === "duplicate" || overlap.kind === "related"), key);
    }
  }
});

Deno.test("every Deno built-in code on a case is declared, and every declared code fires", {
  ignore: !canWriteTo(ROOT),
}, async () => {
  const collected = await collect();
  const problems = CASES.flatMap((entry, index) => {
    const expected = entry.expected[HOST] ?? {};
    return [
      ...undeclared(collected[index], expected).map((code) => `${entry.rule}: undeclared ${code}`),
      ...Object.keys(expected).filter((code) => !collected[index].includes(code)).map((code) =>
        `${entry.rule}: declared ${code} does not fire`
      ),
    ];
  });
  assertEquals(problems, []);
});

Deno.test("an undeclared built-in code fails the check", { ignore: !canWriteTo(ROOT) }, async () => {
  const seeded = "export const value: any = 1;\n";
  const dir = await Deno.makeTempDir({ prefix: "unslop_overlap_seed_", dir: ROOT });
  try {
    await Deno.writeTextFile(join(dir, "seeded.ts"), seeded);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["lint", "--no-config", "--json", "seeded.ts"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const diagnostics = (JSON.parse(new TextDecoder().decode(result.stdout)) as {
      diagnostics: readonly IDenoDiagnostic[];
    }).diagnostics;
    const codes = diagnostics.map((diagnostic) => diagnostic.code).filter((code) => typeof code === "string");
    assert(undeclared(codes as string[], {}).includes("no-explicit-any"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
