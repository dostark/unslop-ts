/**
 * @module HealthChurnTest
 * @path tests/health_churn_test.ts
 * @description Decay, hotspot normalization, the Git history grammar and repository edge states.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/churn.ts, src/report/health.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  churnWeightOf,
  collectChurn,
  hotspotScoresOf,
  type IChurnHistory,
  parseHistory,
  parseSince,
} from "../src/report/churn.ts";

const NOW = 1_800_000_000;
const DAY = 86400;

/** Runs Git in one directory with an isolated configuration. */
async function git(cwd: string, args: readonly string[], env: Record<string, string> = {}): Promise<string> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd,
    env: {
      LD_LIBRARY_PATH: "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`);
  }
  return new TextDecoder().decode(output.stdout);
}

/** Commits every change with one fixed committer date. */
async function commit(cwd: string, message: string, epoch: number): Promise<void> {
  await git(cwd, ["add", "-A"]);
  await git(cwd, ["commit", "-m", message], {
    GIT_AUTHOR_DATE: `${epoch} +0000`,
    GIT_COMMITTER_DATE: `${epoch} +0000`,
  });
}

Deno.test("churn-decay: the 90-day half-life and a future timestamp are deterministic", () => {
  assertEquals(churnWeightOf(NOW, NOW), 1);
  assertEquals(churnWeightOf(NOW - 90 * DAY, NOW), 0.5);
  assertEquals(churnWeightOf(NOW - 180 * DAY, NOW), 0.25);
  assertEquals(churnWeightOf(NOW + 10 * DAY, NOW), 1);
  assertEquals(parseSince("180d", new Date(NOW * 1000)), NOW - 180 * DAY);
  assertEquals(parseSince("6m", new Date(NOW * 1000)), NOW - 180 * DAY);
  assertEquals(parseSince("2026-01-01", new Date(NOW * 1000)), Math.floor(Date.parse("2026-01-01") / 1000));
});

Deno.test("hotspot-score: the maximum qualifying pair scores 100 and zero maxima score 0", () => {
  const history: IChurnHistory = {
    available: true,
    reason: null,
    shallow: false,
    empty: false,
    files: new Map([
      ["a.ts", { commits: 3, weight: 2 }],
      ["b.ts", { commits: 3, weight: 1 }],
      ["c.ts", { commits: 2, weight: 5 }],
    ]),
  };
  const densities = new Map([["a.ts", 2], ["b.ts", 1], ["c.ts", 9]]);
  const scores = hotspotScoresOf(history, densities, 3);
  assertEquals(scores.map((entry) => entry.path), ["a.ts", "b.ts"]);
  assertEquals(scores[0].score, 100);
  assertEquals(scores[1].score, 25);
  assertEquals(hotspotScoresOf(history, densities, 4), []);
  assertEquals(hotspotScoresOf(history, new Map(), 3).map((entry) => entry.score), [0, 0]);
  assertEquals(hotspotScoresOf(history, densities, 1).map((entry) => entry.path), ["c.ts", "a.ts", "b.ts"]);
});

Deno.test("git-history-grammar: NUL headers, tabs, newlines and binary records parse intact", () => {
  const text = "\0COMMIT\0hash1\0" +
    `${NOW}\0` +
    "1\t2\tsrc/a.ts\0" +
    "3\t4\tsrc/tab\tname.ts\0" +
    "5\t6\tsrc/new\nline.ts\0" +
    "\0COMMIT\0hash2\0" +
    `${NOW - DAY}\0` +
    "-\t-\tsrc/blob.bin\0";
  const commits = parseHistory(text);
  assertEquals(commits.length, 2);
  assertEquals(commits[0].hash, "hash1");
  assertEquals(commits[0].files.map((file) => file.path), ["src/a.ts", "src/tab\tname.ts", "src/new\nline.ts"]);
  assertEquals(commits[0].files[1].added, 3);
  assertEquals(commits[1].files[0].binary, true);
  assertEquals(parseHistory("").length, 0);
  assertEquals(parseHistory("garbage\0").length, 0);
});

