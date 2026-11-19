/**
 * @module CheckDocsTest
 * @path tests/check_docs_test.ts
 * @description The reference, the guide and the README describe the check route, its filters and its envelope.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [docs/reference/cli.md, docs/user-guide.md, README.md, src/cli/unslop.ts]
 */

import { assert, assertStringIncludes } from "@std/assert";

const REFERENCE = new URL("../docs/reference/cli.md", import.meta.url);
const GUIDE = new URL("../docs/user-guide.md", import.meta.url);
const README = new URL("../README.md", import.meta.url);
const CLI_SOURCE = new URL("../src/cli/unslop.ts", import.meta.url);

async function read(url: URL): Promise<string> {
  return await Deno.readTextFile(url);
}

Deno.test("check-docs-cli: the reference and the guide describe the route contract", async () => {
  const reference = await read(REFERENCE);
  const guide = await read(GUIDE);
  const readme = await read(README);
  for (const document of [reference, guide, readme]) {
    assertStringIncludes(document, "unslop check");
  }
  for (
    const token of [
      "--select",
      "--profile",
      "--category",
      "--level",
      "--exclude",
      "--strict",
      "--fail",
      "--include-parked",
      "hosted",
      "SARIF",
      '"rules"',
      "Exit codes",
      "--allow-run=node",
      "--allow-run=deno",
    ]
  ) {
    assertStringIncludes(reference, token);
  }
  for (const token of ["passed", "report", "hosted"]) assertStringIncludes(guide, token);
});

Deno.test("check-docs-usage: the usage block and the reference agree on the route flags", async () => {
  const source = await read(CLI_SOURCE);
  const line = source.split("\n").find((candidate) => candidate.includes("unslop check ["));
  assert(line !== undefined);
  const flags = new Set([...line.matchAll(/--[a-z-]+/g)].map((match) => match[0]));
  assert(flags.size > 0);
  const reference = await read(REFERENCE);
  for (const flag of flags) assertStringIncludes(reference, flag);
});

Deno.test("check-docs-remediation: the reference and the guide name the hardened contracts", async () => {
  const reference = await read(REFERENCE);
  const guide = await read(GUIDE);
  for (
    const token of [
      "failed error-level row",
      "warning-level finding",
      "no runnable checks selected",
      "Accepted for compatibility",
      "advisory check",
    ]
  ) {
    assertStringIncludes(reference, token);
  }
  for (const token of ["advisory check", "failed row"]) assertStringIncludes(guide, token);
});
