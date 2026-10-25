/**
 * @module AdditivityTest
 * @path tests/additivity_test.ts
 * @description Proves that adding the plugin leaves every Deno built-in diagnostic identical.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [tests/hosts/deno.ts, src/rules/mod.ts]
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { canWriteTo } from "./helpers/permissions.ts";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const CORPUS = {
  "any.ts": "export const value: any = 1;\n",
  "chain.ts": "export const value = input as unknown as string;\n",
  "debugger.ts": "debugger;\n",
};
const CATALOG = {
  version: "1",
  scopes: { test: [], fixture: [] },
  tagVocabulary: { comments: { description: "Comment discipline." } },
  rules: {
    "demo/no-chained-type-assertions": { engine: "plugin", severity: "error", scope: "all", tags: ["comments"] },
    "demo/no-explicit-unknown": { engine: "plugin", severity: "error", scope: "all", tags: ["comments"] },
  },
};

interface IDiagnostic {
  readonly filename: string;
  readonly message: string;
  readonly code: string | null;
  readonly range: { readonly start: { readonly line: number } };
}

function builtins(diagnostics: readonly IDiagnostic[]): string[] {
  return diagnostics
    .filter((diagnostic) => typeof diagnostic.code === "string" && !diagnostic.code.startsWith("demo/"))
    .map((diagnostic) =>
      `${diagnostic.filename}:${diagnostic.code}:${diagnostic.range.start.line}:${diagnostic.message}`
    )
    .sort();
}

async function lint(dir: string, withConfig: boolean): Promise<readonly IDiagnostic[]> {
  const args = withConfig ? ["lint", "--json", "."] : ["lint", "--no-config", "--json", "."];
  const result = await new Deno.Command(Deno.execPath(), { args, cwd: dir, stdout: "piped", stderr: "piped" }).output();
  return (JSON.parse(new TextDecoder().decode(result.stdout)) as { diagnostics: readonly IDiagnostic[] }).diagnostics;
}

Deno.test(
  "adding the plugin leaves every Deno built-in diagnostic identical",
  { ignore: !canWriteTo(ROOT) },
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "unslop_additivity_", dir: ROOT });
    try {
      for (const [name, source] of Object.entries(CORPUS)) await Deno.writeTextFile(join(dir, name), source);
      const baseline = builtins(await lint(dir, false));
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
        JSON.stringify({ imports: { zod: "npm:zod@^4.4.3" }, lint: { plugins: ["./plugin.ts"] } }),
      );
      const withPlugin = builtins(await lint(dir, true));
      assertEquals(withPlugin, baseline);
      assertEquals(baseline.length > 0, true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
