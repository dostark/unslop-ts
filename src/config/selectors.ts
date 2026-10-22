/**
 * @module ConfigSelectors
 * @path src/config/selectors.ts
 * @description Pure selector resolution over resolved rule ids and tags, shared by the compiler and the CLI.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/config/compile.ts, src/cli/selection.ts, src/cli/rules_read.ts]
 */

/** A selector that names no rule, an ambiguous bare key, or no known tag. */
export class SelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectorError";
  }
}

/** The rule ids and the tags any of them carry. */
export interface ISelectorSource {
  readonly ids: readonly string[];
  readonly tags: readonly string[];
}

/** The ids and tags a selector set matches. */
export interface IResolvedSelector {
  readonly ids: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

const TAG_PREFIX = "tag:";
const SEPARATOR = "/";

/** The bare key of a rule id: the part after the last `/`. */
export function ruleKey(id: string): string {
  const separator = id.lastIndexOf(SEPARATOR);
  return separator === -1 ? id : id.slice(separator + 1);
}

/** Builds the selector source from the resolved rules. */
export function selectorSource(
  rules: Readonly<Record<string, { readonly tags: readonly string[] }>>,
): ISelectorSource {
  const tags = new Set<string>();
  for (const rule of Object.values(rules)) {
    for (const tag of rule.tags) tags.add(tag);
  }
  return { ids: Object.keys(rules), tags: [...tags] };
}

/** Resolves a full id or an unambiguous bare key to a rule id. */
export function resolveRuleId(ids: readonly string[], token: string): string {
  if (ids.includes(token)) return token;
  if (token.includes(SEPARATOR)) throw new SelectorError(`unknown rule id '${token}'`);
  const matches = ids.filter((id) => ruleKey(id) === token);
  if (matches.length === 0) throw new SelectorError(`unknown rule '${token}'`);
  if (matches.length > 1) {
    throw new SelectorError(`ambiguous rule key '${token}': ${matches.sort().join(", ")}`);
  }
  return matches[0];
}

/** Resolves comma-separated full ids, bare keys, and `tag:<tag>` tokens. */
export function resolveSelectorTokens(source: ISelectorSource, tokens: string): IResolvedSelector {
  const ids = new Set<string>();
  const tags = new Set<string>();
  for (const raw of tokens.split(",")) {
    const token = raw.trim();
    if (token === "") continue;
    if (token.startsWith(TAG_PREFIX)) {
      const tag = token.slice(TAG_PREFIX.length);
      if (!source.tags.includes(tag)) throw new SelectorError(`unknown tag '${tag}'`);
      tags.add(tag);
      continue;
    }
    ids.add(resolveRuleId(source.ids, token));
  }
  return { ids, tags };
}
