/**
 * @module IgnoreDirective
 * @path src/rules/deno/ignore_directive.ts
 * @description Parses Deno, ESLint, and Oxlint suppression comments into their ids and their reason.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/deno/ignore_needs_reason.ts, src/rules/deno/no_forbidden_lint_ignore.ts]
 */

import type { JsonValue } from "../../engine/catalog.ts";
import type { SuppressionDialect } from "../types.ts";

/** One suppression directive of a comment. */
export interface IIgnoreDirective {
  readonly dialect: SuppressionDialect;
  /** The directive keyword, such as `deno-lint-ignore` or `eslint-disable-next-line`. */
  readonly directive: string;
  readonly isFileDirective: boolean;
  readonly ids: readonly string[];
  /** The text after the separator, or an empty string when the comment has no reason. */
  readonly reason: string;
}

/** The separator a suppression comment puts between the rule ids and the reason. */
export const DEFAULT_REASON_SEPARATOR = "--";

/** Every dialect the shared parser understands. */
const SUPPRESSION_DIALECTS: readonly SuppressionDialect[] = ["deno", "eslint", "oxlint"];

const ID_SEPARATOR = /[\s,]+/;

interface IDirectivePattern {
  readonly dialect: SuppressionDialect;
  readonly directive: string;
  readonly pattern: RegExp;
  readonly isFileDirective: boolean;
}

const DIRECTIVES: readonly IDirectivePattern[] = [
  {
    dialect: "deno",
    directive: "deno-lint-ignore-file",
    pattern: /^\s*deno-lint-ignore-file(?:\s+(.*))?$/,
    isFileDirective: true,
  },
  {
    dialect: "deno",
    directive: "deno-lint-ignore",
    pattern: /^\s*deno-lint-ignore(?!-file)(?:\s+(.*))?$/,
    isFileDirective: false,
  },
  {
    dialect: "eslint",
    directive: "eslint-disable-next-line",
    pattern: /^\s*eslint-disable-next-line\s+(.+)$/,
    isFileDirective: false,
  },
  {
    dialect: "eslint",
    directive: "eslint-disable-line",
    pattern: /^\s*eslint-disable-line\s+(.+)$/,
    isFileDirective: false,
  },
  {
    dialect: "eslint",
    directive: "eslint-disable",
    pattern: /^\s*eslint-disable(?!-)\s*(.*)$/,
    isFileDirective: false,
  },
  {
    dialect: "oxlint",
    directive: "oxlint-disable-next-line",
    pattern: /^\s*oxlint-disable-next-line\s+(.+)$/,
    isFileDirective: false,
  },
  {
    dialect: "oxlint",
    directive: "oxlint-disable-line",
    pattern: /^\s*oxlint-disable-line\s+(.+)$/,
    isFileDirective: false,
  },
  {
    dialect: "oxlint",
    directive: "oxlint-disable",
    pattern: /^\s*oxlint-disable(?!-)\s*(.*)$/,
    isFileDirective: false,
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits the text after a directive into its rule ids and its reason. */
function splitReason(rest: string, separator: string): { ids: readonly string[]; reason: string } {
  const pattern = new RegExp(`\\s+${escapeRegExp(separator)}-*`);
  const match = pattern.exec(rest);
  const idsPart = match ? rest.slice(0, match.index) : rest;
  const reason = match ? rest.slice(match.index + match[0].length).trim() : "";
  return { ids: idsPart.split(ID_SEPARATOR).filter((id) => id.length > 0), reason };
}

/** True when the text is a known dialect name. */
function isSuppressionDialect(value: string): value is SuppressionDialect {
  return (SUPPRESSION_DIALECTS as readonly string[]).includes(value);
}

/** The dialects the rule checks: an explicit option narrows them, else the host default, else the Deno dialect. */
export function resolveDialects(
  option: JsonValue | undefined,
  host: readonly SuppressionDialect[] | undefined,
): readonly SuppressionDialect[] {
  if (Array.isArray(option)) {
    const found = option.map(String).filter(isSuppressionDialect);
    if (found.length > 0) return found;
  }
  return host ?? ["deno"];
}

/** Returns the directive in a comment's text, or null when the comment is not an ignore directive. */
export function parseIgnoreDirective(
  commentValue: string,
  separator: string,
  dialects: readonly SuppressionDialect[] = SUPPRESSION_DIALECTS,
): IIgnoreDirective | null {
  for (const entry of DIRECTIVES) {
    if (!dialects.includes(entry.dialect)) continue;
    const match = entry.pattern.exec(commentValue);
    if (!match) continue;
    const { ids, reason } = splitReason(match[1] ?? "", separator);
    return {
      dialect: entry.dialect,
      directive: entry.directive,
      isFileDirective: entry.isFileDirective,
      ids,
      reason,
    };
  }
  return null;
}
