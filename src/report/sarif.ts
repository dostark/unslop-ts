/**
 * @module ReportSarif
 * @path src/report/sarif.ts
 * @description SARIF 2.1.0 report and rule-list adapters with stable descriptors, URIs, and fingerprints.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/report/model.ts, src/report/collect.ts]
 */

import { extname, toFileUrl } from "@std/path";
import type { ICompiledConfig, IResolvedRule } from "../config/descriptor.ts";
import type { ICycleFinding, TCycleKind } from "../rules/whole_tree/import_cycles.ts";
import type { IFinding, IRunReport } from "./model.ts";
import { TOOL_VERSION } from "./version.ts";

const SARIF_SCHEMA = "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json";
const TOOL_URI = "https://github.com/dostark/unslop-ts";
const SRCROOT = "%SRCROOT%";
const MAX_TAGS = 10;

interface ISarifDescriptor {
  readonly id: string;
  readonly name: string;
  readonly shortDescription: { readonly text: string };
  readonly fullDescription: { readonly text: string };
  readonly help: { readonly text: string };
  readonly helpUri?: string;
  readonly properties: Record<string, unknown>;
}

function absoluteHelpUri(docs: string): string | null {
  if (!/^(https?|file):/.test(docs)) return null;
  try {
    new URL(docs);
    return docs;
  } catch {
    return null;
  }
}

function tagsOf(rule: IResolvedRule): string[] {
  const category = rule.meta.category;
  const rest = [...new Set([...rule.tags].sort())].filter((tag) => tag !== category);
  return [category, ...rest].slice(0, MAX_TAGS);
}

function selectedDescriptor(rule: IResolvedRule): ISarifDescriptor {
  const description = rule.meta.description;
  const limits = rule.meta.limits;
  const helpUri = absoluteHelpUri(rule.docs);
  return {
    id: rule.id,
    name: rule.id,
    shortDescription: { text: description },
    fullDescription: { text: limits === null ? description : `${description} ${limits}` },
    help: { text: rule.docs },
    ...(helpUri === null ? {} : { helpUri }),
    properties: { tags: tagsOf(rule), category: rule.meta.category },
  };
}

function foreignDescriptor(code: string): ISarifDescriptor {
  const origin = code.includes("/") ? "other-plugin" : "deno-built-in";
  return {
    id: `deno:${code}`,
    name: code,
    shortDescription: { text: code },
    fullDescription: { text: code },
    help: { text: code },
    properties: { hostRuleId: code, origin },
  };
}

function encodePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function regionOf(finding: IFinding): Record<string, unknown> {
  return {
    startLine: finding.startLine,
    startColumn: finding.startColumn + 1,
    endLine: finding.endLine,
    endColumn: finding.endColumn + 1,
  };
}

function physicalLocation(finding: IFinding): Record<string, unknown> {
  return {
    artifactLocation: { uri: encodePath(finding.file), uriBaseId: SRCROOT },
    region: regionOf(finding),
  };
}

function resultOf(
  finding: IFinding,
  ruleId: string,
  ruleIndex: number,
  foreign: boolean,
): Record<string, unknown> {
  return {
    ruleId,
    ruleIndex,
    level: finding.effectiveLevel === "warn" ? "warning" : "error",
    message: { text: finding.message },
    locations: [{ physicalLocation: physicalLocation(finding) }],
    ...(finding.fingerprint === null ? {} : { partialFingerprints: { "unslop/v1": finding.fingerprint } }),
    properties: {
      ...(foreign
        ? { hostRuleId: finding.ruleId, origin: finding.ruleId.includes("/") ? "other-plugin" : "deno-built-in" }
        : { origin: "unslop" }),
      ...(finding.hint === null ? {} : { hint: finding.hint }),
    },
  };
}

function ruleIndexMap(descriptors: readonly ISarifDescriptor[]): Map<string, number> {
  return new Map(descriptors.map((descriptor, index) => [descriptor.id, index]));
}

function sourceLanguage(file: string): string {
  return [".js", ".jsx", ".mjs", ".cjs"].includes(extname(file)) ? "javascript" : "typescript";
}

