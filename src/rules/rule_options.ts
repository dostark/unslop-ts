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

export const NoExplicitUnknownOptions = z.object({
  allowCatchBinding: z.boolean().default(true),
  allowTypePredicateSubject: z.boolean().default(true),
}).strict();

export const NoUnsafeDictionaryOptions = z.object({
  forbiddenValueTypes: z.array(z.string()).default(["unknown", "any", "object", "{}"]),
}).strict();

export const NoAnyEscapeOptions = z.object({
  allowedTypeofTargets: z.array(z.string()).default(["globalThis.fetch"]),
  allowAnyInTests: z.boolean().default(true),
}).strict();

export const NoOptions = z.object({}).strict();

export const RequireSafetyCommentOptions = z.object({
  markers: z.array(z.string()).default(["SAFETY"]),
}).strict();

export const NoRuntimeTypeofOptions = z.object({
  allowInTypeGuards: z.boolean().default(true),
}).strict();

export const NoBooleanAssertOptions = z.object({
  methods: z.array(z.string()).default(["includes", "startsWith", "endsWith"]),
  assertFunctions: z.array(z.string()).default(["assert", "assertEquals", "assertStrictEquals"]),
}).strict();

export const NoRepeatedAssertCallOptions = z.object({
  assertPrefix: z.string().default("assert"),
}).strict();

export const NoConstantSubstringAssertOptions = z.object({
  constantPattern: z.string().default("^[A-Z][A-Z0-9_]*$"),
}).strict();

export const MaxCyclomaticComplexityOptions = z.object({
  max: z.number().int().positive().default(15),
}).strict();

export const RequireOptionalWrapperOptions = z.object({
  wrapperType: z.string().default("Opt"),
}).strict();

export const IgnoreNeedsReasonOptions = z.object({
  separator: z.string().default("--"),
}).strict();

/** Implementation ids with a known option schema. A catalog id absent here is rejected. */
export const RULE_OPTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "exaix/no-chained-type-assertions": NoChainedTypeAssertionsOptions,
  "exaix/no-explicit-unknown": NoExplicitUnknownOptions,
  "exaix/no-unsafe-dictionary": NoUnsafeDictionaryOptions,
  "exaix/no-any-escape": NoAnyEscapeOptions,
  "exaix/no-pass-through-type-alias": NoOptions,
  "exaix/no-object-parameters": NoOptions,
  "exaix/require-safety-comment": RequireSafetyCommentOptions,
  "exaix/no-runtime-typeof": NoRuntimeTypeofOptions,
  "exaix/no-conditional-empty-object-spread": NoOptions,
  "exaix/no-boolean-assert": NoBooleanAssertOptions,
  "exaix/no-repeated-assert-call": NoRepeatedAssertCallOptions,
  "exaix/no-constant-substring-assert": NoConstantSubstringAssertOptions,
  "exaix/max-cyclomatic-complexity": MaxCyclomaticComplexityOptions,
  "exaix/require-optional-wrapper": RequireOptionalWrapperOptions,
  "exaix/ignore-needs-reason": IgnoreNeedsReasonOptions,
};
