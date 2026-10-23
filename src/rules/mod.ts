/**
 * @module PluginRules
 * @path src/rules/mod.ts
 * @description The TypeScript and Deno rule packs: the plugin rules the engine ships, keyed by bare rule key.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/registry.ts, src/rules/rule_options.ts, src/rules/meta.ts]
 */

import { createNoChainedTypeAssertions } from "./no_chained_type_assertions.ts";
import {
  createNoConditionalEmptyObjectSpread,
  createNoRuntimeTypeof,
  createRequireSafetyComment,
} from "./evidence_rules.ts";
import {
  createNoExplicitUnknown,
  createNoObjectParameters,
  createNoPassThroughTypeAlias,
  createNoTypeofEscape,
  createNoUnsafeDictionary,
} from "./type_safety_rules.ts";
import {
  createNoBooleanAssert,
  createNoConstantSubstringAssert,
  createNoRepeatedAssertCall,
} from "./test_assertion_rules.ts";
import { createMaxCyclomaticComplexity } from "./max_cyclomatic_complexity.ts";
import { createMaxClassSize } from "./max_class_size.ts";
import { createRequireOptionalWrapper } from "./require_optional_wrapper.ts";
import {
  createDynamicImport,
  createImportInsideStatement,
  createInlineTypeImport,
  createReExportImported,
} from "./import_rules.ts";
import { createExportedInterfacePlacement, createImportPlacement } from "./module_layout_rules.ts";
import {
  createMagicUnionType,
  createPromiseResponseAlias,
  createPromiseResponseReturn,
  createTsSuppressionPragmas,
} from "./type_pattern_rules.ts";
import { createIgnoreNeedsReason } from "./deno/ignore_needs_reason.ts";
import { createNoForbiddenLintIgnore } from "./deno/no_forbidden_lint_ignore.ts";
import { createRequireDenoShebang } from "./deno/require_deno_shebang.ts";
import { createRequireScriptUsage } from "./deno/require_script_usage.ts";
import { createDecorativeComment, createEphemeralComment, createLongComment } from "./comment_rules.ts";
import { createEphemeralFilename, createRequireModuleHeader } from "./header_rules.ts";
import { createMaxParams } from "./max_params.ts";
import { createImportBoundaries } from "./import_boundaries.ts";
import { createExportedInterfaceNaming, createNoInterfaceRenameOnImport } from "./interface_convention_rules.ts";
import { createTestInlineMultilineFixture } from "./test_fixture_rules.ts";
import type { IRulePack } from "../engine/registry.ts";
import { DENO_OPTION_SCHEMAS, TYPESCRIPT_OPTION_SCHEMAS } from "./rule_options.ts";

