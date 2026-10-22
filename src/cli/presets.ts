/**
 * @module CliPresets
 * @path src/cli/presets.ts
 * @description `presets list` and `presets show`: each preset's rule expansion for the registered packs.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/config/presets.ts, src/cli/unslop.ts]
 */

import type { ICompiledConfig } from "../config/descriptor.ts";
import { type PresetId, PRESETS } from "../config/presets.ts";
import { CliError, USAGE_EXIT } from "./error.ts";
import { jsonText, type OutputFormat, tableText } from "./output.ts";

interface IPresetView {
  readonly id: PresetId;
  readonly description: string;
  readonly memberships: readonly string[];
  readonly rules: readonly string[];
}

const TABLE_HEADERS = ["ID", "RULES", "DESCRIPTION"] as const;

function rulesFor(compiled: ICompiledConfig, memberships: readonly string[]): string[] {
  return Object.values(compiled.rules)
    .filter((rule) => memberships.includes(rule.meta.preset))
    .map((rule) => rule.id)
    .sort();
}

function viewOf(compiled: ICompiledConfig, id: PresetId): IPresetView {
  const preset = PRESETS[id];
  return {
    id: preset.id,
    description: preset.description,
    memberships: preset.memberships,
    rules: rulesFor(compiled, preset.memberships),
  };
}

/** `presets list`: every engine preset with the rules its memberships enable. */
export function listPresets(compiled: ICompiledConfig, format: OutputFormat): string {
  const presets = Object.keys(PRESETS).map((id) => viewOf(compiled, id as PresetId));
  if (format === "json") return jsonText({ presets });
  return tableText(
    TABLE_HEADERS,
    presets.map((preset) => [preset.id, String(preset.rules.length), preset.description]),
  );
}

/** `presets show <name>`: one preset's expansion, or a usage error for an unknown name. */
export function showPreset(compiled: ICompiledConfig, name: string, format: OutputFormat): string {
  if (!(name in PRESETS)) throw new CliError(USAGE_EXIT, `unknown preset '${name}'`);
  const preset = viewOf(compiled, name as PresetId);
  if (format === "json") return jsonText({ preset });
  return tableText(TABLE_HEADERS, [[preset.id, String(preset.rules.length), preset.description]]) +
    `${preset.rules.join("\n")}\n`;
}
