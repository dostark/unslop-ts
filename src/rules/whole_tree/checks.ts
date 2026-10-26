/**
 * @module WholeTreeChecks
 * @path src/rules/whole_tree/checks.ts
 * @description Engine descriptors of the seven whole-tree checks: metadata, option schema, controls, and host command.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/rules/whole_tree/options.ts, src/config/descriptor.ts, src/rules/meta.ts]
 */

import type { z } from "zod";
import { DEFAULT_HOST_MODE, type IRuleControls } from "../../config/descriptor.ts";
import type { IRuleMeta } from "../meta.ts";
import {
  ConstantRestatementSettingsSchema,
  DuplicateConstantOptionsSchema,
  DuplicateTypeOptionsSchema,
  MagicLiteralOptionsSchema,
  OptionalParamsSettingsSchema,
  UnusedExportsSettingsSchema,
  UnusedFilesSettingsSchema,
} from "./options.ts";

/** The id of each whole-tree check. These ids stay bare; the engine prefixes plugin ids only. */
export type WholeTreeCheckKey =
  | "duplicate-type"
  | "duplicate-constant"
  | "magic-literals"
  | "constant-restatement"
  | "unused-exports"
  | "unused-files"
  | "optional-params";

/** One whole-tree check that a host script runs in process. */
export interface IWholeTreeCheck {
  readonly meta: IRuleMeta;
  /** Null means the check accepts no options. */
  readonly optionSchema: z.ZodTypeAny | null;
  readonly controls: IRuleControls;
  /** The host command argv that runs the check. */
  readonly command: readonly string[];
}

const CLI_SEGMENTS = ["src", "cli", "whole_tree.ts"] as const;
const CLI_PATH = CLI_SEGMENTS.join("/");
const CATALOG_ARGUMENT = "--catalog=<catalog>";
const UNUSED_EXPORTS_FAIL = "--fail";
const OPTIONAL_PARAMS_FAIL = "--fail";
const OPTIONAL_PARAMS_STAGED = "--staged";
const ERROR_MODE = "error";
const WARN_MODE = "warn";

/** Commands that report a finding at their fixed error level. */
const FIXED_ERROR_CONTROLS: IRuleControls = {
  editable: ["options"],
  fixedLevel: ERROR_MODE,
  fixedScope: null,
  fixedInclude: null,
  fixedExclude: null,
  hostModes: { [DEFAULT_HOST_MODE]: ERROR_MODE },
};

/** The unused-exports check warns; a host adds --fail to make findings fatal. */
const UNUSED_EXPORTS_CONTROLS: IRuleControls = {
  editable: ["options"],
  fixedLevel: null,
  fixedScope: null,
  fixedInclude: null,
  fixedExclude: null,
  hostModes: { [DEFAULT_HOST_MODE]: WARN_MODE, [UNUSED_EXPORTS_FAIL]: ERROR_MODE },
};

/** The unused-files check warns; a host adds --fail to make findings fatal. */
const UNUSED_FILES_CONTROLS: IRuleControls = {
  editable: ["options"],
  fixedLevel: null,
  fixedScope: null,
  fixedInclude: null,
  fixedExclude: null,
  hostModes: { [DEFAULT_HOST_MODE]: WARN_MODE, [UNUSED_EXPORTS_FAIL]: ERROR_MODE },
};

/** The optional-parameters check is a warning until its host adds --fail or --staged. */
const OPTIONAL_PARAMS_CONTROLS: IRuleControls = {
  editable: ["options"],
  fixedLevel: null,
  fixedScope: null,
  fixedInclude: null,
  fixedExclude: null,
  hostModes: {
    [DEFAULT_HOST_MODE]: WARN_MODE,
    [OPTIONAL_PARAMS_FAIL]: ERROR_MODE,
    [OPTIONAL_PARAMS_STAGED]: ERROR_MODE,
  },
};

function hostCommand(rule: WholeTreeCheckKey): readonly string[] {
  return ["deno", "run", "-A", CLI_PATH, CATALOG_ARGUMENT, `--rule=${rule}`];
}

/** The seven whole-tree checks, in guide order. */
export const WHOLE_TREE_CHECKS: Readonly<Record<WholeTreeCheckKey, IWholeTreeCheck>> = {
  "duplicate-type": {
    meta: {
      description: "An interface or object type with the same name and members in two files.",
      category: "magic-values",
      docs: "#no-magic-values",
      preset: "recommended",
      limits:
        "Interface and object type alias members are compared after whitespace normalization. Imported aliases are not resolved.",
    },
    optionSchema: DuplicateTypeOptionsSchema,
    controls: FIXED_ERROR_CONTROLS,
    command: hostCommand("duplicate-type"),
  },
  "duplicate-constant": {
    meta: {
      description: "A top-level constant with the same name and static value in two files.",
      category: "magic-values",
      docs: "#no-magic-values",
      preset: "recommended",
      limits:
        "Top-level named constants with a static value are compared; a value from a call, identifier, or interpolation is out of scope.",
    },
    optionSchema: DuplicateConstantOptionsSchema,
    controls: FIXED_ERROR_CONTROLS,
    command: hostCommand("duplicate-constant"),
  },
  "magic-literals": {
    meta: {
      description: "A repeated string or number above the configured threshold.",
      category: "magic-values",
      docs: "#no-magic-values",
      preset: "strict",
      limits:
        "Literals are counted per scope; configured vocabularies, definition files, and test scaffolding never count.",
    },
    optionSchema: MagicLiteralOptionsSchema,
    controls: FIXED_ERROR_CONTROLS,
    command: hostCommand("magic-literals"),
  },
  "constant-restatement": {
    meta: {
      description: "A test that restates a constant's value instead of importing the constant.",
      category: "magic-values",
      docs: "#no-magic-values",
      preset: "opt-in",
      limits: "Only list constants joined with a configured separator are compared; a plain space is not a separator.",
    },
    optionSchema: ConstantRestatementSettingsSchema,
    controls: FIXED_ERROR_CONTROLS,
    command: hostCommand("constant-restatement"),
  },
  "unused-exports": {
    meta: {
      description: "An export that no other production file imports.",
      category: "module-structure",
      docs: "#module-order",
      preset: "opt-in",
      limits:
        "The default report applies the exemption list: barrels, tests, entry points, and configured skip paths. An unused interface or type alias reports as a warning unless `// unslop-ignore-next-line unused-type` or `@public` exempts it. `--all` reports the broad superset; `--fail` fails only on error findings.",
    },
    optionSchema: UnusedExportsSettingsSchema,
    controls: UNUSED_EXPORTS_CONTROLS,
    command: hostCommand("unused-exports"),
  },
  "unused-files": {
    meta: {
      description: "A production file that no entry point reaches.",
      category: "module-structure",
      docs: "#module-order",
      preset: "opt-in",
      limits:
        "Reachability follows relative imports, re-exports, and configured aliases inside the walked root. A dynamic import or an unresolved specifier is not followed.",
    },
    optionSchema: UnusedFilesSettingsSchema,
    controls: UNUSED_FILES_CONTROLS,
    command: hostCommand("unused-files"),
  },
  "optional-params": {
    meta: {
      description: "An optional parameter whose optionality does not match its call sites.",
      category: "optional-parameters",
      docs: "#optional-parameters",
      preset: "opt-in",
      limits: "Only call sites inside the walked roots are compared; a dynamic call is not resolved.",
    },
    optionSchema: OptionalParamsSettingsSchema,
    controls: OPTIONAL_PARAMS_CONTROLS,
    command: hostCommand("optional-params"),
  },
};
