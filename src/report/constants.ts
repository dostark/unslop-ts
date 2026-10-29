/**
 * @module HealthConstants
 * @path src/report/constants.ts
 * @description Named defaults of the health command surface.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/cli/commands/health.ts, src/report/health.ts]
 */

/** The number of findings the text and JSON views display by default. */
export const DEFAULT_HEALTH_TOP = 20;

/** The sort key the report applies by default. */
export const DEFAULT_HEALTH_SORT = "cyclomatic";

/** The output format the command writes by default. */
export const DEFAULT_HEALTH_FORMAT = "text";
