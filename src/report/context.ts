/**
 * @module ReportContext
 * @path src/report/context.ts
 * @description Internal private run context: compiled policy, selection, and captured policy bytes.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/report/collect.ts, src/cli/commands/report.ts]
 */

import type { IResolvedSelection } from "../config/selectors.ts";
import type { ICompiledConfig } from "../config/descriptor.ts";

/** One captured policy file. */
export interface IPolicySnapshot {
  readonly url: URL;
  readonly bytes: Uint8Array;
}

/** One captured source file. Step 3 fills this map. */
export interface ISourceSnapshot {
  readonly canonicalPath: string;
  readonly bytes: Uint8Array;
}

/** The private context shared by the runner and the pure collector. */
export interface IRunContext {
  readonly compiled: ICompiledConfig;
  readonly selection: IResolvedSelection | null;
  readonly policy: readonly IPolicySnapshot[];
  readonly sources: ReadonlyMap<string, ISourceSnapshot> | null;
}
