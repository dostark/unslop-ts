/**
 * @module TestPermissions
 * @path tests/helpers/permissions.ts
 * @description Detects whether the current test process may create symlinks, write inside a directory, read a path or spawn a command.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/cli_migrate_test.ts, tests/cli_report_test.ts, tests/cli_rules_write_test.ts]
 */

import { join } from "@std/path";

/** True when the process holds a write grant that covers `path`. The deploy compatibility check grants write to a temp dir only. */
export function canWriteTo(path: string): boolean {
  return Deno.permissions.querySync({ name: "write", path }).state === "granted";
}

/** True when the process may spawn the command. The deploy compatibility check grants run for deno and git only. */
export function canRun(command: string): boolean {
  return Deno.permissions.querySync({ name: "run", command }).state === "granted";
}

/** True when the process holds a read grant that covers `path`. */
export function canRead(path: string): boolean {
  return Deno.permissions.querySync({ name: "read", path }).state === "granted";
}

/** Deno requires unscoped read and write grants to create a symlink. */
export async function canCreateSymlinks(): Promise<boolean> {
  const dir = await Deno.makeTempDir({ prefix: "symlink_probe_" });
  try {
    await Deno.symlink("target", join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
