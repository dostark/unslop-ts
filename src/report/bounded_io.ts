/**
 * @module BoundedIo
 * @path src/report/bounded_io.ts
 * @description Byte-bounded file reads and child processes with a deadline, so external input never grows without limit.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/churn.ts, src/report/duplication.ts, src/report/parse.ts, src/rules/whole_tree/duplicate_code.ts]
 */

const READ_CHUNK_BYTES = 64 * 1024;
const KILL_SIGNAL = "SIGKILL";

/** How long the streams may keep open after the child exits, for example while a grandchild holds a pipe. */
const STREAM_DRAIN_GRACE_MS = 250;

/** The limits one child process runs under. */
export interface IChildLimits {
  readonly deadlineMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

/** Where and how one child process starts. */
export interface IChildSpawn {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** How a bounded child ended: it exited, or it was stopped for one named cause. */
export type BoundedChildResult =
  | {
    readonly status: "exited";
    readonly code: number;
    readonly stdout: Uint8Array<ArrayBuffer>;
    readonly stderr: Uint8Array<ArrayBuffer>;
  }
  | { readonly status: "stdout-overflow" | "stderr-overflow" | "timeout" };

type StopCause = "stdout-overflow" | "stderr-overflow" | "timeout";

/** A rejected file read: the input is larger than its bound. */
export class BoundedReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedReadError";
  }
}

/** Joins chunks into one array. */
function joined(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Reads a whole file, rejecting it as soon as it holds more than `maxBytes`, without buffering past the bound. */
export async function readFileBounded(path: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const file = await Deno.open(path, { read: true });
  try {
    const info = await file.stat();
    if (info.size > maxBytes) throw new BoundedReadError(`the input exceeds the ${maxBytes} byte bound`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const buffer = new Uint8Array(READ_CHUNK_BYTES);
      const count = await file.read(buffer);
      if (count === null) break;
      total += count;
      if (total > maxBytes) throw new BoundedReadError(`the input exceeds the ${maxBytes} byte bound`);
      chunks.push(buffer.subarray(0, count));
    }
    return joined(chunks, total);
  } finally {
    file.close();
  }
}

/** Reads one stream to its end, stopping the child when the stream passes its byte bound. */
async function collectBounded(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  onOverflow: () => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done || value === undefined) break;
    total += value.byteLength;
    if (total > maxBytes) {
      onOverflow();
      break;
    }
    chunks.push(value);
  }
  return joined(chunks, Math.min(total, maxBytes));
}

/**
 * Runs one child with piped output under byte and time limits. An overflow or a missed deadline kills the child,
 * cancels both streams and waits for the exit, so no producer keeps running and no stream stays open.
 */
export async function runBounded(
  command: string,
  args: readonly string[],
  spawn: IChildSpawn,
  limits: IChildLimits,
): Promise<BoundedChildResult> {
  const child = new Deno.Command(command, {
    args: [...args],
    cwd: spawn.cwd,
    env: { ...spawn.env },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stdout = child.stdout.getReader();
  const stderr = child.stderr.getReader();
  let cause: StopCause | null = null;
  const stop = (reason: StopCause): void => {
    if (cause !== null) return;
    cause = reason;
    try {
      child.kill(KILL_SIGNAL);
    } catch {
      // The child may already have exited.
    }
    stdout.cancel().catch(() => undefined);
    stderr.cancel().catch(() => undefined);
  };
  const timer = setTimeout(() => stop("timeout"), limits.deadlineMs);
  try {
    const drained = Promise.all([
      collectBounded(stdout, limits.maxStdoutBytes, () => stop("stdout-overflow")),
      collectBounded(stderr, limits.maxStderrBytes, () => stop("stderr-overflow")),
    ]);
    const status = await child.status;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      drained.then(() => true),
      new Promise<boolean>((resolve) => {
        graceTimer = setTimeout(() => resolve(false), STREAM_DRAIN_GRACE_MS);
      }),
    ]);
    clearTimeout(graceTimer);
    if (!settled) {
      stdout.cancel().catch(() => undefined);
      stderr.cancel().catch(() => undefined);
    }
    const [out, err] = await drained;
    if (cause !== null) return { status: cause };
    return { status: "exited", code: status.code, stdout: out, stderr: err };
  } finally {
    clearTimeout(timer);
  }
}
