/**
 * @module ImportBoundaries
 * @path src/rules/import_boundaries.ts
 * @description Reports an import that a boundary zone denies: files in a zone may not import a specifier or a resolved path.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/rules/rule_options.ts, src/engine/glob.ts]
 */

import { dirname, join, normalize } from "../engine/posix_path.ts";
import { matchesAnyGlob } from "../engine/glob.ts";
import { asNode, type ILintNode } from "../engine/type_environment.ts";
import { type BoundaryDeny, type BoundaryZone, ImportBoundariesOptions } from "./rule_options.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DEFAULT_GUIDE = "the import boundary rules";

/** The repository-relative path that a specifier names, or null for a URL or a scheme specifier. */
function resolveSpecifier(repoPath: string, specifier: string): string | null {
  if (SCHEME.test(specifier) || specifier.startsWith("//")) return null;
  if (specifier.startsWith(".")) return normalize(join(dirname(repoPath), specifier));
  return specifier;
}

function denies(entry: BoundaryDeny, specifier: string, resolved: string | null): boolean {
  if (entry.specifier !== undefined && !new RegExp(entry.specifier).test(specifier)) return false;
  if (entry.target !== undefined && (resolved === null || !matchesAnyGlob(resolved, entry.target))) return false;
  if (entry.outside !== undefined && (resolved === null || matchesAnyGlob(resolved, entry.outside))) return false;
  return true;
}

function fill(message: string, specifier: string, resolved: string | null): string {
  return message.replaceAll("{specifier}", specifier).replaceAll("{target}", resolved ?? specifier);
}

function sourceText(source: unknown): string | null {
  if (source === null || typeof source !== "object") return null;
  const value = asNode(source as ILintNode).value;
  return typeof value === "string" ? value : null;
}

export function createImportBoundaries(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const zones = ImportBoundariesOptions.parse(ctx.options).zones.filter((zone: BoundaryZone) =>
    matchesAnyGlob(ctx.repoPath, zone.files) && !matchesAnyGlob(ctx.repoPath, zone.except)
  );
  if (zones.length === 0) return {};
  const codeStyle = ctx.codeStyle ?? DEFAULT_GUIDE;
  const check = (node: IRuleNode, source: unknown): void => {
    const specifier = sourceText(source);
    if (specifier === null) return;
    const resolved = resolveSpecifier(ctx.repoPath, specifier);
    for (const zone of zones) {
      const entry = zone.deny.find((candidate: BoundaryDeny) => denies(candidate, specifier, resolved));
      if (!entry) continue;
      context.report({
        node,
        message: `Boundary '${zone.id}': ${fill(entry.message, specifier, resolved)}`,
        hint: `See ${codeStyle}.`,
      });
    }
  };
  return {
    ImportDeclaration(node: IRuleNode): void {
      check(node, asNode(node).source);
    },
    ExportNamedDeclaration(node: IRuleNode): void {
      const source = asNode(node).source;
      if (source) check(node, source);
    },
    ExportAllDeclaration(node: IRuleNode): void {
      check(node, asNode(node).source);
    },
  };
}