function artifactsOf(findings: readonly IFinding[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const artifacts: Record<string, unknown>[] = [];
  for (const finding of findings) {
    if (seen.has(finding.file)) continue;
    seen.add(finding.file);
    artifacts.push({
      location: { uri: encodePath(finding.file), uriBaseId: SRCROOT },
      sourceLanguage: sourceLanguage(finding.file),
    });
  }
  return artifacts;
}

/** Renders a complete report as SARIF 2.1.0. */
export function sarifReport(report: IRunReport): Record<string, unknown> {
  const descriptors = report.rules.map((summary) => selectedDescriptor(summary.rule));
  const codes = [...new Set(report.foreignDiagnostics.map((diagnostic) => diagnostic.code))].sort();
  for (const code of codes) descriptors.push(foreignDescriptor(code));
  descriptors.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const indices = ruleIndexMap(descriptors);
  const results = [
    ...report.findings.map((finding) => resultOf(finding, finding.ruleId, indices.get(finding.ruleId) ?? 0, false)),
    ...report.foreignFindings.map((finding) =>
      resultOf(finding, `deno:${finding.ruleId}`, indices.get(`deno:${finding.ruleId}`) ?? 0, true)
    ),
  ];
  const run = {
    tool: {
      driver: {
        name: "unslop-ts",
        version: report.tool.version,
        informationUri: TOOL_URI,
        rules: descriptors,
      },
    },
    originalUriBaseIds: {
      [SRCROOT]: {
        uri: toFileUrl(report.projectRoot.endsWith("/") ? report.projectRoot : `${report.projectRoot}/`).href,
      },
    },
    columnKind: "unicodeCodePoints",
    artifacts: artifactsOf([...report.findings, ...report.foreignFindings]),
    results,
    invocations: [{
      executionSuccessful: report.completion === "complete",
      toolExecutionNotifications: report.failure === null ? [] : [{
        level: "error",
        message: { text: report.failure },
      }],
    }],
  };
  return { $schema: SARIF_SCHEMA, version: "2.1.0", runs: [run] };
}

/** The SARIF level of one cycle kind. Runtime cycles fail; the other kinds are advisory. */
type SarifLevel = "error" | "warning" | "note";

/** The stable SARIF rule id of an import cycle. */
const CYCLE_RULE_ID = "unslop/import-cycle";

/** The SARIF rule descriptor of the import-cycle check. */
function cycleDescriptor(): ISarifDescriptor {
  return {
    id: CYCLE_RULE_ID,
    name: CYCLE_RULE_ID,
    shortDescription: { text: "A set of files that import each other in a cycle." },
    fullDescription: {
      text:
        "A set of files that import each other in a cycle. A runtime cycle fails the gate; a type-only and a mixed cycle are advisory.",
    },
    help: { text: "#import-cycles" },
    properties: { tags: ["imports"], category: "imports" },
  };
}

/** The SARIF level of one cycle: runtime fails, mixed warns, and type-only is a note. */
function cycleLevel(kind: TCycleKind): SarifLevel {
  if (kind === "runtime") return "error";
  return kind === "mixed" ? "warning" : "note";
}

/** The one-line SARIF message of one cycle, with no source text. */
function cycleMessage(cycle: ICycleFinding): string {
  return `${cycle.kind} cycle ${cycle.id} with ${cycle.size} file(s); break at ${cycle.path.join(" -> ")}`;
}

/** One SARIF result per cycle, located at every member file. */
function cycleResult(cycle: ICycleFinding): object {
  return {
    ruleId: CYCLE_RULE_ID,
    ruleIndex: 0,
    level: cycleLevel(cycle.kind),
    message: { text: cycleMessage(cycle) },
    locations: cycle.files.map((file) => ({
      physicalLocation: { artifactLocation: { uri: encodePath(file), uriBaseId: SRCROOT } },
    })),
    partialFingerprints: { "unslop-cycle/v1": cycle.id },
    properties: { cycleId: cycle.id, kind: cycle.kind, size: cycle.size, path: [...cycle.path] },
  };
}

/** The unique member files of a cycle set, as SARIF artifacts. */
function cycleArtifactsOf(cycles: readonly ICycleFinding[]): object[] {
  const seen = new Set<string>();
  const artifacts: object[] = [];
  for (const cycle of cycles) {
    for (const file of cycle.files) {
      if (seen.has(file)) continue;
      seen.add(file);
      artifacts.push({
        location: { uri: encodePath(file), uriBaseId: SRCROOT },
        sourceLanguage: sourceLanguage(file),
      });
    }
  }
  return artifacts;
}

/** A SARIF log envelope. A run stays dynamic because the schema allows many optional members. */
export interface ISarifLog {
  readonly $schema: string;
  readonly version: string;
  readonly runs: readonly object[];
}

/** Renders an import cycle analysis as SARIF 2.1.0, with one result per cycle. */
export function sarifCycleReport(
  cycles: readonly ICycleFinding[],
  projectRoot: string,
  truncated: boolean,
): ISarifLog {
  const run = {
    tool: {
      driver: {
        name: "unslop-ts",
        version: TOOL_VERSION,
        informationUri: TOOL_URI,
        rules: [cycleDescriptor()],
      },
    },
    originalUriBaseIds: {
      [SRCROOT]: {
        uri: toFileUrl(projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`).href,
      },
    },
    columnKind: "unicodeCodePoints",
    artifacts: cycleArtifactsOf(cycles),
    results: cycles.map(cycleResult),
    properties: { truncated },
  };
  return { $schema: SARIF_SCHEMA, version: "2.1.0", runs: [run] };
}

/** Renders the rules-list SARIF: descriptors only, with no results or invocation. */
export function sarifRules(compiled: ICompiledConfig): Record<string, unknown> {
  const descriptors = Object.values(compiled.rules)
    .map(selectedDescriptor)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "unslop-ts",
          version: TOOL_VERSION,
          informationUri: TOOL_URI,
          rules: descriptors,
        },
      },
      columnKind: "unicodeCodePoints",
    }],
  };
}
