/**
 * @module ReportFixtureTestHelper
 * @path tests/helpers/report_fixture.ts
 * @description A deterministic report with escaped Markdown content and mixed findings.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/report_markdown_test.ts, src/report/markdown.ts]
 */

import type { IHostDiagnostic, IResolvedRule, IRunReport } from "../../mod.ts";

const RULE: IResolvedRule = {
  id: "demo/rule",
  engine: "plugin",
  meta: {
    description: "A rule | with a pipe",
    category: "type-safety",
    docs: "#rule",
    preset: "recommended",
    limits: null,
  },
  configuredLevel: "error",
  effectiveLevel: "error",
  configuredOptions: {},
  defaultOptions: null,
  effectiveOptions: null,
  scope: "all",
  include: null,
  exclude: null,
  optIn: false,
  reason: null,
  exclusionCodes: null,
  docs: "#rule",
  tags: ["type-safety", "project"],
  defaultLimits: null,
  controls: {
    editable: ["level"],
    fixedLevel: null,
    fixedScope: null,
    fixedInclude: null,
    fixedExclude: null,
    hostModes: { default: "error" },
  },
  command: null,
  sources: { fields: { level: "default" } },
};

const FOREIGN: IHostDiagnostic = {
  filename: "src/a [x]#100%.ts",
  range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
  code: "no-explicit-any",
  message: "Foreign | message [x] %",
  hint: null,
};

/** A report whose content exercises every Markdown escape and both finding sections. */
export function markdownFixture(): IRunReport {
  return {
    tool: { name: "unslop-ts", version: "0.1.1" },
    projectRoot: "/demo",
    completion: "complete",
    failure: null,
    hostExitCode: 1,
    hostFilesVisited: null,
    filesObserved: ["src/a [x]#100%.ts"],
    rules: [{
      rule: RULE,
      status: "active",
      coverage: "partial",
      observedChecked: 1,
      observedSkipped: { ignored: 1, fixture: 0, scope: 0, include: 0, exclude: 0 },
      unobserved: ["src/b.ts"],
      findings: 1,
    }],
    findings: [{
      ruleId: "demo/rule",
      file: "src/a [x]#100%.ts",
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 2,
      effectiveLevel: "error",
      message: "Selected | message [x](https://evil.test) % <script>",
      hint: "Use | pipes <b>bold</b>",
      fingerprint: null,
    }],
    foreignDiagnostics: [FOREIGN],
    foreignFindings: [{
      ruleId: FOREIGN.code,
      file: FOREIGN.filename,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 2,
      effectiveLevel: "error",
      message: FOREIGN.message,
      hint: null,
      fingerprint: null,
    }],
    errors: [],
    notRun: [{
      id: "constant-restatement",
      command: ["deno", "run", "-A", "/engine/src/cli/whole_tree.ts", "--rule=constant-restatement"],
      mode: "default",
    }],
  };
}
