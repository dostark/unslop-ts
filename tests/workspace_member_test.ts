/**
 * @module WorkspaceMemberTest
 * @path tests/workspace_member_test.ts
 * @description A workspace whose root sets nodeModulesDir gives no warning and locks no member package.json.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [deno.json, hosts/package.json]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const PACKAGE_ROOT = fromFileUrl(new URL("..", import.meta.url));
const MAIN = 'import { z } from "zod";\nexport const value = z.string().parse("ok");\n';

Deno.test("a workspace member with host tooling adds no warning and no packageJson lock entry", async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop_member_" });
  try {
    await Deno.writeTextFile(
      join(root, "deno.json"),
      JSON.stringify({ workspace: ["./member"], nodeModulesDir: "auto" }),
    );
    await Deno.mkdir(join(root, "member", "hosts"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "member", "deno.json"),
      await Deno.readTextFile(join(PACKAGE_ROOT, "deno.json")),
    );
    await Deno.writeTextFile(
      join(root, "member", "hosts", "package.json"),
      await Deno.readTextFile(join(PACKAGE_ROOT, "hosts", "package.json")),
    );
    await Deno.writeTextFile(join(root, "member", "main.ts"), MAIN);

    const result = await new Deno.Command(Deno.execPath(), {
      args: ["check", "member/main.ts"],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(result.code, 0, stderr);
    assert(!stderr.includes("nodeModulesDir"), stderr);

    const lock = JSON.parse(await Deno.readTextFile(join(root, "deno.lock"))) as Record<string, unknown>;
    assertEquals("packageJson" in lock, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
