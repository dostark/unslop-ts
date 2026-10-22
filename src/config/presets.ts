/**
 * @module ConfigPresets
 * @path src/config/presets.ts
 * @description The engine presets and the metadata memberships each one expands.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/config/compile.ts, src/rules/meta.ts, src/cli/presets.ts]
 */

import type { PresetMembership } from "../rules/meta.ts";

/** The preset ids a configuration may name. */
export const PRESET_IDS = ["unslop:recommended", "unslop:strict"] as const;

/** A preset id. */
export type PresetId = (typeof PRESET_IDS)[number];

/** One engine preset: the metadata memberships it enables. */
export interface IPreset {
  readonly id: PresetId;
  readonly memberships: readonly PresetMembership[];
  readonly description: string;
}

/** The presets, in release order. `strict` includes the recommended rules. */
export const PRESETS: Readonly<Record<PresetId, IPreset>> = {
  "unslop:recommended": {
    id: "unslop:recommended",
    memberships: ["recommended"],
    description: "Rules that every project should enable.",
  },
  "unslop:strict": {
    id: "unslop:strict",
    memberships: ["recommended", "strict"],
    description: "The recommended rules and the stricter type, import, test, and comment rules.",
  },
};
