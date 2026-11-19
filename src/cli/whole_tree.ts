#!/usr/bin/env -S deno run -A
/**
 * @module WholeTreeCli
 * @path src/cli/whole_tree.ts
 * @description Runs one whole-tree rule over the repository through the shared check runner.
 * @architectural-layer Tooling
 * @related-files [src/cli/check_runner.ts, src/cli/unslop.ts, src/rules/whole_tree/optional_params.ts]
 *
 * Usage:
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=<rule> [flags]
 *   deno run -A src/cli/whole_tree.ts --descriptor=<path> --rule=<rule> [flags]
 *
 * Every flag belongs to the rule; run with --rule=<rule> to see its output help.
 */

import { flagValue } from "./flags.ts";
import { fromFileUrl } from "@std/path";
import { CliError } from "./error.ts";
import { loadConfigDescriptor, readAndCompile } from "./project_loader.ts";
import { asJsonValue, type JsonValue } from "../engine/catalog.ts";
import { print, printError } from "./output.ts";
import { runWholeTreeCheck, WHOLE_TREE_RULES } from "./check_runner.ts";

const USAGE_EXIT = 2;

const NON_FILE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function inputCount(args: readonly string[]): number {
  return ["catalog", "descriptor", "plugin"].filter((name) => flagValue(args, name) !== undefined).length;
}

/** The compiled or legacy catalog, and the project root that a scan walks. */
interface ILoadedInput {
  readonly catalog: JsonValue;
  readonly rootPath: string;
}

/** Loads either the legacy catalog or a compiled descriptor, with exactly one explicit input. */
async function loadCatalog(args: readonly string[]): Promise<ILoadedInput> {
  if (inputCount(args) !== 1) {
    return exitWithUsage("Pass exactly one of --catalog, --descriptor, or --plugin.");
  }
  const catalogPath = flagValue(args, "catalog");
  if (catalogPath !== undefined) {
    if (NON_FILE.test(catalogPath) && !catalogPath.startsWith("file:")) {
      return exitWithUsage(`'${catalogPath}' is not a filesystem path.`);
    }
    try {
      const local = catalogPath.startsWith("file:") ? fromFileUrl(new URL(catalogPath)) : catalogPath;
      return { catalog: JSON.parse(await Deno.readTextFile(local)) as JsonValue, rootPath: await Deno.realPath(".") };
    } catch (error) {
      return exitWithUsage(
        `Cannot read the catalog '${catalogPath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const descriptorArg = flagValue(args, "descriptor") ?? null;
  const pluginArg = flagValue(args, "plugin") ?? null;
  for (const value of [descriptorArg, pluginArg]) {
    if (value !== null && NON_FILE.test(value) && !value.startsWith("file:")) {
      return exitWithUsage(`'${value}' is not a filesystem path.`);
    }
  }
  try {
    const descriptor = await loadConfigDescriptor(Deno.cwd(), descriptorArg, pluginArg);
    const compiled = await readAndCompile(descriptor);
    return {
      catalog: asJsonValue(structuredClone(compiled.catalog)),
      rootPath: await Deno.realPath(fromFileUrl(descriptor.rootUrl)),
    };
  } catch (error) {
    if (error instanceof CliError) return exitWithUsage(error.message);
    throw error;
  }
}

/** Reads the whole-tree settings from the catalog, or exits with a usage error. */

function exitWithUsage(message: string): never {
  console.error(message);
  console.error(
    `Usage: whole_tree.ts (--catalog=<path> | --descriptor=<path> | --plugin=<path>) --rule=<${
      WHOLE_TREE_RULES.join("|")
    }> [--all] [--fail] [--staged] [--include-tests]`,
  );
  Deno.exit(USAGE_EXIT);
}

async function main(): Promise<void> {
  const rule = flagValue(Deno.args, "rule");
  if (rule === undefined || !WHOLE_TREE_RULES.includes(rule)) exitWithUsage("Missing or unknown --rule.");
  const input = await loadCatalog(Deno.args);
  const result = await runWholeTreeCheck(rule, {
    catalog: input.catalog,
    rootPath: input.rootPath,
    args: Deno.args,
  });
  print(result.stdout);
  printError(result.stderr);
  Deno.exit(result.code);
}

if (import.meta.main) await main();
