/**
 * @module ReportCommand
 * @path src/cli/commands/report.ts
 * @description The `report` route: bind the host config, run real `deno lint --json`, and collect table/JSON output.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/report/collect.ts, src/report/model.ts, src/cli/project_loader.ts, src/cli/safe_write.ts]
 */

import { dirname, fromFileUrl, isAbsolute, relative, resolve, toFileUrl } from "@std/path";
import type { JsonValue } from "../../engine/catalog.ts";
import { ConfigV2Schema, type IConfigV2 } from "../../config/schema.ts";
import { compileConfig } from "../../config/compile.ts";
import { ConfigError } from "../../config/schema.ts";
import type { IProjectDescriptor } from "../../config/descriptor.ts";
import { parseTraceStderr, reconcileTraceRecords, traceEnvName, TraceProtocolError } from "../../engine/trace.ts";
import { collectRunReport } from "../../report/collect.ts";
import type { IRunContext, ISourceSnapshot } from "../../report/context.ts";
import { captureSources, SnapshotError } from "../../report/snapshot.ts";
import type { IFinding, IHostDiagnostic, IHostError, ILintRunResult, IRunReport } from "../../report/model.ts";
import { CliError, FAILURE_EXIT, USAGE_EXIT } from "../error.ts";
import { loadConfigDescriptor } from "../project_loader.ts";
import type { IResolvedSelection } from "../../config/selectors.ts";
import { resolveSelection, ruleStatus } from "../selection.ts";
import { selectionEnvName } from "../../engine/rule_gate.ts";
import { jsonText, type ReportFormat, tableText } from "../output.ts";
import { markdownReport } from "../../report/markdown.ts";
import { sarifReport } from "../../report/sarif.ts";

/** The options of one report run. */
export interface IReportOptions {
  readonly descriptor: string | null;
  readonly plugin: string | null;
  readonly select: string | null;
  readonly profile: string | null;
  readonly paths: readonly string[];
}

