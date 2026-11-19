/**
 * @module ImportCycles
 * @path src/rules/whole_tree/import_cycles.ts
 * @description Tarjan SCCs over the runtime projection, the structural coupling signal, and the full cycle report.
 * @architectural-layer Rules
 * @dependencies []
 * @related-files [src/report/graph.ts, src/report/health.ts, src/rules/whole_tree/duplicate_baseline.ts]
 */

import { COUPLING_FAN_IN_LIMIT, COUPLING_FAN_OUT_LIMIT } from "../../report/constants.ts";
import { fnv1a64 } from "./duplicate_baseline.ts";

/** The prefix of a stable cycle id. */
const CYCLE_ID_PREFIX = "cyc-";

/** The hash characters a cycle id keeps. */
const CYCLE_ID_HASH_LENGTH = 16;

/** The separator of the member paths that the cycle id hashes. */
const CYCLE_ID_SEPARATOR = "\n";

/** The dependency kind of an edge. */
export type TEdgeKind = "runtime" | "type";

/** One dependency edge, as the graph exposes it. */
export interface ICycleEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: TEdgeKind;
  /** Absent on callers that only count cycles. */
  readonly form?: TEdgeForm;
}

/** How the edge was declared. */
export type TEdgeForm = "side-effect" | "import" | "re-export" | "dynamic";

/** The runtime behavior of one cycle. */
export type TCycleKind = "runtime" | "type-only" | "mixed";

/** One dependency edge inside a cycle. */
export interface ICycleEdgeRef {
  readonly from: string;
  readonly to: string;
  readonly kind: TEdgeKind;
  readonly form: TEdgeForm;
}

/** One strongly connected component with at least the configured minimum files. */
export interface ICycleFinding {
  /** Stable hash of the sorted member paths; independent of line numbers and edge order. */
  readonly id: string;
  readonly kind: TCycleKind;
  /** Sorted repo-relative POSIX paths. */
  readonly files: readonly string[];
  /** Sorted internal edges whose endpoints are both in `files`. */
  readonly edges: readonly ICycleEdgeRef[];
  /** One shortest cycle path, starting and ending at the same file. */
  readonly path: readonly string[];
  /** True when `path` hit the node cap; `files` is never truncated. */
  readonly path_truncated: boolean;
  readonly size: number;
  readonly edge_count: number;
}

/** An unresolved import reference the graph could not turn into an edge. */
export interface IUnresolvedRef {
  readonly from: string;
  readonly specifier: string;
}

/** One source file that failed to parse, so its edges are missing from the graph. */
export interface ICycleParseError {
  readonly path: string;
  readonly message: string;
}

/** The evidence the analysis reports about its own graph. */
export interface ICycleGraphInfo {
  readonly complete: boolean;
  readonly code_files: number;
  readonly unresolved: number;
  readonly unresolved_refs: readonly IUnresolvedRef[];
  /** The first `MAX_REPORTED_PARSE_ERRORS` files that failed to parse. */
  readonly parse_errors: readonly ICycleParseError[];
  readonly parse_error_count: number;
  readonly nonliteral_dynamic: number;
}

/** The options of one analysis. */
export interface ICycleOptions {
  /** The smallest SCC that counts as a cycle. A self-import bypasses it under `includeSelf`. */
  readonly minFiles: number;
  /** Report a one-file self-import. */
  readonly includeSelf: boolean;
  /** Report type-only and mixed cycles as well as runtime cycles. */
  readonly includeTypeOnly: boolean;
}

/** The complete cycle analysis of one graph. */
export interface ICycleAnalysis {
  readonly cycles: readonly ICycleFinding[];
  readonly totals: {
    readonly runtime_sccs: number;
    readonly type_only_sccs: number;
    readonly mixed_sccs: number;
    readonly files: number;
    readonly edges: number;
    readonly largest_files: number;
  };
  readonly graph: {
    readonly complete: boolean;
    readonly code_files: number;
    readonly runtime_edges: number;
    readonly type_edges: number;
    readonly unresolved: number;
    readonly unresolved_refs: readonly IUnresolvedRef[];
    readonly parse_errors: readonly ICycleParseError[];
    readonly parse_error_count: number;
    readonly nonliteral_dynamic: number;
  };
}

