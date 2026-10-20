/**
 * @module CommentRules
 * @path src/rules/comment_rules.ts
 * @description Comment rules: a long in-module comment, an ephemeral reference, and a decorative separator.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/comments.ts, src/rules/mod.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";
import { commentRuns, type ICommentRun } from "../engine/comments.ts";
import { lineStarts } from "../engine/module_layout.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

interface IPhrase {
  readonly pattern: string;
  readonly flags: string;
  readonly hint: string;
}

const DECORATIVE_LINE = /[=\-_~*─━═▬•]{4,}/;
const DEFAULT_MAX_LINES = 3;

const MONTH_NAME =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const FOUR_DIGIT_YEAR = "(?:19|20)\\d{2}";
const ANY_YEAR = `(?:\\d{2}|${FOUR_DIGIT_YEAR})`;
const MONTH_NUMBER = "(?:0?[1-9]|1[0-2])";
const DAY_NUMBER = "(?:0?[1-9]|[12]\\d|3[01])";
const DAY_WITH_ORDINAL = `${DAY_NUMBER}(?:st|nd|rd|th)?`;
const DATE_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${FOUR_DIGIT_YEAR}[-/.]${MONTH_NUMBER}[-/.]${DAY_NUMBER}\\b`),
  new RegExp(`\\b${FOUR_DIGIT_YEAR}${MONTH_NUMBER}${DAY_NUMBER}\\b`),
  new RegExp(`\\b(?:${MONTH_NUMBER}[-/.]${DAY_NUMBER}|${DAY_NUMBER}[-/.]${MONTH_NUMBER})[-/.]${ANY_YEAR}\\b`),
  new RegExp(
    `\\b(?:${MONTH_NAME}[\\s.-]+${DAY_WITH_ORDINAL}(?:,|[\\s.-])+(?:${FOUR_DIGIT_YEAR})|${DAY_WITH_ORDINAL}[\\s.-]+${MONTH_NAME}(?:,|[\\s.-])+(?:${FOUR_DIGIT_YEAR})|${MONTH_NAME}[\\s.-]+${FOUR_DIGIT_YEAR})\\b`,
    "i",
  ),
  new RegExp(`\\bQ[1-4][\\s.-]+${FOUR_DIGIT_YEAR}\\b`, "i"),
];

function hintFor(ctx: IPluginRuleContext, fallback: string): string {
  return `See ${ctx.codeStyle ?? fallback}.`;
}

export function createLongComment(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const maxLines = typeof ctx.options.maxLines === "number" ? ctx.options.maxLines : DEFAULT_MAX_LINES;
  return {
    Program(): void {
      for (const run of commentRuns(context.sourceCode)) {
        if (run.lines.length <= maxLines) continue;
        context.report({
          range: [run.range[0], run.range[1]],
          message:
            `Comment spans ${run.lines.length} lines, more than the ${maxLines}-line limit for in-module comments. Shorten it to the one non-obvious fact a reader needs, or move a longer explanation into the module's own documentation.`,
          hint: hintFor(ctx, "the comment discipline rules"),
        });
      }
    },
  };
}

function isPhrase(value: JsonValue): value is { [key: string]: JsonValue } & IPhrase {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof value.pattern === "string" && typeof value.flags === "string" && typeof value.hint === "string";
}

function phrasesOf(ctx: IPluginRuleContext): { regex: RegExp; hint: string }[] {
  const raw = ctx.options.phrases;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPhrase).map((phrase) => ({ regex: new RegExp(phrase.pattern, phrase.flags), hint: phrase.hint }));
}

function firstPhraseHint(run: ICommentRun, phrases: readonly { regex: RegExp; hint: string }[]): string | null {
  const text = run.lines.join("\n");
  return phrases.find((phrase) => phrase.regex.test(text))?.hint ?? null;
}

export function createEphemeralComment(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const phrases = phrasesOf(ctx);
  const checkDates = ctx.options.checkDates !== false;
  return {
    Program(): void {
      const text = context.sourceCode.text;
      if (checkDates) {
        for (const comment of context.sourceCode.getAllComments()) {
          const body = text.slice(comment.range[0], comment.range[1]);
          if (!DATE_PATTERNS.some((pattern) => pattern.test(body))) continue;
          context.report({
            range: comment.range,
            message:
              "Comment contains a calendar date; time-specific context belongs in version control or project documentation, not code comments that should remain durable.",
            hint: hintFor(ctx, "the comment discipline rules"),
          });
        }
      }
      for (const run of commentRuns(context.sourceCode)) {
        const hint = firstPhraseHint(run, phrases);
        if (hint === null) continue;
        context.report({
          range: [run.range[0], run.range[1]],
          message:
            `Comment references ${hint}; implementation history belongs in the commit message or phase-plan doc, not in code that outlives the task that produced it.`,
          hint: hintFor(ctx, "the comment discipline rules"),
        });
      }
    },
  };
}

export function createDecorativeComment(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  return {
    Program(): void {
      const text = context.sourceCode.text;
      const starts = lineStarts(text);
      for (const run of commentRuns(context.sourceCode)) {
        run.lines.forEach((line, index) => {
          if (!DECORATIVE_LINE.test(line)) return;
          const lineNumber = run.startLine + index;
          const start = starts[lineNumber - 1];
          context.report({
            range: [start, start + line.length],
            message:
              "Comment uses a decorative separator (====, ----, ────, or text wrapped in dashes). Drop it and write a plain comment — the decoration adds characters without adding meaning.",
            hint: hintFor(ctx, "the comment discipline rules"),
          });
        });
      }
    },
  };
}
