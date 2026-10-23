/**
 * @module HostsRunnerTest
 * @path tests/hosts_runner_test.ts
 * @description Proves the Deno host runner returns the same diagnostics as a direct `deno lint` run.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [tests/hosts/deno.ts]
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { runDenoHost } from "./hosts/deno.ts";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const CASE = {
  rule: "ignore-needs-reason",
  code: "// deno-lint-ignore demo/no-explicit-unknown\nexport const value = 1;\n",
  filename: "packages/x/src/a.ts",
};
const CATALOG = {
  version: "1",
  scopes: { test: [], fixture: [] },
  tagVocabulary: { comments: { description: "Comment discipline." } },
  rules: {
    "demo/ignore-needs-reason": { engine: "plugin", severity: "error", scope: "all", tags: ["comments"] },
  },
};

interface IDenoDiagnostic {
  readonly filename: string;
  readonly range: { readonly start: { readonly line: number } };
  readonly message: string;
  readonly code: string | null;
}

Deno.test("the Deno runner matches a direct deno lint run", async () => {
  const dir = await Deno.makeTempDir({ prefix: "unslop_hosts_" });
  try {
    await Deno.mkdir(join(dir, "packages/x/src"), { recursive: true });
    await Deno.writeTextFile(join(dir, CASE.filename), CASE.code);
    const mod = new URL("../mod.ts", import.meta.url).href;
    const denoHost = new URL("../deno.ts", import.meta.url).href;
    await Deno.writeTextFile(
      join(dir, "plugin.ts"),
      [
        `import { DENO_RULE_PACK, parseCatalog, TYPESCRIPT_RULE_PACK } from ${JSON.stringify(mod)};`,
        `import { createRuleRegistry } from ${JSON.stringify(mod)};`,
        `import { createDenoPlugin } from ${JSON.stringify(denoHost)};`,
        `const registry = createRuleRegistry("demo", [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]);`,
        `const catalog = parseCatalog(${JSON.stringify(CATALOG)}, { scriptRuleSchemas: null, registry });`,
        `export default createDenoPlugin("demo", catalog, { rulePacks: [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK] });`,
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({
        imports: { zod: "npm:zod@^4.4.3" },
        lint: { plugins: ["./plugin.ts"] },
      }),
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["lint", "--json", CASE.filename],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    // deno lint exits 1 when it reports a finding.
    assertEquals(result.code <= 1, true, new TextDecoder().decode(result.stderr));
    const output = new TextDecoder().decode(result.stdout);
    const direct = (JSON.parse(output) as { diagnostics: readonly IDenoDiagnostic[] }).diagnostics
      // The built-in unused-ignore diagnostic is not a rule finding.
      .filter((diagnostic) => !diagnostic.message.startsWith("Ignore for code"))
      .map((diagnostic) => ({ line: diagnostic.range.start.line, message: diagnostic.message }));
    const runner = runDenoHost({ rule: CASE.rule, code: CASE.code, filename: CASE.filename })
      .map((diagnostic) => ({ line: diagnostic.line, message: diagnostic.message }));
    assertEquals(runner, direct);
    assertEquals(direct.length, 1);
    assertEquals(ROOT.length > 0, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
