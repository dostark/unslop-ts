/**
 * @module IgnoreDirective
 * @path packages/lint-rules/src/rules/deno/ignore_directive.ts
 * @description Parses the text of a `deno-lint-ignore` comment into its rule ids and its reason.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/deno/ignore_needs_reason.ts, packages/lint-rules/src/rules/deno/no_forbidden_lint_ignore.ts]
 */

/** The rule ids and the reason of one `deno-lint-ignore` or `deno-lint-ignore-file` comment. */
export interface IIgnoreDirective {
  readonly isFileDirective: boolean;
  readonly ids: readonly string[];
  /** The text after the separator, or an empty string when the comment has no reason. */
  readonly reason: string;
}

/** The separator Deno puts between the rule ids and the reason. */
export const DEFAULT_REASON_SEPARATOR = "--";

const DIRECTIVE_PATTERN = /^\s*deno-lint-ignore(-file)?\s+(.+)$/;
const ID_SEPARATOR = /[\s,]+/;

/** Returns the directive in a comment's text, or null when the comment is not an ignore directive. */
export function parseIgnoreDirective(commentValue: string, separator: string): IIgnoreDirective | null {
  const match = DIRECTIVE_PATTERN.exec(commentValue);
  if (!match) return null;
  const rest = match[2];
  const separatorIndex = rest.indexOf(separator);
  const idsPart = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
  const reason = separatorIndex === -1 ? "" : rest.slice(separatorIndex + separator.length).trim();
  return {
    isFileDirective: match[1] !== undefined,
    ids: idsPart.split(ID_SEPARATOR).filter((id) => id.length > 0),
    reason,
  };
}