/** One captured child result, or the test seam that replaces the real child. */
export interface IHostOutput {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

/** Test seams for policy drift and host termination. Production omits them. */
export interface IReportHooks {
  readonly afterSpawn?: () => void | Promise<void>;
  readonly spawn?: (args: readonly string[], cwd: string, env: Record<string, string>) => Promise<IHostOutput>;
}

const JSON_FORMAT = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const DECODER = new TextDecoder();

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function usage(message: string): never {
  throw new CliError(USAGE_EXIT, message);
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function realDirectory(url: URL): Promise<string> {
  if (url.protocol !== "file:") usage(`${url.href}: the project root must be a local directory.`);
  let path: string;
  try {
    path = await Deno.realPath(fromFileUrl(url));
  } catch {
    usage(`${url.href}: the project root does not exist.`);
  }
  if (!(await Deno.stat(path)).isDirectory) usage(`${url.href}: the project root is not a directory.`);
  return path;
}

async function realFile(url: URL): Promise<string> {
  if (url.protocol !== "file:") usage(`${url.href}: the file must be local.`);
  let path: string;
  try {
    path = await Deno.realPath(fromFileUrl(url));
  } catch {
    usage(`${url.href}: the file does not exist.`);
  }
  if (!(await Deno.stat(path)).isFile) usage(`${url.href}: the path is not a file.`);
  return path;
}

function readJson(bytes: Uint8Array, label: string): JsonValue {
  try {
    return JSON.parse(DECODER.decode(bytes)) as JsonValue;
  } catch (error) {
    usage(`${label}: invalid JSON (${messageOf(error)})`);
  }
}

function parseConfig(raw: JsonValue, descriptor: IProjectDescriptor): IConfigV2 {
  const parsed = ConfigV2Schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    usage(`${descriptor.configUrl.href}: ${issue?.path.join(".") || "config"}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

function configuredPluginPaths(lintConfig: JsonValue, lintConfigPath: string): string[] {
  const root = asRecord(lintConfig);
  const lint = root ? asRecord(root.lint) : null;
  const plugins = lint?.plugins;
  if (!Array.isArray(plugins)) return [];
  const base = dirname(lintConfigPath);
  return plugins
    .filter((plugin): plugin is string => typeof plugin === "string")
    .map((plugin) => resolve(base, plugin));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is { line: number; col: number } {
  return isObject(value) && typeof value.line === "number" && typeof value.col === "number";
}

function isOrderedRange(start: { line: number; col: number }, end: { line: number; col: number }): boolean {
  return Number.isInteger(start.line) && Number.isInteger(start.col) &&
    Number.isInteger(end.line) && Number.isInteger(end.col) &&
    start.line >= 1 && start.col >= 0 && end.line >= start.line &&
    (end.line !== start.line || end.col >= start.col);
}

interface IDiagnosticRecord {
  readonly filename: string;
  readonly code: string;
  readonly message: string;
  readonly hint?: string | null;
}

function isDiagnosticRecord(entry: Record<string, unknown>): entry is Record<string, unknown> & IDiagnosticRecord {
  return typeof entry.filename === "string" && entry.filename.length > 0 &&
    typeof entry.code === "string" && entry.code.length > 0 &&
    typeof entry.message === "string" &&
    (entry.hint === undefined || entry.hint === null || typeof entry.hint === "string");
}

function diagnosticOf(entry: unknown): IHostDiagnostic {
  if (!isObject(entry)) throw new Error("the host JSON has a malformed diagnostic");
  const range = isObject(entry.range) ? entry.range : null;
  const start = range === null ? null : range.start;
  const end = range === null ? null : range.end;
  if (!isPosition(start) || !isPosition(end)) throw new Error("the host JSON has a malformed diagnostic");
  if (!isDiagnosticRecord(entry)) throw new Error("the host JSON has a malformed diagnostic");
  if (!isOrderedRange(start, end)) throw new Error("the host JSON has a malformed diagnostic");
  return {
    filename: entry.filename,
    range: { start: { line: start.line, col: start.col }, end: { line: end.line, col: end.col } },
    code: entry.code,
    message: entry.message,
    hint: entry.hint ?? null,
  };
}

function parseDiagnostics(value: unknown): IHostDiagnostic[] {
  if (!Array.isArray(value)) throw new Error("the host JSON has no diagnostics array");
  return value.map(diagnosticOf);
}

function parseErrors(value: unknown): IHostError[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("the host JSON has a malformed errors field");
  return value.map((entry) => {
    const record = asRecord(entry);
    if (!record || typeof record.file_path !== "string" || typeof record.message !== "string") {
      throw new Error("the host JSON has a malformed host error");
    }
    return { file_path: record.file_path, message: record.message };
  });
}

async function readBytesOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch {
    return null;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array | null): boolean {
  if (right === null || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function defaultSpawn(args: readonly string[], cwd: string, env: Record<string, string>): Promise<IHostOutput> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [...args],
    cwd,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function childEnvironment(pluginName: string, selectionTokens: string | null, runId: string): Record<string, string> {
  let env: Record<string, string> = {};
  try {
    env = { ...Deno.env.toObject() };
  } catch (error) {
    if (!(error instanceof Deno.errors.NotCapable)) throw error;
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("LD_") || key.startsWith("DYLD_")) delete env[key];
  }
  if (selectionTokens !== null) env[selectionEnvName(pluginName)] = selectionTokens;
  env[traceEnvName(pluginName)] = runId;
  return env;
}

function failedResult(
  descriptor: IProjectDescriptor,
  selectedPluginUrl: URL,
  paths: readonly string[],
  runId: string,
  failure: string,
  diagnostics: readonly IHostDiagnostic[],
  errors: readonly IHostError[],
  records: ILintRunResult["records"],
  hostStderr: string,
  exitCode: number | null,
  signal: string | null,
): ILintRunResult {
  return {
    input: { descriptor, selectedPluginUrl, paths, selection: null, runId },
    exitCode,
    diagnostics,
    errors,
    records,
    hostStderr,
    signal,
    completion: "failed",
    failure,
  };
}

/** Runs one report and returns the collected result. Binding failures throw a usage error. */
async function descriptorOrFail(cwd: string, options: IReportOptions): Promise<IProjectDescriptor> {
  try {
    return await loadConfigDescriptor(cwd, options.descriptor, options.plugin);
  } catch (error) {
    if (error instanceof CliError) throw error;
    usage(`${messageOf(error)}`);
  }
}

function requireInside(root: string, entries: readonly (readonly [string, string])[]): void {
  for (const [label, path] of entries) {
    if (!isWithin(root, path)) usage(`${path}: the ${label} must be inside the project root.`);
  }
}

function compileOrFail(rawConfig: JsonValue, descriptor: IProjectDescriptor, configPath: string) {
  try {
    return compileConfig(rawConfig, descriptor);
  } catch (error) {
    if (error instanceof ConfigError) usage(`${configPath}: ${error.message}`);
    usage(`${messageOf(error)}`);
  }
}

interface IBoundProject {
  readonly descriptor: IProjectDescriptor;
  readonly reportDescriptor: IProjectDescriptor;
  readonly root: string;
  readonly configPath: string;
  readonly lintConfigPath: string;
  readonly configBytes: Uint8Array;
  readonly lintConfigBytes: Uint8Array;
  readonly rawConfig: JsonValue;
  readonly config: IConfigV2;
  readonly compiled: ReturnType<typeof compileConfig>;
  readonly lintConfig: JsonValue;
}

async function boundProject(cwd: string, options: IReportOptions): Promise<IBoundProject> {
  const descriptor = await descriptorOrFail(cwd, options);
  const root = await realDirectory(descriptor.rootUrl);
  const reportDescriptor = {
    ...descriptor,
    rootUrl: toFileUrl(root.endsWith("/") ? root : `${root}/`),
  };
  const configPath = await realFile(descriptor.configUrl);
  const lintConfigPath = await realFile(descriptor.lintConfigUrl);
  const pluginPath = await realFile(descriptor.pluginUrl);
  requireInside(root, [
    ["configuration", configPath],
    ["lint configuration", lintConfigPath],
    ["plugin", pluginPath],
  ]);
  const configBytes = await readBytesOrNull(configPath);
  const lintConfigBytes = await readBytesOrNull(lintConfigPath);
  if (configBytes === null || lintConfigBytes === null) usage(`${configPath}: cannot read the binding files.`);
  const rawConfig = readJson(configBytes, configPath);
  const config = parseConfig(rawConfig, descriptor);
  const compiled = compileOrFail(rawConfig, descriptor, configPath);
  const lintConfig = readJson(lintConfigBytes, lintConfigPath);
  return {
    descriptor,
    reportDescriptor,
    root,
    configPath,
    lintConfigPath,
    configBytes,
    lintConfigBytes,
    rawConfig,
    config,
    compiled,
    lintConfig,
  };
}

async function ensurePluginSelected(
  lintConfig: JsonValue,
  lintConfigPath: string,
  pluginUrl: URL,
): Promise<void> {
  const pluginPaths = configuredPluginPaths(lintConfig, lintConfigPath);
  const selectedPlugin = await realFile(pluginUrl);
  const matching = await Promise.all(pluginPaths.map(async (path) => {
    try {
      return await Deno.realPath(path);
    } catch {
      return path;
    }
  }));
  if (matching.filter((path) => path === selectedPlugin).length !== 1) {
    usage(`${lintConfigPath}: the selected plugin must appear exactly once in lint.plugins.`);
  }
}

async function operandPathsOrFail(cwd: string, root: string, operands: readonly string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const operand of operands.length === 0 ? [cwd] : operands) {
    if (JSON_FORMAT.test(operand) && !WINDOWS_DRIVE.test(operand)) {
      usage(`'${operand}' is not a filesystem path.`);
    }
    let path: string;
    try {
      path = await Deno.realPath(resolve(cwd, operand));
    } catch {
      usage(`'${operand}' does not exist.`);
    }
    if (!isWithin(root, path)) usage(`${path}: the operand is outside the project root.`);
    paths.push(path);
  }
  return paths;
}

async function captureOrFail(paths: readonly string[], root: string): Promise<ReadonlyMap<string, ISourceSnapshot>> {
  try {
    return await captureSources(paths, root);
  } catch (error) {
    if (error instanceof SnapshotError) usage(error.message);
    usage(`${messageOf(error)}`);
  }
}

function resolveSelectionOrFail(
  compiled: IBoundProject["compiled"],
  config: IConfigV2,
  pluginName: string,
  select: string | null,
  profile: string | null,
): IResolvedSelection | null {
  try {
    return resolveSelection(compiled, config, pluginName, select, profile);
  } catch (error) {
    if (error instanceof CliError) throw error;
    usage(messageOf(error));
  }
}

interface IHostParse {
  readonly diagnostics: readonly IHostDiagnostic[];
  readonly errors: readonly IHostError[];
  readonly records: ILintRunResult["records"];
  readonly hostStderr: string;
  readonly failure: string | null;
}

function parseHostRun(
  stdout: string,
  stderr: string,
  runId: string,
  descriptor: IProjectDescriptor,
  compiled: IBoundProject["compiled"],
  selection: IResolvedSelection | null,
): IHostParse {
  try {
    const report = JSON.parse(stdout) as Record<string, unknown>;
    const diagnostics = parseDiagnostics(report.diagnostics);
    const errors = parseErrors(report.errors);
    const trace = parseTraceStderr(stderr, runId);
    const activeRules = new Set(
      Object.values(compiled.rules)
        .filter((rule) => rule.engine === "plugin" && ruleStatus(rule, selection) === "active")
        .map((rule) => rule.id),
    );
    const records = reconcileTraceRecords(trace.records, {
      runId,
      plugin: descriptor.pluginName,
      activeRules,
    });
    return { diagnostics, errors, records, hostStderr: trace.unrelated.join("\n"), failure: null };
  } catch (error) {
    const failure = error instanceof TraceProtocolError
      ? `trace protocol failure: ${error.message}`
      : `host output failure: ${messageOf(error)}`;
    return { diagnostics: [], errors: [], records: [], hostStderr: "", failure };
  }
}

function completionFailure(
  initial: string | null,
  host: IHostOutput,
  policyStable: boolean,
  errors: readonly IHostError[],
  sourceStable: boolean,
  diagnostics: readonly IHostDiagnostic[],
): string | null {
  let failure = initial;
  if (!sourceStable) failure = "the diagnosed source changed during the run";
  if (host.signal !== null) failure = `the lint host terminated with signal ${host.signal}`;
  if (host.code === null) failure ??= "the lint host exited without a code";
  if (errors.length > 0) failure ??= `the lint host reported ${errors.length} error(s)`;
  if (!policyStable) failure ??= "the policy changed during the run";
  if (failure === null && host.code !== 0 && diagnostics.length === 0) {
    failure = `the lint host exited with code ${host.code} without findings`;
  }
  return failure;
}

export async function runReport(
  cwd: string,
  options: IReportOptions,
  hooks: IReportHooks,
): Promise<IRunReport> {
  const bound = await boundProject(cwd, options);
  const {
    descriptor,
    reportDescriptor,
    root,
    configPath,
    lintConfigPath,
    configBytes,
    lintConfigBytes,
    config,
    compiled,
  } = bound;
  await ensurePluginSelected(bound.lintConfig, lintConfigPath, descriptor.pluginUrl);
  const paths = await operandPathsOrFail(cwd, root, options.paths);
  const sources = await captureOrFail(paths, root);
  const selection = resolveSelectionOrFail(compiled, config, descriptor.pluginName, options.select, options.profile);
  const selectionTokens = options.profile !== null
    ? config.profiles[options.profile]?.join(",") ?? null
    : options.select;
  const runId = crypto.randomUUID();
  const env = childEnvironment(descriptor.pluginName, selectionTokens, runId);
  const args = ["lint", "--json", `--config=${lintConfigPath}`, ...paths];
  let host: IHostOutput;
  try {
    host = hooks.spawn === undefined ? await defaultSpawn(args, root, env) : await hooks.spawn(args, root, env);
  } catch (error) {
    return collectRunReport(
      failedResult(
        reportDescriptor,
        descriptor.pluginUrl,
        paths,
        runId,
        `cannot run the lint host: ${messageOf(error)}`,
        [],
        [],
        [],
        "",
        null,
        null,
      ),
      contextOf(compiled, selection, descriptor, configBytes, lintConfigBytes, sources),
    );
  }
  await hooks.afterSpawn?.();
  const policyStable = bytesEqual(configBytes, await readBytesOrNull(configPath)) &&
    bytesEqual(lintConfigBytes, await readBytesOrNull(lintConfigPath));
  const parsed = parseHostRun(
    DECODER.decode(host.stdout),
    DECODER.decode(host.stderr),
    runId,
    descriptor,
    compiled,
    selection,
  );
  const sourceStable = await diagnosedSourcesStable(parsed.diagnostics, sources, root);
  const failure = completionFailure(
    parsed.failure,
    host,
    policyStable,
    parsed.errors,
    sourceStable,
    parsed.diagnostics,
  );
  const result: ILintRunResult = {
    input: {
      descriptor: reportDescriptor,
      selectedPluginUrl: descriptor.pluginUrl,
      paths,
      selection: selectionTokens,
      runId,
    },
    exitCode: host.code,
    diagnostics: parsed.diagnostics,
    errors: parsed.errors,
    records: parsed.records,
    hostStderr: parsed.hostStderr,
    signal: host.signal,
    completion: failure === null ? "complete" : "failed",
    failure,
  };
  return collectRunReport(
    result,
    contextOf(compiled, selection, descriptor, configBytes, lintConfigBytes, sources),
  );
}

function diagnosticSourcePath(filename: string, root: string): string {
  let path = filename;
  if (filename.startsWith("file:")) {
    try {
      path = fromFileUrl(filename);
    } catch {
      path = filename;
    }
  }
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? rel : path;
}

async function diagnosedSourcesStable(
  diagnostics: readonly IHostDiagnostic[],
  sources: ReadonlyMap<string, ISourceSnapshot>,
  root: string,
): Promise<boolean> {
  for (const diagnostic of diagnostics) {
    const source = sources.get(diagnosticSourcePath(diagnostic.filename, root));
    if (!source) return false;
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(source.canonicalPath);
    } catch {
      return false;
    }
    if (!bytesEqual(source.bytes, bytes)) return false;
  }
  return true;
}

function contextOf(
  compiled: ReturnType<typeof compileConfig>,
  selection: IResolvedSelection | null,
  descriptor: IProjectDescriptor,
  configBytes: Uint8Array,
  lintConfigBytes: Uint8Array,
  sources: ReadonlyMap<string, ISourceSnapshot> | null,
): IRunContext {
  return {
    compiled,
    selection,
    policy: [
      { url: descriptor.configUrl, bytes: configBytes },
      { url: descriptor.lintConfigUrl, bytes: lintConfigBytes },
    ],
    sources,
  };
}

/** Renders a report as JSON or the concise table. */
export function renderReport(report: IRunReport, format: ReportFormat): string {
  if (format === "json") return jsonText(report);
  if (format === "markdown") return markdownReport(report);
  if (format === "sarif") return jsonText(sarifReport(report));
  const coverageHeaders = ["ID", "STATUS", "COVERAGE", "CHECKED", "SKIPPED", "FINDINGS"] as const;
  const coverageRows = report.rules.map((summary) => [
    summary.rule.id,
    summary.status,
    summary.coverage,
    String(summary.observedChecked),
    Object.entries(summary.observedSkipped).map(([reason, count]) => `${reason}=${count}`).join(","),
    String(summary.findings),
  ]);
  const findingHeaders = ["RULE", "ORIGIN", "FILE", "LOCATION", "LEVEL", "MESSAGE", "HINT"] as const;
  const findingRows = (findings: readonly IFinding[], origin: (finding: IFinding) => string) =>
    findings.map((finding) => [
      finding.ruleId,
      origin(finding),
      finding.file,
      `${finding.startLine}:${finding.startColumn}-${finding.endLine}:${finding.endColumn}`,
      finding.effectiveLevel,
      finding.message,
      finding.hint ?? "",
    ]);
  const notRunHeaders = ["ID", "MODE", "COMMAND"] as const;
  const notRunRows = report.notRun.map((check) => [
    check.id,
    check.mode,
    check.command === null ? "" : check.command.join(" "),
  ]);
  return [
    `completion: ${report.completion}`,
    ...(report.failure === null ? [] : [`failure: ${report.failure}`]),
    `files observed: ${report.filesObserved.length} (host-wide visitation unavailable)`,
    tableText(coverageHeaders, coverageRows),
    "Selected findings:",
    ...(report.findings.length === 0
      ? ["No selected findings."]
      : [tableText(findingHeaders, findingRows(report.findings, () => "unslop"))]),
    "Foreign findings:",
    ...(report.foreignFindings.length === 0 ? ["No foreign findings."] : [tableText(
      findingHeaders,
      findingRows(report.foreignFindings, (finding) => finding.ruleId.includes("/") ? "other-plugin" : "deno-built-in"),
    )]),
    "Not run:",
    ...(report.notRun.length === 0 ? ["No deferred checks."] : [tableText(notRunHeaders, notRunRows)]),
    "",
  ].join("\n");
}

/** The report exit code: 1 for a failed run or any effective-error finding. */
export function reportExitCode(report: IRunReport): number {
  if (report.completion === "failed") return FAILURE_EXIT;
  return report.findings.some((finding) => finding.effectiveLevel === "error") ||
      report.foreignFindings.length > 0
    ? FAILURE_EXIT
    : 0;
}