/** The generic TypeScript rule pack: every plugin rule the engine ships, keyed by bare rule key. */
export const TYPESCRIPT_RULE_PACK: IRulePack = {
  name: "typescript",
  rules: {
    "no-chained-type-assertions": {
      overlaps: [{ ecosystem: "typescript-eslint", rule: "no-unnecessary-type-assertion", kind: "related" }],
      requiresTestGlobs: true,
      meta: {
        description: "Two or more type assertions in one chain.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "recommended",
        limits: "Imported aliases are not resolved; only syntactic assertions in this file are seen.",
      },
      create: createNoChainedTypeAssertions,
    },
    "no-explicit-unknown": {
      overlaps: [{ ecosystem: "typescript-eslint", rule: "no-explicit-any", kind: "related" }],
      meta: {
        description: "An unknown type outside a catch binding, a type-predicate subject, or a generic parameter.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits: "Imported aliases are not resolved; only syntactic shapes in this file are seen.",
      },
      requiresTestGlobs: false,
      create: createNoExplicitUnknown,
    },
    "no-unsafe-dictionary": {
      overlaps: [{ ecosystem: "typescript-eslint", rule: "no-explicit-any", kind: "related" }],
      meta: {
        description: "A Record, Map, or index signature whose value type is weak.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits:
          "Local aliases and union members are resolved; interfaces, mapped types, and generic alias expansion are not followed.",
      },
      requiresTestGlobs: false,
      create: createNoUnsafeDictionary,
    },
    "no-typeof-escape": {
      overlaps: [{ ecosystem: "typescript-eslint", rule: "no-explicit-any", kind: "related" }],
      requiresTestGlobs: true,
      meta: {
        description: "An as typeof assertion outside the allowed targets.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits:
          "Only an as typeof cast is reported; the target is compared as source text. Only test files may use an allowed target.",
      },
      create: createNoTypeofEscape,
    },
    "no-pass-through-type-alias": {
      overlaps: [{ ecosystem: "typescript-eslint", rule: "no-unnecessary-type-assertion", kind: "related" }],
      meta: {
        description: "An alias that names another top-level alias of the same file.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "recommended",
        limits: "Only aliases that name another top-level local alias are reported.",
      },
      requiresTestGlobs: false,
      create: createNoPassThroughTypeAlias,
    },
    "no-object-parameters": {
      overlaps: [],
      meta: {
        description: "A parameter typed object.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits:
          "Only a direct object annotation is checked; a default value or a local alias of object is not resolved.",
      },
      requiresTestGlobs: false,
      create: createNoObjectParameters,
    },
    "require-safety-comment": {
      overlaps: [],
      meta: {
        description: "A non-const type assertion that has no safety comment.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits: "Only non-const assertions in production files are checked.",
      },
      requiresTestGlobs: false,
      create: createRequireSafetyComment,
    },
    "no-runtime-typeof": {
      overlaps: [{ ecosystem: "eslint", rule: "valid-typeof", kind: "related" }],
      meta: {
        description: "A typeof comparison that narrows a value at run time.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits: "An existence probe against undefined is allowed.",
      },
      requiresTestGlobs: false,
      create: createNoRuntimeTypeof,
    },
    "no-conditional-empty-object-spread": {
      overlaps: [],
      meta: {
        description: "A spread of a conditional with an empty-object branch.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits: "Only a conditional with an empty object branch is checked.",
      },
      requiresTestGlobs: false,
      create: createNoConditionalEmptyObjectSpread,
    },
    "no-boolean-assert": {
      overlaps: [],
      meta: {
        description: "A string or array check wrapped in a boolean assertion.",
        category: "test-quality",
        docs: "#test-assertions",
        preset: "strict",
        limits: "Only a direct call subject is matched; a message argument does not clear the report.",
      },
      requiresTestGlobs: false,
      create: createNoBooleanAssert,
    },
    "no-repeated-assert-call": {
      overlaps: [],
      meta: {
        description: "Two adjacent assertions that take the same call as their first argument.",
        category: "test-quality",
        docs: "#test-assertions",
        preset: "strict",
        limits: "Only adjacent statements inside one block are compared; a non-block body is not scanned.",
      },
      requiresTestGlobs: false,
      create: createNoRepeatedAssertCall,
    },
    "no-constant-substring-assert": {
      overlaps: [],
      meta: {
        description: "A substring assertion that restates an imported constant as a literal.",
        category: "test-quality",
        docs: "#test-assertions",
        preset: "strict",
        limits: "Only named imports are considered; a namespace or default import is not matched.",
      },
      requiresTestGlobs: false,
      create: createNoConstantSubstringAssert,
    },
    "max-cyclomatic-complexity": {
      overlaps: [{ ecosystem: "eslint", rule: "complexity", kind: "related" }],
      meta: {
        description: "A function whose cyclomatic complexity exceeds the limit.",
        category: "complexity",
        docs: "#complexity-rules",
        preset: "recommended",
        limits:
          "A switch case counts only with a test, and a logical expression only for || and &&. Nested functions are scored alone.",
      },
      requiresTestGlobs: false,
      create: createMaxCyclomaticComplexity,
    },
    "max-class-size": {
      overlaps: [{ ecosystem: "eslint", rule: "max-classes-per-file", kind: "related" }],
      meta: {
        description: "A class whose size score reaches the threshold.",
        category: "complexity",
        docs: "#complexity-rules",
        preset: "strict",
        limits: "The score is per class; a class under the minimum line count is skipped before scoring.",
      },
      requiresTestGlobs: false,
      create: createMaxClassSize,
    },
    "require-optional-wrapper": {
      overlaps: [],
      meta: {
        description: "An optional parameter that the wrapper convention does not declare.",
        category: "optional-parameters",
        docs: "#optional-parameters",
        preset: "opt-in",
        limits: "Only function, method, and constructor parameters are checked.",
      },
      requiresTestGlobs: false,
      create: createRequireOptionalWrapper,
    },
    "import-inside-statement": {
      overlaps: [],
      meta: {
        description: "An import call nested in a function, a block, or a loop.",
        category: "imports",
        docs: "#imports-at-the-top",
        preset: "recommended",
        limits: "Only a dynamic import call is inspected.",
      },
      requiresTestGlobs: false,
      create: createImportInsideStatement,
    },
    "dynamic-import": {
      overlaps: [],
      meta: {
        description: "A dynamic import with no catalog allowance.",
        category: "imports",
        docs: "#dynamic-imports",
        preset: "strict",
        limits: "An allowance names the files that may load a specifier; an empty specifier list allows every target.",
      },
      requiresTestGlobs: false,
      create: createDynamicImport,
    },
    "inline-type-import": {
      overlaps: [],
      meta: {
        description: "An import() type with a member access inside a type annotation.",
        category: "imports",
        docs: "#no-inline-type-imports",
        preset: "recommended",
        limits: "A typeof query on an import expression is allowed.",
      },
      requiresTestGlobs: false,
      create: createInlineTypeImport,
    },
    "re-export-imported": {
      overlaps: [],
      meta: {
        description: "An export that forwards a name another module defines.",
        category: "imports",
        docs: "#no-re-exporting",
        preset: "strict",
        limits: "Only named imports are tracked; a namespace or default import is not matched.",
      },
      requiresTestGlobs: false,
      create: createReExportImported,
    },
    "import-placement": {
      overlaps: [],
      meta: {
        description: "A type definition above the last import, or an import below code.",
        category: "imports",
        docs: "#imports-at-the-top",
        preset: "strict",
        limits: "A type definition above the last import and an import below functional code are reported.",
      },
      requiresTestGlobs: false,
      create: createImportPlacement,
    },
    "exported-interface-placement": {
      overlaps: [],
      meta: {
        description: "An exported interface below functional code.",
        category: "interfaces",
        docs: "#interface-conventions",
        preset: "opt-in",
        limits: "Only an exported interface below the first functional statement is reported.",
      },
      requiresTestGlobs: false,
      create: createExportedInterfacePlacement,
    },
    "promise-response-alias": {
      overlaps: [],
      meta: {
        description: "A type alias that masks Promise<Response>.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "recommended",
        limits: "A direct alias body or a function return type is inspected; nested references are not followed.",
      },
      requiresTestGlobs: false,
      create: createPromiseResponseAlias,
    },
    "promise-response-return": {
      overlaps: [],
      meta: {
        description: "A Promise<Response> type annotation.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "strict",
        limits: "A function type alias body is exempt; only a direct type annotation is reported.",
      },
      requiresTestGlobs: false,
      create: createPromiseResponseReturn,
    },
    "ts-suppression-pragmas": {
      overlaps: [{ ecosystem: "typescript-eslint", rule: "ban-ts-comment", kind: "related" }],
      meta: {
        description: "A @ts-ignore, @ts-expect-error, or @ts-nocheck comment with a description.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "recommended",
        limits: "Only a pragma that carries a description is reported; the built-in ban-ts-comment reports the rest.",
      },
      requiresTestGlobs: false,
      create: createTsSuppressionPragmas,
    },
    "magic-union-type": {
      overlaps: [],
      meta: {
        description: "An inline union of string literals outside a named type alias.",
        category: "magic-values",
        docs: "#no-magic-values",
        preset: "strict",
        limits: "A union that is the whole alias body, possibly inside parentheses or a wider union, is allowed.",
      },
      requiresTestGlobs: false,
      create: createMagicUnionType,
    },
    "long-comment": {
      overlaps: [],
      meta: {
        description: "A comment block longer than the line limit, after the module header.",
        category: "comments",
        docs: "#comment-discipline",
        preset: "strict",
        limits: "Only comment runs after the module header are measured.",
      },
      requiresTestGlobs: false,
      create: createLongComment,
    },
    "ephemeral-comment": {
      overlaps: [],
      meta: {
        description: "A comment with a calendar date or a configured prior-attempt phrase.",
        category: "comments",
        docs: "#comment-discipline",
        preset: "strict",
        limits: "Dates and phrases are matched in comments only; executable strings stay valid.",
      },
      requiresTestGlobs: false,
      create: createEphemeralComment,
    },
    "decorative-comment": {
      overlaps: [],
      meta: {
        description: "A comment line with a repeated-punctuation banner separator.",
        category: "comments",
        docs: "#comment-discipline",
        preset: "recommended",
        limits: "Only a run of four or more repeated punctuation characters is reported.",
      },
      requiresTestGlobs: false,
      create: createDecorativeComment,
    },
    "max-params": {
      overlaps: [{ ecosystem: "eslint", rule: "max-params", kind: "related" }],
      meta: {
        description: "A function, method, or constructor with more parameters than the limit.",
        category: "complexity",
        docs: "#complexity-rules",
        preset: "strict",
        limits: "Only function, method, and constructor declarations are counted.",
      },
      requiresTestGlobs: false,
      create: createMaxParams,
    },
    "test-inline-multiline-fixture": {
      overlaps: [],
      meta: {
        description: "A multi-line structured input written as an inline template in a test.",
        category: "test-quality",
        docs: "#test-fixtures",
        preset: "strict",
        limits: "A template with interpolation is never reported; the minimum line count and names are options.",
      },
      requiresTestGlobs: false,
      create: createTestInlineMultilineFixture,
    },
    "require-module-header": {
      overlaps: [],
      requiresTestGlobs: true,
      meta: {
        description: "A module that does not start with a header comment.",
        category: "module-structure",
        docs: "#module-order",
        preset: "opt-in",
        limits: "The header must start within the configured number of first lines.",
      },
      create: createRequireModuleHeader,
    },
    "ephemeral-filename": {
      overlaps: [],
      meta: {
        description: "A test file name that contains a numbered plan phase.",
        category: "comments",
        docs: "#comment-discipline",
        preset: "recommended",
        limits: "Only test file names are matched against the phase pattern.",
      },
      requiresTestGlobs: false,
      create: createEphemeralFilename,
    },
    "exported-interface-naming": {
      overlaps: [{ ecosystem: "typescript-eslint", rule: "naming-convention", kind: "related" }],
      meta: {
        description: "An exported interface that does not use the configured prefix.",
        category: "interfaces",
        docs: "#interface-conventions",
        preset: "opt-in",
        limits: "Only exported interfaces are checked; the prefix is an option.",
      },
      requiresTestGlobs: false,
      create: createExportedInterfaceNaming,
    },
    "no-interface-rename-on-import": {
      overlaps: [],
      meta: {
        description: "An import that renames a prefixed interface.",
        category: "interfaces",
        docs: "#interface-conventions",
        preset: "opt-in",
        limits: "Only a named import of a prefixed interface is compared.",
      },
      requiresTestGlobs: false,
      create: createNoInterfaceRenameOnImport,
    },
    "import-boundaries": {
      overlaps: [],
      meta: {
        description: "An import that a configured zone denies.",
        category: "boundaries",
        docs: "#import-boundaries",
        preset: "opt-in",
        limits: "The rule reads static imports and re-exports; a malformed regular expression fails catalog parsing.",
      },
      requiresTestGlobs: false,
      create: createImportBoundaries,
    },
  },
  optionSchemas: TYPESCRIPT_OPTION_SCHEMAS,
};

