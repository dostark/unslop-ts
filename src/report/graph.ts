/**
 * @module HealthGraph
 * @path src/report/graph.ts
 * @description Structural and runtime dependency projections of the parsed health snapshot.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/parse.ts, src/report/health.ts, src/engine/posix_path.ts]
 */

import { asNode, type ILintNode, isNodeLike } from "../engine/type_environment.ts";
import { dirname, normalize } from "../engine/posix_path.ts";
import { forEachChildNode } from "../metrics/estree.ts";
import { AMBIGUOUS_ALIAS } from "./aliases.ts";
import type { IParsedHealthFile } from "./parse.ts";

/** One dependency edge between two measured files. */
export interface IGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "runtime" | "type";
  readonly form: "side-effect" | "import" | "re-export" | "dynamic";
}

/** The specifiers the graph could not turn into internal edges. */
export interface IGraphLimitations {
  readonly external: number;
  readonly excluded_source: number;
  readonly resources: number;
  readonly unresolved: number;
  readonly nonliteral_dynamic: number;
}

/** The projection of one snapshot: edges, fan counts and the limits of the evidence. */
export interface IHealthGraph {
  readonly edges: readonly IGraphEdge[];
  readonly fanIn: ReadonlyMap<string, number>;
  readonly fanOut: ReadonlyMap<string, number>;
  readonly limitations: IGraphLimitations;
  /** False when a limitation means the structural population is incomplete. */
  readonly complete: boolean;
}

/** The specifier prefixes that always point outside the measured snapshot. */
const EXTERNAL_PREFIXES: readonly string[] = [
  "node:",
  "jsr:",
  "npm:",
  "http:",
  "https:",
  "data:",
  "bun:",
  "deno:",
];

/** The extensions the resolver appends when a specifier omits one. */
const EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The file names a directory specifier resolves to. */
const INDEX_FILES: readonly string[] = EXTENSIONS.map((extension) => `index${extension}`);

/** The string value of a literal node, or null. */
function literalText(value: unknown): string | null {
  if (!isNodeLike(value)) return null;
  const node = asNode(value);
  if ((node.type === "StringLiteral" || node.type === "Literal") && typeof node.value === "string") return node.value;
  return null;
}

/** True when the import or export is declared as type-only. */
function isTypeOnly(node: ILintNode, specifierCount: number): boolean {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  if (specifierCount === 0) return false;
  const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
  return specifiers.length > 0 &&
    specifiers.every((specifier) => {
      if (!isNodeLike(specifier)) return false;
      const entry = asNode(specifier);
      return entry.importKind === "type" || entry.exportKind === "type";
    });
}

/** The alias entry an import map picks for a specifier: the exact key, else the longest directory prefix. */
function aliasEntryOf(
  specifier: string,
  aliases: Readonly<Record<string, string>>,
): { readonly target: string; readonly suffix: string } | null {
  if (Object.hasOwn(aliases, specifier)) return { target: aliases[specifier], suffix: "" };
  let best: string | null = null;
  for (const key of Object.keys(aliases)) {
    if (!key.endsWith("/") || !specifier.startsWith(key) || specifier === key) continue;
    if (best === null || key.length > best.length) best = key;
  }
  return best === null ? null : { target: aliases[best], suffix: specifier.slice(best.length) };
}