/** The runtime cycles of one graph. */
export interface ICycleSignal {
  readonly sccs: number;
  readonly files: number;
}

/** The structural coupling signal of one graph. */
export interface ICouplingSignal {
  readonly high_files: number;
  readonly code_files: number;
  readonly percent: number;
  readonly fan_in_limit: number;
  readonly fan_out_limit: number;
}

/** The smallest SCC that counts as a cycle, unless `includeSelf` makes a self-import one. */
export const DEFAULT_MIN_CYCLE_FILES = 2;

/** The node cap of a stored canonical path. The member list is never capped. */
const DEFAULT_MAX_PATH_NODES = 64;

/** The parse failures the graph block lists, so a broken tree cannot grow the report. */
export const MAX_REPORTED_PARSE_ERRORS = 20;

/** One adjacency built from an edge selection. */
interface IAdjacency {
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  readonly nodes: readonly string[];
}

/** The runtime adjacency and the node set, without self edges or duplicate targets. */
function buildAdjacency(edges: readonly ICycleEdge[]): IAdjacency {
  return adjacencyOf(edges.filter((edge) => edge.kind === "runtime"), false);
}

/** The union, runtime, or type adjacency; target lists are sorted and unique. */
function adjacencyOf(edges: readonly ICycleEdge[], includeSelf: boolean): IAdjacency {
  const targets = new Map<string, Set<string>>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    if (!includeSelf && edge.from === edge.to) continue;
    const set = targets.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    targets.set(edge.from, set);
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  const adjacency = new Map<string, string[]>();
  for (const [from, set] of targets) adjacency.set(from, [...set].sort());
  return { adjacency, nodes: [...nodes].sort() };
}

/** Every strongly connected component, as sorted member lists. */
function stronglyConnectedComponents(input: IAdjacency): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const work: { node: string; next: number }[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  const push = (node: string): void => {
    index.set(node, nextIndex);
    low.set(node, nextIndex);
    nextIndex++;
    stack.push(node);
    onStack.add(node);
    work.push({ node, next: 0 });
  };

  const close = (root: string): void => {
    const component: string[] = [];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      onStack.delete(node);
      component.push(node);
      if (node === root) break;
    }
    components.push(component.sort());
  };

  for (const root of input.nodes) {
    if (index.has(root)) continue;
    push(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const targets = input.adjacency.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next];
        frame.next++;
        if (!index.has(target)) push(target);
        else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(target) ?? 0));
        }
        continue;
      }
      work.pop();
      if ((low.get(frame.node) ?? 0) === (index.get(frame.node) ?? 0)) close(frame.node);
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      }
    }
  }
  return components;
}

