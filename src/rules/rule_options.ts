/**
 * @module RuleOptions
 * @path packages/lint-rules/src/rules/rule_options.ts
 * @description Per-rule option schemas and defaults, used to validate catalog options.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [packages/lint-rules/src/engine/catalog.ts]
 */

import { z } from "zod";

const NoChainedTypeAssertionsOptions = z.object({
  allowPartialMockInTests: z.boolean().default(true),
  allowNeverAnyMockInTests: z.boolean().default(true),
}).strict();

const NoExplicitUnknownOptions = z.object({
  allowCatchBinding: z.boolean().default(true),
  allowTypePredicateSubject: z.boolean().default(true),
}).strict();

const NoUnsafeDictionaryOptions = z.object({
  forbiddenValueTypes: z.array(z.string()).default(["unknown", "any", "object", "{}"]),
}).strict();

const NoAnyEscapeOptions = z.object({
  allowedTypeofTargets: z.array(z.string()).default(["globalThis.fetch"]),
  allowAnyInTests: z.boolean().default(true),
}).strict();

const NoOptions = z.object({}).strict();

const RequireSafetyCommentOptions = z.object({
  markers: z.array(z.string()).default(["SAFETY"]),
}).strict();

const NoRuntimeTypeofOptions = z.object({
  allowInTypeGuards: z.boolean().default(true),
}).strict();

const NoBooleanAssertOptions = z.object({
  methods: z.array(z.string()).default(["includes", "startsWith", "endsWith"]),
  assertFunctions: z.array(z.string()).default(["assert", "assertEquals", "assertStrictEquals"]),
}).strict();

const NoRepeatedAssertCallOptions = z.object({
  assertPrefix: z.string().default("assert"),
}).strict();

const NoConstantSubstringAssertOptions = z.object({
  constantPattern: z.string().default("^[A-Z][A-Z0-9_]*$"),
}).strict();

const MaxCyclomaticComplexityOptions = z.object({
  max: z.number().int().positive().default(15),
}).strict();

const MaxClassSizeOptions = z.object({
  minClassLines: z.number().int().positive().default(200),
  threshold: z.number().nonnegative().default(60),
}).strict();

const RequireOptionalWrapperOptions = z.object({
  wrapperType: z.string().default("Opt"),
}).strict();

const IgnoreNeedsReasonOptions = z.object({
  separator: z.string().default("--"),
}).strict();

/** Option schemas of the TypeScript rule pack, keyed by bare rule key. */
export const TYPESCRIPT_OPTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "no-chained-type-assertions": NoChainedTypeAssertionsOptions,
  "no-explicit-unknown": NoExplicitUnknownOptions,
  "no-unsafe-dictionary": NoUnsafeDictionaryOptions,
  "no-any-escape": NoAnyEscapeOptions,
  "no-pass-through-type-alias": NoOptions,
  "no-object-parameters": NoOptions,
  "require-safety-comment": RequireSafetyCommentOptions,
  "no-runtime-typeof": NoRuntimeTypeofOptions,
  "no-conditional-empty-object-spread": NoOptions,
  "no-boolean-assert": NoBooleanAssertOptions,
  "no-repeated-assert-call": NoRepeatedAssertCallOptions,
  "no-constant-substring-assert": NoConstantSubstringAssertOptions,
  "max-cyclomatic-complexity": MaxCyclomaticComplexityOptions,
  "max-class-size": MaxClassSizeOptions,
  "require-optional-wrapper": RequireOptionalWrapperOptions,
  "ignore-needs-reason": IgnoreNeedsReasonOptions,
};
