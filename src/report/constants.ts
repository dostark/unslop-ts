/**
 * @module HealthConstants
 * @path src/report/constants.ts
 * @description Named defaults of the health command surface.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/cli/commands/health.ts, src/report/health.ts]
 */

import type { IChildLimits } from "./bounded_io.ts";

/** The number of findings the text and JSON views display by default. */
export const DEFAULT_HEALTH_TOP = 20;

/** The classes the text view lists in its class design section. */
export const DEFAULT_HEALTH_TOP_CLASSES = 10;

/** The sort key the report applies by default. */
export const DEFAULT_HEALTH_SORT = "cyclomatic";

/** The output format the command writes by default. */
export const DEFAULT_HEALTH_FORMAT = "text";

/** The CRAP limit the report applies by default. */
export const DEFAULT_MAX_CRAP = 30;

/** The default history window in days. */
export const DEFAULT_SINCE_DAYS = 180;

/** The default number of commits a file needs to qualify as a hotspot. */
export const DEFAULT_MIN_COMMITS = 3;

/** The churn half-life in days. */
export const CHURN_HALF_LIFE_DAYS = 90;

/** The number of seconds in one day. */
export const SECONDS_PER_DAY = 86400;

/** The largest accepted Git history output. */
export const MAX_GIT_HISTORY_BYTES = 64 * 1024 * 1024;

/** The largest retained Git stderr. */
export const MAX_GIT_STDERR_BYTES = 8 * 1024;

/** The largest stderr a child may print before it is stopped. */
const MAX_CHILD_STDERR_BYTES = 256 * 1024;

/** The largest stdout of a preliminary Git call such as `rev-parse`. */
export const MAX_GIT_PROBE_BYTES = 4 * 1024;

/** The largest stdout of the local duplication runner. */
const MAX_RUNNER_STDOUT_BYTES = 4 * 1024 * 1024;

/** The largest jscpd report read back from the runner output directory. */
export const MAX_JSCPD_REPORT_BYTES = 256 * 1024 * 1024;

/** The Git child deadline in milliseconds. */
const GIT_DEADLINE_MS = 120 * 1000;

/** The structural fan-in above which a file reads as highly coupled. */
export const COUPLING_FAN_IN_LIMIT = 20;

/** The structural fan-out above which a file reads as highly coupled. */
export const COUPLING_FAN_OUT_LIMIT = 15;

/** The path patterns the manifest and export scans never enter. */
export const HEALTH_WALK_SKIP_PATTERNS: readonly string[] = [
  "/node_modules(/|$)",
  "/\\.git(/|$)",
  "/dist(/|$)",
  "/tests_node(/|$)",
];

/** The limits every Git child runs under. */
export const GIT_LIMITS: IChildLimits = {
  deadlineMs: GIT_DEADLINE_MS,
  maxStdoutBytes: MAX_GIT_HISTORY_BYTES,
  maxStderrBytes: MAX_CHILD_STDERR_BYTES,
};

/** The limits the local duplication runner runs under. */
export const RUNNER_LIMITS: IChildLimits = {
  deadlineMs: 120 * 1000,
  maxStdoutBytes: MAX_RUNNER_STDOUT_BYTES,
  maxStderrBytes: MAX_CHILD_STDERR_BYTES,
};
