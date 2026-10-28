/**
 * @module TempRepoTestHelper
 * @path tests/helpers/temp_repo.ts
 * @description A temporary repository root and a file writer for the whole-tree file-walk tests.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/whole_tree_unused_files_test.ts, tests/whole_tree_unused_files_manifest_test.ts]
 */

import { dirname, join } from "@std/path";

/** Runs `body` with an empty temporary repository root, then removes the root. */
export async function withRepo(body: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "unused_files_" });
  try {
    await body(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/** Writes `text` to `repoPath` under `root` and creates the missing directories. */
export async function write(root: string, repoPath: string, text: string): Promise<void> {
  const full = join(root, repoPath);
  await Deno.mkdir(dirname(full), { recursive: true });
  await Deno.writeTextFile(full, text);
}
