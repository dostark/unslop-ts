/**
 * @module RulesWriteCommand
 * @path src/cli/commands/rules_write.ts
 * @description The `rules enable|disable|set|unset` routes: validate a pure edit, show a diff, or replace the file atomically.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/config/edit.ts, src/cli/safe_write.ts, src/cli/diff.ts]
 */

import { fromFileUrl } from "@std/path";
import type { JsonValue, RuleSeverity } from "../../engine/catalog.ts";
import {
  disableRule,
  EditRefusalError,
  enableRule,
  type IEditContext,
  setOption,
  unsetOption,
} from "../../config/edit.ts";
import { ConfigError } from "../../config/schema.ts";
import { unifiedDiff } from "../diff.ts";
import { CliError, FAILURE_EXIT, USAGE_EXIT } from "../error.ts";
import { loadProject, readConfigSource } from "../project_loader.ts";
import { replaceFile, WriteRefusalError } from "../safe_write.ts";

/** The four targeted edit operations. */
export type RuleEditKind = "enable" | "disable" | "set" | "unset";

/** One requested edit. */
export interface IRuleEditRequest {
  readonly kind: RuleEditKind;
  readonly id: string;
  readonly level?: string;
  readonly reason?: string;
  readonly optIn?: boolean;
  readonly option?: string;
  readonly value?: JsonValue;
}

/** Options shared by the edit routes. */
export interface IRuleEditOptions {
  readonly plugin?: string;
  readonly dryRun: boolean;
}

/** The outcome of one edit. */
export interface IRuleEditResult {
  readonly path: string;
  /** The printed diff in dry-run mode, or null when the file was written. */
  readonly diff: string | null;
  readonly changed: boolean;
}

const DEFAULT_LEVEL: RuleSeverity = "error";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeConfig(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function localConfigPath(descriptor: IEditContext["descriptor"]): string {
  if (descriptor.configUrl.protocol !== "file:") {
    throw new CliError(USAGE_EXIT, "editing requires a local file: configuration.");
  }
  return fromFileUrl(descriptor.configUrl);
}

function applyEdit(config: JsonValue, context: IEditContext, request: IRuleEditRequest): JsonValue {
  switch (request.kind) {
    case "enable":
      return enableRule(config, context, request.id, (request.level ?? DEFAULT_LEVEL) as RuleSeverity);
    case "disable":
      return disableRule(config, context, request.id, request.reason ?? "", request.optIn === true);
    case "set":
      return setOption(config, context, request.id, request.option ?? "", request.value ?? null);
    case "unset":
      return unsetOption(config, context, request.id, request.option ?? "");
  }
}

/** Re-reads the configuration, applies one edit, validates it, and writes or diffs the result. */
export async function runRuleEdit(
  cwd: string,
  request: IRuleEditRequest,
  options: IRuleEditOptions,
): Promise<IRuleEditResult> {
  const project = await loadProject(cwd, options.plugin);
  const source = await readConfigSource(project.descriptor);
  const context: IEditContext = { descriptor: project.descriptor, compiled: project.compiled };
  let next: JsonValue;
  try {
    next = applyEdit(source.value, context, request);
  } catch (error) {
    if (error instanceof EditRefusalError) throw new CliError(USAGE_EXIT, error.message);
    if (error instanceof ConfigError) throw new CliError(FAILURE_EXIT, error.message);
    throw new CliError(FAILURE_EXIT, messageOf(error));
  }
  const path = localConfigPath(project.descriptor);
  const contents = serializeConfig(next);
  if (contents === source.text) return { path, diff: options.dryRun ? "" : null, changed: false };
  if (options.dryRun) return { path, diff: unifiedDiff(path, source.text, contents), changed: true };
  try {
    return { path: await replaceFile({ path, contents, expected: source.text }), diff: null, changed: true };
  } catch (error) {
    if (error instanceof WriteRefusalError) throw new CliError(USAGE_EXIT, error.message);
    throw new CliError(FAILURE_EXIT, messageOf(error));
  }
}
