/**
 * @module TestFixtureRules
 * @path src/rules/test_fixture_rules.ts
 * @description Reports a multi-line template string that holds a structured test fixture inline.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/engine/type_environment.ts]
 */

import { asNode, type ILintNode } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

interface ITemplateShape {
  readonly lineCount: number;
  readonly firstLine: string | null;
  readonly interpolated: boolean;
}

const DEFAULT_MIN_LINES = 7;
const DEFAULT_NAMES = ["markdown", "yaml", "json", "input", "payload", "text", "content"];
const DEFAULT_DIRECTORY = "";
const LINE_BREAK = /\r?\n/;
const DOCUMENT_START = /^(?:\[[A-Za-z_]|schema_version:)/;
const FRONT_MATTER_START = /^(?:---|#)/;

/** The lines of a template that count toward its size, as a reader sees them. */
function shapeOf(text: string, template: ILintNode): ITemplateShape | null {
  const range = template.range;
  if (!range) return null;
  const segments = text.slice(range[0] + 1, range[1] - 1).split(LINE_BREAK);
  if (segments.length < 2) return null;
  const last = segments.length - 1;
  const counted = segments.filter((segment, index) => (index === 0 || index === last ? segment.trim() !== "" : true));
  const firstLine = segments.map((segment) => segment.trim()).find((segment) => segment !== "") ?? null;
  const expressions = template.expressions;
  return { lineCount: counted.length, firstLine, interpolated: Array.isArray(expressions) && expressions.length > 0 };
}

function templateOf(init: ILintNode | undefined): { template: ILintNode; tagged: boolean } | null {
  if (!init) return null;
  if (init.type === "TemplateLiteral") return { template: init, tagged: false };
  if (init.type === "TaggedTemplateExpression" && init.quasi) {
    return { template: asNode(init.quasi), tagged: true };
  }
  return null;
}

export function createTestInlineMultilineFixture(
  context: Deno.lint.RuleContext,
  ctx: IPluginRuleContext,
): LintVisitor {
  const minLines = typeof ctx.options.minLines === "number" ? ctx.options.minLines : DEFAULT_MIN_LINES;
  const names = new Set(
    Array.isArray(ctx.options.variableNames) ? ctx.options.variableNames.map(String) : DEFAULT_NAMES,
  );
  const directory = typeof ctx.options.fixturesDirectory === "string"
    ? ctx.options.fixturesDirectory
    : DEFAULT_DIRECTORY;
  const location = directory === "" ? "a fixture file" : `a package-local fixture under ${directory}`;
  return {
    VariableDeclarator(rawNode: Deno.lint.Node): void {
      const node = asNode(rawNode);
      const id = node.id ? asNode(node.id) : undefined;
      if (id?.type !== "Identifier") return;
      const found = templateOf(node.init ? asNode(node.init) : undefined);
      const shape = found ? shapeOf(context.sourceCode.text, found.template) : null;
      if (!found || !shape) return;
      const named = names.has(String(id.name));
      const document = !found.tagged && shape.firstLine !== null && DOCUMENT_START.test(shape.firstLine);
      const big = shape.lineCount >= minLines && !shape.interpolated;
      const frontMatter = !found.tagged && big && shape.firstLine !== null && FRONT_MATTER_START.test(shape.firstLine);
      if (!document && !(named && big) && !frontMatter) return;
      context.report({
        node: rawNode,
        message:
          `Avoid inline multiline structured text fixtures in test files. Move YAML, markdown, JSON, or other multi-line test inputs into ${location} and load them from the test file.`,
        hint: `See ${ctx.codeStyle ?? "the test quality rules"}.`,
      });
    },
  };
}
