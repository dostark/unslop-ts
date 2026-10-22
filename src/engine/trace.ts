/**
 * @module EngineTrace
 * @path src/engine/trace.ts
 * @description Coverage trace records, the stderr line protocol, and reconciliation for the lint plugin.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/plugin.ts, src/engine/catalog.ts]
 */

/** The fixed prefix every trace line starts with. */
export const TRACE_PREFIX = "unslop-trace:";
/** The only protocol version this engine writes or reads. */
export const TRACE_PROTOCOL_VERSION = "v1";
/** The prefix of one complete trace line, before the run id. */
export const TRACE_LINE_PREFIX = `${TRACE_PREFIX}${TRACE_PROTOCOL_VERSION}:`;
/** The reserved rule key that emits file observations. It is never a configurable lint rule. */
export const INTERNAL_COVERAGE_RULE = "internal-coverage";
/** The run id used when the trace variable is the literal `1`. */
export const MANUAL_TRACE_RUN_ID = "manual";
/** The suffix of the trace variable: `demo` reads `DEMO_LINT_TRACE`. */
export const TRACE_ENV_SUFFIX = "_LINT_TRACE";

const NON_NAME_CHARS = /[^A-Z0-9]+/g;
const TRACE_FIELD_SEPARATOR = ":";

/** Why a rule did not inspect a file. First matching cause wins. */
export type SkipReason = "ignored" | "fixture" | "scope" | "include" | "exclude";
/** Every skip reason in precedence order. */
export const SKIP_REASONS: readonly SkipReason[] = ["ignored", "fixture", "scope", "include", "exclude"];

/** The kind of one trace record. */
export type TraceRecordKind = "observed" | "checked" | "skipped";

interface ITraceRecordBase {
  readonly runId: string;
  readonly plugin: string;
  readonly file: string;
}

/** The observer saw the file. It never claims a rule was dispatched. */
export interface ITraceObservedRecord extends ITraceRecordBase {
  readonly kind: "observed";
  readonly rule: typeof INTERNAL_COVERAGE_RULE;
}

/** A real rule's `create` returned for the file. */
export interface ITraceCheckedRecord extends ITraceRecordBase {
  readonly kind: "checked";
  readonly rule: string;
}

/** A real rule did not inspect the file for the stated cause. */
export interface ITraceSkippedRecord extends ITraceRecordBase {
  readonly kind: "skipped";
  readonly rule: string;
  readonly reason: SkipReason;
}

/** One record in the coverage protocol. */
export type ITraceRecord = ITraceObservedRecord | ITraceCheckedRecord | ITraceSkippedRecord;

/** The parsed stderr: this run's records plus every unrelated host line. */
export interface ITraceParseResult {
  readonly records: readonly ITraceRecord[];
  readonly unrelated: readonly string[];
}

/** What reconciliation requires before it accepts a record set. */
export interface ITraceExpectation {
  readonly runId: string;
  readonly plugin: string;
  /** The rule ids that were active for this run. */
  readonly activeRules: ReadonlySet<string>;
}

/** A matching trace line with an unknown version, a bad shape, or contradictory identity. */
export class TraceProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceProtocolError";
  }
}

/** The trace variable of a plugin: `demo` gives `DEMO_LINT_TRACE`. */
export function traceEnvName(pluginName: string): string {
  return `${pluginName.toUpperCase().replace(NON_NAME_CHARS, "_")}${TRACE_ENV_SUFFIX}`;
}

function normalizeTraceValue(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return value === "1" ? MANUAL_TRACE_RUN_ID : value;
}

/**
 * Resolves the trace run id. An explicit option skips the environment read entirely.
 * A missing, empty, or unreadable trace variable disables tracing.
 */
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function checkedRunId(value: string | null): string | null {
  if (value === null || value === MANUAL_TRACE_RUN_ID) return value;
  if (!RUN_ID_PATTERN.test(value)) {
    throw new TraceProtocolError(`the run id '${value}' must contain only letters, digits, '.', '_', or '-'`);
  }
  return value;
}

export function resolveTraceRunId(pluginName: string, explicit: string | undefined): string | null {
  if (explicit !== undefined) return checkedRunId(normalizeTraceValue(explicit));
  try {
    return checkedRunId(normalizeTraceValue(Deno.env.get(traceEnvName(pluginName))));
  } catch {
    return null;
  }
}

