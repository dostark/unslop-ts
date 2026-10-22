/**
 * @module ReportSarif
 * @path src/report/sarif.ts
 * @description SARIF 2.1.0 report and rule-list adapters with stable descriptors, URIs, and fingerprints.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/report/model.ts, src/report/collect.ts]
 */

import { toFileUrl } from "@std/path";
import type { ICompiledConfig, IResolvedRule } from "../config/descriptor.ts";
import type { IFinding, IRunReport } from "./model.ts";

const SARIF_SCHEMA = "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json";
const TOOL_VERSION = "0.1.1";
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

function artifactsOf(findings: readonly IFinding[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const artifacts: Record<string, unknown>[] = [];
  for (const finding of findings) {
    if (seen.has(finding.file)) continue;
    seen.add(finding.file);
    artifacts.push({
      location: { uri: encodePath(finding.file), uriBaseId: SRCROOT },
      sourceLanguage: "typescript",
    });
  }
  return artifacts;
}

/** Renders a complete report as SARIF 2.1.0. */
export function sarifReport(report: IRunReport): Record<string, unknown> {
  const descriptors = report.rules.map((summary) => selectedDescriptor(summary.rule));
  const codes = [...new Set(report.foreignDiagnostics.map((diagnostic) => diagnostic.code))].sort();
  for (const code of codes) descriptors.push(foreignDescriptor(code));
  descriptors.sort((left, right) => left.id.localeCompare(right.id));
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
    originalUriBaseIds: { [SRCROOT]: { uri: toFileUrl(report.projectRoot).href } },
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

/** Renders the rules-list SARIF: descriptors only, with no results or invocation. */
export function sarifRules(compiled: ICompiledConfig): Record<string, unknown> {
  const descriptors = Object.values(compiled.rules)
    .map(selectedDescriptor)
    .sort((left, right) => left.id.localeCompare(right.id));
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
