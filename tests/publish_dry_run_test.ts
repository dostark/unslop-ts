/**
 * @module PublishDryRunTest
 * @path tests/publish_dry_run_test.ts
 * @description Publish dry-run passes without allow-slow-types and carries no host tooling.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [deno.json, hosts/package.json]
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const PACKAGE_ROOT = fromFileUrl(new URL("..", import.meta.url));
const HOST_PATHS = ["/hosts/", "/tests_node/", "/examples/node-project/", "/examples/bun-project/", "/dist/"];

Deno.test("deno publish dry-run reports no slow type and no host tooling", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["publish", "--dry-run", "--allow-dirty"],
    cwd: PACKAGE_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  assertEquals(result.code, 0, output);
  assertEquals(output.includes("missing-explicit-type"), false);
  for (const hostPath of HOST_PATHS) {
    assertEquals(output.includes(hostPath), false, hostPath);
  }
});
