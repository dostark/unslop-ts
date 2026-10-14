/**
 * @module RuleOptions
 * @path packages/lint-rules/src/rules/rule_options.ts
 * @description Per-rule option schemas and defaults, used to validate catalog options.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [packages/lint-rules/src/engine/catalog.ts]
 */

import { z } from "zod";

export const NoChainedTypeAssertionsOptions = z.object({
  allowPartialMockInTests: z.boolean().default(true),
  allowNeverAnyMockInTests: z.boolean().default(true),
}).strict();

/** Implementation ids with a known option schema. A catalog id absent here is rejected. */
export const RULE_OPTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "exaix/no-chained-type-assertions": NoChainedTypeAssertionsOptions,
};