/** Encodes one record as the complete stderr line the plugin writes. */
export function formatTraceRecord(record: ITraceRecord): string {
  if (!RUN_ID_PATTERN.test(record.runId)) {
    throw new TraceProtocolError(`the run id '${record.runId}' must contain only letters, digits, '.', '_', or '-'`);
  }
  return `${TRACE_LINE_PREFIX}${record.runId}:${JSON.stringify(record)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const OBSERVED_KEYS = new Set(["kind", "runId", "plugin", "file", "rule"]);
const CHECKED_KEYS = new Set(["kind", "runId", "plugin", "file", "rule"]);
const SKIPPED_KEYS = new Set(["kind", "runId", "plugin", "file", "rule", "reason"]);

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") {
    throw new TraceProtocolError(`trace record field '${key}' must be a non-empty string`);
  }
  return value;
}

function assertExactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TraceProtocolError(`trace record has unknown field '${key}'`);
  }
}

function parseRecord(value: unknown): ITraceRecord {
  const record = asRecord(value);
  if (!record) throw new TraceProtocolError("a trace record must be a JSON object");
  const kind = record.kind;
  const runId = requiredString(record, "runId");
  const plugin = requiredString(record, "plugin");
  const file = requiredString(record, "file");
  const rule = requiredString(record, "rule");
  if (kind === "observed") {
    assertExactKeys(record, OBSERVED_KEYS);
    if (rule !== INTERNAL_COVERAGE_RULE) {
      throw new TraceProtocolError("an observed record must name the internal-coverage rule");
    }
    return { kind, runId, plugin, file, rule };
  }
  if (kind === "checked") {
    assertExactKeys(record, CHECKED_KEYS);
    if (rule === INTERNAL_COVERAGE_RULE) {
      throw new TraceProtocolError("a checked record must name a real rule");
    }
    return { kind, runId, plugin, file, rule };
  }
  if (kind === "skipped") {
    assertExactKeys(record, SKIPPED_KEYS);
    if (rule === INTERNAL_COVERAGE_RULE) {
      throw new TraceProtocolError("a skipped record must name a real rule");
    }
    const reason = record.reason;
    if (typeof reason !== "string" || !SKIP_REASONS.includes(reason as SkipReason)) {
      throw new TraceProtocolError(`trace record '${rule}' has an unknown skip reason`);
    }
    return { kind, runId, plugin, file, rule, reason: reason as SkipReason };
  }
  throw new TraceProtocolError("a trace record has an unknown kind");
}

/**
 * Parses stderr into trace records and unrelated host lines. When `runId` is given,
 * lines addressed to another run are unrelated. A matching prefix with a bad shape fails.
 */
export function parseTraceStderr(stderr: string, runId: string | undefined): ITraceParseResult {
  const records: ITraceRecord[] = [];
  const unrelated: string[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.startsWith(TRACE_PREFIX)) {
      unrelated.push(line);
      continue;
    }
    if (!line.startsWith(TRACE_LINE_PREFIX)) {
      throw new TraceProtocolError(`unknown trace protocol version in '${line.slice(0, 40)}'`);
    }
    const rest = line.slice(TRACE_LINE_PREFIX.length);
    const separator = rest.indexOf(TRACE_FIELD_SEPARATOR);
    if (separator <= 0) throw new TraceProtocolError("a trace line has no run id or payload");
    const lineRunId = rest.slice(0, separator);
    if (runId !== undefined && lineRunId !== runId) {
      unrelated.push(line);
      continue;
    }
    const payload = rest.slice(separator + 1);
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      throw new TraceProtocolError("a trace line has malformed JSON");
    }
    const record = parseRecord(value);
    if (record.runId !== lineRunId) {
      throw new TraceProtocolError("a trace line run id does not match its record");
    }
    records.push(record);
  }
  return { records, unrelated };
}

/**
 * Rejects contradictory records, removes exact duplicates, and keeps cross-file order
 * irrelevant. The caller passes the active rule ids for this run.
 */
export function reconcileTraceRecords(
  records: readonly ITraceRecord[],
  expected: ITraceExpectation,
): ITraceRecord[] {
  const accepted: ITraceRecord[] = [];
  const byKey = new Map<string, string>();
  const terminals = new Map<string, string>();
  for (const input of records) {
    const record = parseRecord(input);
    if (record.runId !== expected.runId) {
      throw new TraceProtocolError(`record run id '${record.runId}' is not '${expected.runId}'`);
    }
    if (record.plugin !== expected.plugin) {
      throw new TraceProtocolError(`record plugin '${record.plugin}' is not '${expected.plugin}'`);
    }
    if (record.kind === "observed") {
      if (record.rule !== INTERNAL_COVERAGE_RULE) {
        throw new TraceProtocolError("an observed record must name the internal-coverage rule");
      }
    } else if (!expected.activeRules.has(record.rule)) {
      throw new TraceProtocolError(`record names inactive or unknown rule '${record.rule}'`);
    }
    const key = [record.runId, record.plugin, record.rule, record.file, record.kind].join("\u0000");
    const encoded = JSON.stringify(record);
    const previous = byKey.get(key);
    if (previous !== undefined) {
      if (previous !== encoded) throw new TraceProtocolError("a trace record conflicts with a duplicate");
      continue;
    }
    byKey.set(key, encoded);
    if (record.kind !== "observed") {
      const terminalKey = [record.rule, record.file].join("\u0000");
      const outcome = record.kind === "skipped" ? `skipped:${record.reason}` : "checked";
      const previousOutcome = terminals.get(terminalKey);
      if (previousOutcome !== undefined) {
        throw new TraceProtocolError(`rule '${record.rule}' has contradictory outcomes for '${record.file}'`);
      }
      terminals.set(terminalKey, outcome);
    }
    accepted.push(record);
  }
  return accepted;
}