/** The nodes reachable from `start` inside `allowed`, following `neighbours`. */
function reachableFrom(
  start: string,
  allowed: ReadonlySet<string>,
  neighbours: (node: string) => readonly string[],
): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    for (const target of neighbours(node)) {
      if (!allowed.has(target) || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

/** True when the induced subgraph over `members` is one strongly connected component. */
function isStronglyConnected(members: readonly string[], input: IAdjacency): boolean {
  if (members.length === 1) return (input.adjacency.get(members[0]) ?? []).includes(members[0]);
  const allowed = new Set(members);
  const forward = reachableFrom(members[0], allowed, (node) => input.adjacency.get(node) ?? []);
  if (forward.size !== members.length) return false;
  const reverse = new Map<string, string[]>();
  for (const [from, targets] of input.adjacency) {
    for (const target of targets) {
      const sources = reverse.get(target) ?? [];
      sources.push(from);
      reverse.set(target, sources);
    }
  }
  const backward = reachableFrom(members[0], allowed, (node) => reverse.get(node) ?? []);
  return backward.size === members.length;
}

/** The kind of one union SCC, from its runtime and type projections. */
function kindOf(members: readonly string[], runtime: IAdjacency, types: IAdjacency): TCycleKind {
  if (isStronglyConnected(members, runtime)) return "runtime";
  if (isStronglyConnected(members, types)) return "type-only";
  return "mixed";
}

/** The lexicographically smallest shortest path from `from` to `to` inside `allowed`, or null. */
function shortestPath(
  from: string,
  to: string,
  input: IAdjacency,
  allowed: ReadonlySet<string>,
): string[] | null {
  const previous = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    for (const target of input.adjacency.get(node) ?? []) {
      if (target !== to && !allowed.has(target)) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      previous.set(target, node);
      if (target === to) {
        const path = [to];
        let cursor = node;
        while (cursor !== from) {
          path.unshift(cursor);
          cursor = previous.get(cursor) as string;
        }
        path.unshift(from);
        return path;
      }
      queue.push(target);
    }
  }
  return null;
}

/** One canonical shortest cycle through `root`, capped at `maxNodes`. */
function canonicalCycle(
  root: string,
  members: readonly string[],
  input: IAdjacency,
  maxNodes: number,
): { path: string[]; truncated: boolean } {
  if (members.length === 1) return { path: [root, root], truncated: false };
  const allowed = new Set(members.filter((member) => member !== root));
  let best: string[] | null = null;
  for (const neighbour of input.adjacency.get(root) ?? []) {
    if (!allowed.has(neighbour)) continue;
    const tail = shortestPath(neighbour, root, input, allowed);
    if (tail === null) continue;
    const candidate = [root, ...tail];
    if (best === null || shorterOrLexicographicallySmaller(candidate, best)) best = candidate;
  }
  const path = best ?? [root];
  return path.length > maxNodes ? { path: path.slice(0, maxNodes), truncated: true } : { path, truncated: false };
}

/** True when `left` is shorter than `right`, or equal in length and lexicographically smaller. */
function shorterOrLexicographicallySmaller(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return left.length < right.length;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

/** The stable id of a member set: `cyc-` plus 16 hex characters of the synchronous hash. */
function stableCycleId(files: readonly string[]): string {
  const hash = fnv1a64([...files].sort().join(CYCLE_ID_SEPARATOR));
  return `${CYCLE_ID_PREFIX}${hash.slice(0, CYCLE_ID_HASH_LENGTH)}`;
}

/** The internal edges of one SCC, sorted and deduplicated. */
function internalEdges(members: readonly string[], edges: readonly ICycleEdge[]): ICycleEdgeRef[] {
  const allowed = new Set(members);
  const seen = new Set<string>();
  const refs: ICycleEdgeRef[] = [];
  for (const edge of edges) {
    if (!allowed.has(edge.from) || !allowed.has(edge.to) || edge.from === edge.to) continue;
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.form ?? "import"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ from: edge.from, to: edge.to, kind: edge.kind, form: edge.form ?? "import" });
  }
  return refs.sort((left, right) =>
    left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.kind.localeCompare(right.kind)
  );
}

/** The order of findings: runtime first, then size, then id. */
function compareFindings(left: ICycleFinding, right: ICycleFinding): number {
  const rank = (kind: TCycleKind): number => (kind === "runtime" ? 0 : kind === "mixed" ? 1 : 2);
  return rank(left.kind) - rank(right.kind) || right.size - left.size || left.id.localeCompare(right.id);
}