/** The Deno rule pack: rules about `deno-lint-ignore` comments and Deno script headers. */
export const DENO_RULE_PACK: IRulePack = {
  name: "deno",
  rules: {
    "ignore-needs-reason": {
      overlaps: [{ ecosystem: "eslint-comments", rule: "require-description", kind: "duplicate" }],
      meta: {
        description: "A deno-lint-ignore comment for a plugin rule with no reason.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "recommended",
        limits: "Only ignores that name a plugin rule are checked.",
      },
      requiresTestGlobs: false,
      create: createIgnoreNeedsReason,
    },
    "no-forbidden-lint-ignore": {
      overlaps: [{ ecosystem: "eslint-comments", rule: "no-unlimited-disable", kind: "related" }],
      meta: {
        description: "A deno-lint-ignore comment for a forbidden rule.",
        category: "type-safety",
        docs: "#strict-type-safety",
        preset: "recommended",
        limits: "The default forbidden list contains no-explicit-any; file-wide ignores are included unless disabled.",
      },
      requiresTestGlobs: false,
      create: createNoForbiddenLintIgnore,
    },
    "require-deno-shebang": {
      overlaps: [],
      meta: {
        description: "A file whose first line is not the Deno shebang.",
        category: "scripts",
        docs: "#deno-scripts",
        preset: "opt-in",
        limits: "Only the first line is read.",
      },
      requiresTestGlobs: false,
      create: createRequireDenoShebang,
    },
    "require-script-usage": {
      overlaps: [],
      meta: {
        description: "A script header without a Usage section and an example command.",
        category: "scripts",
        docs: "#deno-scripts",
        preset: "opt-in",
        limits: "The section must appear within the configured number of header lines.",
      },
      requiresTestGlobs: false,
      create: createRequireScriptUsage,
    },
  },
  optionSchemas: DENO_OPTION_SCHEMAS,
};