Deno.test("git-history-grammar: a real repository preserves names and omits merges", async () => {
  const dir = await Deno.makeTempDir({ prefix: "unslop_churn_" });
  try {
    await git(dir, ["init", "-b", "main"]);
    await Deno.writeTextFile(join(dir, "a.ts"), "export const a = 1;\n");
    await Deno.writeTextFile(join(dir, "tab\tname.ts"), "export const tab = 1;\n");
    await Deno.writeTextFile(join(dir, "new\nline.ts"), "export const line = 1;\n");
    await Deno.writeFile(join(dir, "blob.bin"), new Uint8Array([0, 1, 2]));
    await commit(dir, "first", NOW - 90 * DAY);

    await Deno.writeTextFile(join(dir, "a.ts"), "export const a = 2;\n");
    await commit(dir, "second", NOW - 10 * DAY);

    await git(dir, ["mv", "a.ts", "renamed.ts"]);
    await commit(dir, "rename", NOW - 5 * DAY);

    await git(dir, ["checkout", "-b", "side"]);
    await Deno.writeTextFile(join(dir, "side.ts"), "export const side = 1;\n");
    await commit(dir, "side", NOW - 4 * DAY);
    await git(dir, ["checkout", "main"]);
    await git(dir, ["merge", "--no-ff", "side", "-m", "merge"], {
      GIT_AUTHOR_DATE: `${NOW - 3 * DAY} +0000`,
      GIT_COMMITTER_DATE: `${NOW - 3 * DAY} +0000`,
    });

    const snapshot = new Set(["renamed.ts", "tab\tname.ts", "new\nline.ts", "blob.bin", "side.ts"]);
    const history = await collectChurn(dir, NOW - 365 * DAY, NOW, snapshot);
    assertEquals(history.available, true);
    assertEquals(history.shallow, false);
    assertEquals(history.empty, false);
    assertEquals(history.files.has("a.ts"), false);
    assertEquals(history.files.get("renamed.ts")?.commits, 1);
    assertEquals(history.files.get("tab\tname.ts")?.commits, 1);
    assertEquals(history.files.get("new\nline.ts")?.commits, 1);
    assertEquals(history.files.get("blob.bin")?.commits, 1);
    assertEquals(history.files.get("side.ts")?.commits, 1);
    assert(Math.abs((history.files.get("tab\tname.ts")?.weight ?? 0) - 0.5) < 1e-9);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-history-grammar: an unborn HEAD is empty and a subdirectory root maps its prefix", async () => {
  const empty = await Deno.makeTempDir({ prefix: "unslop_unborn_" });
  try {
    await git(empty, ["init", "-b", "main"]);
    const history = await collectChurn(empty, NOW - 365 * DAY, NOW, new Set());
    assertEquals(history.available, true);
    assertEquals(history.empty, true);
    assertEquals(history.files.size, 0);
  } finally {
    await Deno.remove(empty, { recursive: true });
  }

  const root = await Deno.makeTempDir({ prefix: "unslop_subdir_" });
  try {
    await git(root, ["init", "-b", "main"]);
    await Deno.mkdir(join(root, "sub/project"), { recursive: true });
    await Deno.writeTextFile(join(root, "sub/project/a.ts"), "export const a = 1;\n");
    await commit(root, "first", NOW - 10 * DAY);
    const history = await collectChurn(join(root, "sub/project"), NOW - 365 * DAY, NOW, new Set(["a.ts"]));
    assertEquals(history.available, true);
    assertEquals(history.files.get("a.ts")?.commits, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("git-history-grammar: a shallow clone and a non-repository are attributed", async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop_shallow_source_" });
  const clone = await Deno.makeTempDir({ prefix: "unslop_shallow_clone_" });
  const plain = await Deno.makeTempDir({ prefix: "unslop_not_git_" });
  try {
    await git(root, ["init", "-b", "main"]);
    await Deno.writeTextFile(join(root, "a.ts"), "export const a = 1;\n");
    await commit(root, "first", NOW - 10 * DAY);
    await git(clone, ["clone", "--depth", "1", `file://${root}`, "."]);
    const shallow = await collectChurn(clone, NOW - 365 * DAY, NOW, new Set(["a.ts"]));
    assertEquals(shallow.available, true);
    assertEquals(shallow.shallow, true);

    const missing = await collectChurn(plain, NOW - 365 * DAY, NOW, new Set());
    assertEquals(missing.available, false);
    assertEquals(missing.reason, "not-a-git-repository");
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(clone, { recursive: true });
    await Deno.remove(plain, { recursive: true });
  }
});