/** The complete cycle analysis of one graph. */
export function analyzeCycles(
  edges: readonly ICycleEdge[],
  graphInfo: ICycleGraphInfo,
  options: ICycleOptions,
): ICycleAnalysis {
  const union = adjacencyOf(edges, options.includeSelf);
  const runtime = adjacencyOf(edges.filter((edge) => edge.kind === "runtime"), options.includeSelf);
  const types = adjacencyOf(edges.filter((edge) => edge.kind === "type"), options.includeSelf);
  const findings: ICycleFinding[] = [];
  for (const members of stronglyConnectedComponents(union)) {
    const selfOnly = members.length === 1;
    if (selfOnly && !options.includeSelf) continue;
    if (!selfOnly && members.length < options.minFiles) continue;
    const kind = kindOf(members, runtime, types);
    if (kind !== "runtime" && !options.includeTypeOnly) continue;
    const refs = internalEdges(members, edges);
    const { path, truncated } = canonicalCycle(members[0], members, union, DEFAULT_MAX_PATH_NODES);
    findings.push({
      id: stableCycleId(members),
      kind,
      files: [...members],
      edges: refs,
      path,
      path_truncated: truncated,
      size: members.length,
      edge_count: refs.length,
    });
  }
  findings.sort(compareFindings);
  const runtimeFindings = findings.filter((finding) => finding.kind === "runtime");
  const runtimeEdgeKeys = new Set<string>();
  for (const finding of runtimeFindings) {
    for (const edge of finding.edges) {
      if (edge.kind === "runtime") runtimeEdgeKeys.add(`${edge.from}\u0000${edge.to}`);
    }
  }
  const edgeKeys = (kind: TEdgeKind): number =>
    new Set(edges.filter((edge) => edge.kind === kind).map((edge) => `${edge.from}\u0000${edge.to}`)).size;
  return {
    cycles: findings,
    totals: {
      runtime_sccs: runtimeFindings.length,
      type_only_sccs: findings.filter((finding) => finding.kind === "type-only").length,
      mixed_sccs: findings.filter((finding) => finding.kind === "mixed").length,
      files: runtimeFindings.reduce((total, finding) => total + finding.size, 0),
      edges: runtimeEdgeKeys.size,
      largest_files: runtimeFindings.reduce((largest, finding) => Math.max(largest, finding.size), 0),
    },
    graph: {
      complete: graphInfo.complete,
      code_files: graphInfo.code_files,
      runtime_edges: edgeKeys("runtime"),
      type_edges: edgeKeys("type"),
      unresolved: graphInfo.unresolved,
      unresolved_refs: graphInfo.unresolved_refs,
      parse_errors: graphInfo.parse_errors,
      parse_error_count: graphInfo.parse_error_count,
      nonliteral_dynamic: graphInfo.nonliteral_dynamic,
    },
  };
}

/** Counts the runtime SCCs of at least two files; self edges do not count. */
export function runtimeCyclesOf(edges: readonly ICycleEdge[]): ICycleSignal {
  let sccs = 0;
  let files = 0;
  for (const component of stronglyConnectedComponents(buildAdjacency(edges))) {
    if (component.length <= 1) continue;
    sccs++;
    files += component.length;
  }
  return { sccs, files };
}

/** Counts the files whose structural fan-in or fan-out crosses the coupling limits. */
export function couplingSignalOf(edges: readonly ICycleEdge[], codeFiles: number): ICouplingSignal {
  const fanIn = new Map<string, Set<string>>();
  const fanOut = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const ins = fanIn.get(edge.to) ?? new Set<string>();
    ins.add(edge.from);
    fanIn.set(edge.to, ins);
    const outs = fanOut.get(edge.from) ?? new Set<string>();
    outs.add(edge.to);
    fanOut.set(edge.from, outs);
  }
  const paths = new Set([...fanIn.keys(), ...fanOut.keys()]);
  let high = 0;
  for (const path of paths) {
    if ((fanIn.get(path)?.size ?? 0) > COUPLING_FAN_IN_LIMIT) high++;
    else if ((fanOut.get(path)?.size ?? 0) > COUPLING_FAN_OUT_LIMIT) high++;
  }
  return {
    high_files: high,
    code_files: codeFiles,
    percent: codeFiles === 0 ? 0 : (high / codeFiles) * 100,
    fan_in_limit: COUPLING_FAN_IN_LIMIT,
    fan_out_limit: COUPLING_FAN_OUT_LIMIT,
  };
}
