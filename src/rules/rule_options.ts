/**
 * @module RuleOptions
 * @path src/rules/rule_options.ts
 * @description Per-rule option schemas and defaults, used to validate catalog options.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/engine/catalog.ts]
 */

import { z } from "zod";
import { compilesAsRegex, RegexFlagsSchema, RegexSourceSchema } from "../engine/regex_option.ts";
import { DEFAULT_REASON_SEPARATOR } from "./deno/ignore_directive.ts";
import { DEFAULT_FORBIDDEN_IGNORES } from "./deno/no_forbidden_lint_ignore.ts";
import { DEFAULT_DENO_SHEBANG } from "./deno/require_deno_shebang.ts";

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

const NoTypeofEscapeOptions = z.object({
  allowedTypeofTargets: z.array(z.string()).default(["globalThis.fetch"]),
}).strict();

const NoOptions = z.object({}).strict();

export const BarrelOnlyReExportsOptions = z.object({
  barrelSuffixes: z.array(z.string()).default(["/mod.ts", "/index.ts"]),
  allowPaths: z.array(z.string()).default([]),
}).strict();

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

const SuppressionDialects = z.array(z.enum(["deno", "eslint", "oxlint"]));

const IgnoreNeedsReasonOptions = z.object({
  separator: z.string().default(DEFAULT_REASON_SEPARATOR),
  dialects: SuppressionDialects.optional(),
}).strict();

const NoForbiddenLintIgnoreOptions = z.object({
  forbiddenRules: z.array(z.string()).default([...DEFAULT_FORBIDDEN_IGNORES]),
  includeFileIgnores: z.boolean().default(true),
  dialects: SuppressionDialects.optional(),
}).strict();

const RequireDenoShebangOptions = z.object({
  shebang: z.string().default(DEFAULT_DENO_SHEBANG),
}).strict();

const DynamicAllowance = z.object({
  files: z.array(z.string()).min(1),
  specifiers: z.array(RegexSourceSchema).default([]),
}).strict();

const ImportCallOptions = z.object({
  allowDynamicImports: z.array(DynamicAllowance).default([]),
}).strict();

const MagicUnionTypeOptions = z.object({
  hint: z.string().default("Define a named type alias or an enum."),
}).strict();

const LongCommentOptions = z.object({
  maxLines: z.number().int().positive().default(3),
}).strict();

const EphemeralPhrase = z.object({
  pattern: RegexSourceSchema,
  flags: RegexFlagsSchema.default("i"),
  hint: z.string(),
}).strict().refine((phrase) => compilesAsRegex(phrase.pattern, phrase.flags), {
  message: "does not compile with its flags",
  path: ["pattern"],
});

const DEFAULT_EPHEMERAL_PHRASES = [
  { pattern: "\\btried\\b", flags: "i", hint: "a narration of a prior attempt" },
  { pattern: "\\b(?:didn't|did not)\\s+work\\b", flags: "i", hint: "what didn't work" },
];

const EphemeralCommentOptions = z.object({
  phrases: z.array(EphemeralPhrase).default(DEFAULT_EPHEMERAL_PHRASES),
  checkDates: z.boolean().default(true),
}).strict();

const MaxParamsOptions = z.object({
  max: z.number().int().positive().default(7),
}).strict();

const TestInlineFixtureOptions = z.object({
  minLines: z.number().int().positive().default(7),
  variableNames: z.array(z.string()).default(["markdown", "yaml", "json", "input", "payload", "text", "content"]),
  fixturesDirectory: z.string().default(""),
}).strict();

const RequireModuleHeaderOptions = z.object({
  maxStartLine: z.number().int().positive().default(5),
}).strict();

const EphemeralFilenameOptions = z.object({
  pattern: RegexSourceSchema.default("(?:^|[_.-])phase[-_]?(\\d+)(?:[_.-]|$)"),
  label: z.string().default("phase"),
}).strict();