/** The internal file a specifier names, or null when it does not resolve inside the snapshot. */
export function resolveSpecifier(
  specifier: string,
  fromPath: string,
  known: ReadonlySet<string>,
  aliases: Readonly<Record<string, string>>,
): string | null {
  if (specifier.startsWith(".")) {
    return probe(normalize(`${dirname(fromPath)}/${specifier}`), known);
  }
  const entry = aliasEntryOf(specifier, aliases);
  if (entry === null || entry.target === AMBIGUOUS_ALIAS) return null;
  const base = entry.target.replace(/^\.\//, "").replace(/\/$/, "");
  return probe(normalize(entry.suffix === "" ? base : `${base}/${entry.suffix}`), known);
}

/** Probes a base path for an exact file or a supported extension. */
function probe(base: string, known: ReadonlySet<string>): string | null {
  if (known.has(base)) return base;
  for (const extension of EXTENSIONS) {
    if (known.has(`${base}${extension}`)) return `${base}${extension}`;
  }
  for (const index of INDEX_FILES) {
    if (known.has(`${base}/${index}`)) return `${base}/${index}`;
  }
  return null;
}

/** One specifier the file declares, before resolution. */
interface ISpecifier {
  readonly text: string;
  readonly kind: "runtime" | "type";
  readonly form: IGraphEdge["form"];
}

/** Records one specifier, counting its limitation class when it cannot become an internal edge. */
function classifySpecifier(
  specifier: string,
  fromPath: string,
  known: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  resources: ReadonlySet<string>,
  aliases: Readonly<Record<string, string>>,
  limitations: { external: number; excluded_source: number; resources: number; unresolved: number },
): string | null {
  if (EXTERNAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
    limitations.external++;
    return null;
  }
  const target = resolveSpecifier(specifier, fromPath, known, aliases);
  if (target === null) {
    if (resolveSpecifier(specifier, fromPath, resources, aliases) !== null) {
      limitations.resources++;
      return null;
    }
    if (resolveSpecifier(specifier, fromPath, excluded, aliases) !== null) {
      limitations.excluded_source++;
      return null;
    }
    if (specifier.startsWith(".") || aliasEntryOf(specifier, aliases) !== null) {
      limitations.unresolved++;
    } else {
      limitations.external++;
    }
    return null;
  }
  return target === fromPath ? null : target;
}

/** The specifiers one file declares for the structural projection. */
function specifiersOf(program: ILintNode, limitations: { nonliteral_dynamic: number }): ISpecifier[] {
  const found: ISpecifier[] = [];
  for (const statement of Array.isArray(program.body) ? program.body : []) {
    if (!isNodeLike(statement)) continue;
    const node = asNode(statement);
    if (node.type === "ImportDeclaration") {
      const text = literalText(node.source);
      if (text === null) continue;
      const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
      const sideEffect = specifiers.length === 0;
      found.push({
        text,
        kind: isTypeOnly(node, specifiers.length) ? "type" : "runtime",
        form: sideEffect ? "side-effect" : "import",
      });
      continue;
    }
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      const text = literalText(node.source);
      if (text === null) continue;
      found.push({ text, kind: isTypeOnly(node, 1) ? "type" : "runtime", form: "re-export" });
    }
  }
  const visit = (node: ILintNode): void => {
    const dynamic = dynamicSourceOf(node);
    if (dynamic !== null) {
      if (dynamic.text === null) limitations.nonliteral_dynamic++;
      else found.push({ text: dynamic.text, kind: "runtime", form: "dynamic" });
    }
    forEachChildNode(node, visit);
  };
  visit(program);
  return found;
}

/** The source of one dynamic import node, or null when the node is not a dynamic import. */
function dynamicSourceOf(node: ILintNode): { readonly text: string | null } | null {
  if (node.type === "ImportExpression") {
    return { text: literalText(node.source) };
  }
  if (node.type !== "CallExpression" || !isNodeLike(node.callee)) return null;
  if (asNode(node.callee).type !== "Import") return null;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  return { text: literalText(args[0]) };
}

/** Builds the structural and runtime projections of one parsed snapshot. */
export function buildHealthGraph(
  files: ReadonlyMap<string, IParsedHealthFile>,
  aliases: Readonly<Record<string, string>> = {},
  excluded: ReadonlySet<string> = new Set(),
  resources: ReadonlySet<string> = new Set(),
): IHealthGraph {
  const known = new Set(files.keys());
  const limitations = { external: 0, excluded_source: 0, resources: 0, unresolved: 0, nonliteral_dynamic: 0 };
  const edges: IGraphEdge[] = [];
  for (const [path, file] of files) {
    const specifiers = specifiersOf(asNode(file.tree.program), limitations);
    for (const { text, kind, form } of specifiers) {
      const target = classifySpecifier(text, path, known, excluded, resources, aliases, limitations);
      if (target !== null) edges.push({ from: path, to: target, kind, form });
    }
  }
  const fanOut = new Map<string, Set<string>>();
  const fanIn = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!fanOut.has(edge.from)) fanOut.set(edge.from, new Set());
    fanOut.get(edge.from)?.add(edge.to);
    if (!fanIn.has(edge.to)) fanIn.set(edge.to, new Set());
    fanIn.get(edge.to)?.add(edge.from);
  }
  const limitationsOut: IGraphLimitations = {
    external: limitations.external,
    excluded_source: limitations.excluded_source,
    resources: limitations.resources,
    unresolved: limitations.unresolved,
    nonliteral_dynamic: limitations.nonliteral_dynamic,
  };
  return {
    edges,
    fanIn: new Map([...fanIn].map(([path, sources]) => [path, sources.size])),
    fanOut: new Map([...fanOut].map(([path, targets]) => [path, targets.size])),
    limitations: limitationsOut,
    complete: limitationsOut.unresolved === 0 && limitationsOut.nonliteral_dynamic === 0,
  };
}
