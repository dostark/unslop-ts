/**
 * @module HealthChurnTest
 * @path tests/health_churn_test.ts
 * @description Decay, hotspot normalization, the Git history grammar and repository edge states.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/churn.ts, src/report/health.ts]
 */

import { fixtureGit as git } from "./helpers/git_fixture.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runBounded } from "../src/report/bounded_io.ts";
import { canRun } from "./helpers/permissions.ts";
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

const CHURN_URL = new URL("../src/report/churn.ts", import.meta.url).href;
const STREAM_LIMIT_BYTES = 1024 * 1024;
const FLOOD_BYTES = 70_000_000;
const STALL_SECONDS = 60;
const PROMPT_MS = 15_000;

const FAKE_GIT = `#!/bin/sh
case "$*" in
  *--show-toplevel*)
    case "$FAKE_MODE" in
      stall) sleep ${STALL_SECONDS}; touch "$MARKER" ;;
      stderr) yes y | head -c ${FLOOD_BYTES} >&2; touch "$MARKER" ;;
    esac
    echo /tmp/fake ;;
  *--show-prefix*) echo ;;
  *--is-shallow-repository*) echo false ;;
  *--verify*)
    case "$FAKE_MODE" in
      head-stall) sleep ${STALL_SECONDS} ;;
      head-corrupt) echo "fatal: loose object is corrupt" >&2; exit 128 ;;
      head-unborn) echo "fatal: Needed a single revision" >&2; exit 128 ;;
      log-stderr) echo abc ;;
      *) echo abc ;;
    esac ;;
  *log*)
    case "$FAKE_MODE" in
      log-stderr) yes y | head -c ${FLOOD_BYTES} >&2; touch "$MARKER" ;;
      *) yes x | head -c ${FLOOD_BYTES}; touch "$MARKER" ;;
    esac ;;
esac
`;

/** Runs the real collectChurn in a child with a fake Git first on its PATH. */
async function churnWithFakeGit(
  mode: string,
  deadlineMs: number,
): Promise<{ reason: string | null; available: boolean; empty: boolean; marker: boolean }> {
  const dir = await Deno.makeTempDir({ prefix: "unslop_fake_git_" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    await Deno.writeTextFile(join(bin, "git"), FAKE_GIT);
    await Deno.chmod(join(bin, "git"), 0o755);
    const script = join(dir, "run.ts");
    await Deno.writeTextFile(
      script,
      `import { collectChurn } from "${CHURN_URL}";\n` +
        "const limits = JSON.parse(Deno.args[0]);\n" +
        "const history = await collectChurn(Deno.args[1], 0, 0, new Set(), limits);\n" +
        "console.log(JSON.stringify({ reason: history.reason, available: history.available, empty: history.empty }));\n",
    );
    const marker = join(dir, "marker");
    const limits = { deadlineMs, maxStdoutBytes: STREAM_LIMIT_BYTES, maxStderrBytes: STREAM_LIMIT_BYTES };
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", script, JSON.stringify(limits), dir],
      env: { PATH: `${bin}:${Deno.env.get("PATH") ?? ""}`, FAKE_MODE: mode, MARKER: marker },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const found = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      reason: string | null;
      available: boolean;
      empty: boolean;
    };
    return { ...found, marker: await Deno.stat(marker).then(() => true, () => false) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("health-child-stream-bounds: oversized output and stalled Git calls end before the producer completes", async () => {
  const started = Date.now();
  const stdout = await churnWithFakeGit("stdout", 30_000);
  assertEquals(stdout.reason, "history-output-too-large");
  assertEquals(stdout.marker, false);
  const stderr = await churnWithFakeGit("stderr", 30_000);
  assertEquals(stderr.reason, "git-stderr-too-large");
  assertEquals(stderr.marker, false);
  const stalled = await churnWithFakeGit("stall", 1_000);
  assertEquals(stalled.reason, "git-command-timeout");
  assertEquals(stalled.marker, false);
  assert(Date.now() - started < PROMPT_MS * 3, "the bounded calls must end promptly");
});

Deno.test("churn-head-probe-causes: only an unborn HEAD is empty, and every other HEAD failure keeps its cause", async () => {
  const unborn = await churnWithFakeGit("head-unborn", 30_000);
  assertEquals([unborn.available, unborn.empty, unborn.reason], [true, true, null]);
  const stalled = await churnWithFakeGit("head-stall", 1_000);
  assertEquals([stalled.available, stalled.empty, stalled.reason], [false, false, "git-command-timeout"]);
  const corrupt = await churnWithFakeGit("head-corrupt", 30_000);
  assertEquals([corrupt.available, corrupt.empty], [false, false]);
  assertStringIncludes(corrupt.reason ?? "", "git-command-failed");
  const noisy = await churnWithFakeGit("log-stderr", 30_000);
  assertEquals([noisy.available, noisy.reason], [false, "git-stderr-too-large"]);
});

const SHELL_RUNNABLE = canRun("sh");
if (!SHELL_RUNNABLE) console.warn("bounded-grandchild-pipe is ignored: the process may not spawn sh");

Deno.test("bounded-grandchild-pipe: a child that exits returns its result while a grandchild holds the pipe", {
  ignore: !SHELL_RUNNABLE,
}, async () => {
  const deadlineMs = 5_000;
  const started = Date.now();
  const result = await runBounded("sh", ["-c", "(sleep 20 &); echo hi"], { cwd: Deno.cwd(), env: {} }, {
    deadlineMs,
    maxStdoutBytes: STREAM_LIMIT_BYTES,
    maxStderrBytes: STREAM_LIMIT_BYTES,
  });
  assertEquals(result.status, "exited");
  if (result.status === "exited") assertEquals(new TextDecoder().decode(result.stdout), "hi\n");
  assert(Date.now() - started < deadlineMs / 2, "the exit result must not wait for the deadline");
});