const RequireScriptUsageOptions = z.object({
  marker: z.string().default("Usage:"),
  maxHeaderLines: z.number().int().positive().default(15),
}).strict();

const InterfacePrefixOptions = z.object({
  prefix: z.string().min(1).default("I"),
}).strict();

const BoundaryDenySchema = z.object({
  specifier: z.string().optional(),
  target: z.array(z.string()).min(1).optional(),
  outside: z.array(z.string()).min(1).optional(),
  message: z.string(),
}).strict();

const BoundaryZoneSchema = z.object({
  id: z.string().min(1),
  files: z.array(z.string()).min(1),
  except: z.array(z.string()).default([]),
  deny: z.array(BoundaryDenySchema).min(1),
}).strict();

function describeEntry(zoneId: string, index: number): string {
  return `zone '${zoneId}' deny entry ${index + 1}`;
}

/** Options of the import-boundaries rule: the zones, each with the imports that its files may not make. */
export const ImportBoundariesOptions = z.object({
  zones: z.array(BoundaryZoneSchema).default([]),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  for (const zone of value.zones) {
    if (seen.has(zone.id)) context.addIssue({ code: "custom", message: `zone '${zone.id}' is defined twice` });
    seen.add(zone.id);
    zone.deny.forEach((entry, index) => {
      if (entry.specifier === undefined && entry.target === undefined && entry.outside === undefined) {
        context.addIssue({
          code: "custom",
          message: `${describeEntry(zone.id, index)} needs a specifier, a target, or an outside condition`,
        });
      }
      if (entry.specifier === undefined) return;
      try {
        new RegExp(entry.specifier);
      } catch {
        context.addIssue({
          code: "custom",
          message: `${describeEntry(zone.id, index)} has a specifier that is not a valid regular expression`,
        });
      }
    });
  }
});

export type BoundaryZone = z.infer<typeof BoundaryZoneSchema>;
export type BoundaryDeny = z.infer<typeof BoundaryDenySchema>;

/** Option schemas of the TypeScript rule pack, keyed by bare rule key. */
export const TYPESCRIPT_OPTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "barrel-only-reexports": BarrelOnlyReExportsOptions,
  "no-chained-type-assertions": NoChainedTypeAssertionsOptions,
  "no-explicit-unknown": NoExplicitUnknownOptions,
  "no-unsafe-dictionary": NoUnsafeDictionaryOptions,
  "no-typeof-escape": NoTypeofEscapeOptions,
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
  "import-inside-statement": ImportCallOptions,
  "dynamic-import": ImportCallOptions,
  "inline-type-import": NoOptions,
  "re-export-imported": NoOptions,
  "import-placement": NoOptions,
  "prefer-named-imports": NoOptions,
  "exported-interface-placement": NoOptions,
  "promise-response-alias": NoOptions,
  "promise-response-return": NoOptions,
  "ts-suppression-pragmas": NoOptions,
  "magic-union-type": MagicUnionTypeOptions,
  "long-comment": LongCommentOptions,
  "ephemeral-comment": EphemeralCommentOptions,
  "decorative-comment": NoOptions,
  "max-params": MaxParamsOptions,
  "test-inline-multiline-fixture": TestInlineFixtureOptions,
  "require-module-header": RequireModuleHeaderOptions,
  "ephemeral-filename": EphemeralFilenameOptions,
  "exported-interface-naming": InterfacePrefixOptions,
  "no-interface-rename-on-import": InterfacePrefixOptions,
  "import-boundaries": ImportBoundariesOptions,
};

/** Option schemas of the Deno rule pack, keyed by bare rule key. */
export const DENO_OPTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "ignore-needs-reason": IgnoreNeedsReasonOptions,
  "no-forbidden-lint-ignore": NoForbiddenLintIgnoreOptions,
  "require-deno-shebang": RequireDenoShebangOptions,
  "require-script-usage": RequireScriptUsageOptions,
};
