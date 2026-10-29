/**
 * @module ImportCycles
 * @path src/rules/whole_tree/import_cycles.ts
 * @description Tarjan SCCs over the runtime projection and the structural coupling signal.
 * @architectural-layer Rules
 * @dependencies []
 * @related-files [src/report/graph.ts, src/report/health.ts]
 */

import { COUPLING_FAN_IN_LIMIT, COUPLING_FAN_OUT_LIMIT } from "../../report/constants.ts";

/** One dependency edge, as the graph exposes it. */
export interface ICycleEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "runtime" | "type";
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

/** The iterative Tarjan state of one graph. */
interface ITarjanState {
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  readonly index: Map<string, number>;
  readonly low: Map<string, number>;
  readonly onStack: Set<string>;
  readonly stack: string[];
  readonly work: { node: string; next: number }[];
  nextIndex: number;
  sccs: number;
  files: number;
}

/** The runtime adjacency and the node set, without self edges or duplicate targets. */
function buildAdjacency(edges: readonly ICycleEdge[]): {
  adjacency: Map<string, string[]>;
  nodes: Set<string>;
} {
  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "runtime" || edge.from === edge.to) continue;
    const targets = adjacency.get(edge.from) ?? [];
    if (!targets.includes(edge.to)) targets.push(edge.to);
    adjacency.set(edge.from, targets);
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  return { adjacency, nodes };
}

/** Enters one node on the Tarjan stack. */
function pushNode(state: ITarjanState, node: string): void {
  state.index.set(node, state.nextIndex);
  state.low.set(node, state.nextIndex);
  state.nextIndex++;
  state.stack.push(node);
  state.onStack.add(node);
  state.work.push({ node, next: 0 });
}

/** Pops one completed component and counts it when it has more than one file. */
function popComponent(state: ITarjanState, root: string): void {
  const component: string[] = [];
  while (state.stack.length > 0) {
    const node = state.stack.pop() as string;
    state.onStack.delete(node);
    component.push(node);
    if (node === root) break;
  }
  if (component.length > 1) {
    state.sccs++;
    state.files += component.length;
  }
}

/** Advances the top frame by one edge or closes it. */
function advance(state: ITarjanState): void {
  const frame = state.work[state.work.length - 1];
  const targets = state.adjacency.get(frame.node) ?? [];
  if (frame.next < targets.length) {
    const target = targets[frame.next];
    frame.next++;
    if (!state.index.has(target)) pushNode(state, target);
    else if (state.onStack.has(target)) {
      state.low.set(frame.node, Math.min(state.low.get(frame.node) ?? 0, state.index.get(target) ?? 0));
    }
    return;
  }
  state.work.pop();
  if ((state.low.get(frame.node) ?? 0) === (state.index.get(frame.node) ?? 0)) {
    popComponent(state, frame.node);
  }
  const parent = state.work[state.work.length - 1];
  if (parent !== undefined) {
    state.low.set(parent.node, Math.min(state.low.get(parent.node) ?? 0, state.low.get(frame.node) ?? 0));
  }
}

/** Counts the runtime SCCs of at least two files; self edges do not count. */
export function runtimeCyclesOf(edges: readonly ICycleEdge[]): ICycleSignal {
  const { adjacency, nodes } = buildAdjacency(edges);
  const state: ITarjanState = {
    adjacency,
    index: new Map(),
    low: new Map(),
    onStack: new Set(),
    stack: [],
    work: [],
    nextIndex: 0,
    sccs: 0,
    files: 0,
  };
  for (const root of nodes) {
    if (state.index.has(root)) continue;
    pushNode(state, root);
    while (state.work.length > 0) advance(state);
  }
  return { sccs: state.sccs, files: state.files };
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
