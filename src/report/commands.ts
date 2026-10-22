/**
 * @module ReportCommands
 * @path src/report/commands.ts
 * @description Resolves a generic host command to the absolute engine entry and the bound descriptor plugin.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/config/descriptor.ts, src/report/collect.ts, src/cli/rules_read.ts]
 */

import { fromFileUrl } from "@std/path";
import { DEFAULT_HOST_MODE } from "../config/descriptor.ts";
import type { IProjectDescriptor, IResolvedRule } from "../config/descriptor.ts";
import type { INotRunCheck } from "./model.ts";

const WHOLE_TREE_CLI = fromFileUrl(new URL("../cli/whole_tree.ts", import.meta.url));
const WHOLE_TREE_CLI_ARG = "src/cli/whole_tree.ts";
const CATALOG_PLACEHOLDER = "--catalog=<catalog>";

/** Replaces the engine-relative entry and catalog placeholder in a generic host command. */
export function resolveHostCommand(
  command: readonly string[] | null,
  descriptor: IProjectDescriptor,
): readonly string[] | null {
  if (command === null) return null;
  return command.map((arg) => {
    if (arg === WHOLE_TREE_CLI_ARG) return WHOLE_TREE_CLI;
    if (arg === CATALOG_PLACEHOLDER) return `--descriptor=${descriptor.pluginUrl.href}`;
    return arg;
  });
}

/** Builds the report's not-run row for a check that the lint host does not execute. */
export function notRunCheck(rule: IResolvedRule, descriptor: IProjectDescriptor): INotRunCheck {
  return {
    id: rule.id,
    command: resolveHostCommand(rule.command, descriptor),
    mode: DEFAULT_HOST_MODE,
  };
}
