/**
 * @module UnslopCli
 * @path src/cli/unslop.ts
 * @description The `unslop` read CLI: rule queries, preset expansion, and configuration validation and printing.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/cli/project_loader.ts, src/cli/rules_read.ts, src/cli/presets.ts, src/cli/config_read.ts]
 *
 * Usage:
 *   deno run --allow-read --allow-env src/cli/unslop.ts rules list [--category=] [--status=] [--format=]
 *   deno run --allow-read --allow-env src/cli/unslop.ts rules show <id> [--format=]
 *   deno run --allow-read --allow-env src/cli/unslop.ts presets list|show <name> [--format=]
 *   deno run --allow-read --allow-env src/cli/unslop.ts config validate|print [--resolved]|schema [--descriptor=]
 *
 * Exit codes: 0 success, 1 invalid file content, 2 usage or unsupported operation.
 */

import { CliError, FAILURE_EXIT, USAGE_EXIT } from "./error.ts";
import { listPresets, showPreset } from "./presets.ts";
import { printConfigText, schemaText, validationText } from "./config_read.ts";
import { parseFormat, print, printError } from "./output.ts";
import { loadConfigDescriptor, loadProject, readAndCompile, readConfigObject } from "./project_loader.ts";
import { listRules, showRule } from "./rules_read.ts";
import { type IResolvedSelection, resolveSelection } from "./selection.ts";
import type { ICompiledConfig, IProjectDescriptor } from "../config/descriptor.ts";

const USAGE = [
  "Usage:",
  "  unslop rules list [--category=<category>] [--status=<status>] [--format=table|json] [--select=<tokens>|--profile=<name>]",
  "  unslop rules show <id> [--format=table|json] [--select=<tokens>|--profile=<name>]",
  "  unslop presets list [--format=table|json]",
  "  unslop presets show <name> [--format=table|json]",
  "  unslop config validate [--descriptor=<entry>]",
  "  unslop config print [--resolved] [--descriptor=<entry>]",
  "  unslop config schema",
  "",
  "Every command accepts --plugin=<entry> to select a local plugin entry explicitly.",
].join("\n");

const QUERY_OPTIONS = ["format", "select", "profile", "plugin"];

interface IParsedArgs {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

function parseArgs(args: readonly string[], valueNames: readonly string[], flagNames: readonly string[]): IParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const separator = body.indexOf("=");
    if (separator === -1) {
      if (!flagNames.includes(body)) throw new CliError(USAGE_EXIT, `unknown option '--${body}'`);
      flags.add(body);
      continue;
    }
    const name = body.slice(0, separator);
    const value = body.slice(separator + 1);
    if (!valueNames.includes(name)) throw new CliError(USAGE_EXIT, `unknown option '--${name}'`);
    if (value === "") throw new CliError(USAGE_EXIT, `option '--${name}' needs a value`);
    options.set(name, value);
  }
  return { positionals, options, flags };
}

function requirePositionals(parsed: IParsedArgs, count: number, command: string): string[] {
  if (parsed.positionals.length !== count) {
    throw new CliError(USAGE_EXIT, `${command} needs ${count === 0 ? "no" : String(count)} argument(s)\n${USAGE}`);
  }
  return [...parsed.positionals];
}

function option(parsed: IParsedArgs, name: string): string | undefined {
  return parsed.options.get(name);
}

async function loadQuery(parsed: IParsedArgs): Promise<{
  compiled: ICompiledConfig;
  descriptor: IProjectDescriptor;
  selection: IResolvedSelection | null;
}> {
  const project = await loadProject(Deno.cwd(), option(parsed, "plugin"));
  const config = await readConfigObject(project.descriptor);
  const selection = resolveSelection(
    project.compiled,
    config,
    project.descriptor.pluginName,
    option(parsed, "select"),
    option(parsed, "profile"),
  );
  return { compiled: project.compiled, descriptor: project.descriptor, selection };
}

async function rulesCommand(args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "list") {
    const parsed = parseArgs(rest, [...QUERY_OPTIONS, "category", "status"], []);
    requirePositionals(parsed, 0, "rules list");
    const { compiled, selection } = await loadQuery(parsed);
    print(
      listRules(compiled, {
        format: parseFormat(option(parsed, "format")),
        category: option(parsed, "category"),
        status: option(parsed, "status"),
        selection,
      }),
    );
    return 0;
  }
  if (sub === "show") {
    const parsed = parseArgs(rest, QUERY_OPTIONS, []);
    const [id] = requirePositionals(parsed, 1, "rules show");
    const { compiled, selection } = await loadQuery(parsed);
    print(showRule(compiled, { format: parseFormat(option(parsed, "format")), selection }, id));
    return 0;
  }
  throw new CliError(USAGE_EXIT, `unknown rules command '${sub ?? ""}'\n${USAGE}`);
}

async function presetsCommand(args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "list") {
    const parsed = parseArgs(rest, QUERY_OPTIONS, []);
    requirePositionals(parsed, 0, "presets list");
    const { compiled } = await loadQuery(parsed);
    print(listPresets(compiled, parseFormat(option(parsed, "format"))));
    return 0;
  }
  if (sub === "show") {
    const parsed = parseArgs(rest, QUERY_OPTIONS, []);
    const [name] = requirePositionals(parsed, 1, "presets show");
    const { compiled } = await loadQuery(parsed);
    print(showPreset(compiled, name, parseFormat(option(parsed, "format"))));
    return 0;
  }
  throw new CliError(USAGE_EXIT, `unknown presets command '${sub ?? ""}'\n${USAGE}`);
}

async function configCommand(args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "schema") {
    const parsed = parseArgs(rest, [], []);
    requirePositionals(parsed, 0, "config schema");
    print(schemaText());
    return 0;
  }
  if (sub === "validate") {
    const parsed = parseArgs(rest, ["descriptor", "plugin"], []);
    requirePositionals(parsed, 0, "config validate");
    const descriptor = await loadConfigDescriptor(Deno.cwd(), option(parsed, "descriptor"), option(parsed, "plugin"));
    const compiled = await readAndCompile(descriptor);
    print(validationText(descriptor, compiled));
    return 0;
  }
  if (sub === "print") {
    const parsed = parseArgs(rest, ["descriptor", "plugin"], ["resolved"]);
    requirePositionals(parsed, 0, "config print");
    const descriptor = await loadConfigDescriptor(Deno.cwd(), option(parsed, "descriptor"), option(parsed, "plugin"));
    print(printConfigText(await readAndCompile(descriptor), parsed.flags.has("resolved")));
    return 0;
  }
  throw new CliError(USAGE_EXIT, `unknown config command '${sub ?? ""}'\n${USAGE}`);
}

/** Runs one CLI invocation and returns its exit code. */
export async function main(args: readonly string[]): Promise<number> {
  try {
    const [command, ...rest] = args;
    if (command === "rules") return await rulesCommand(rest);
    if (command === "presets") return await presetsCommand(rest);
    if (command === "config") return await configCommand(rest);
    throw new CliError(USAGE_EXIT, `${command === undefined ? "" : `unknown command '${command}'\n`}${USAGE}`);
  } catch (error) {
    if (error instanceof CliError) {
      printError(`${error.message}\n`);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    printError(`unexpected failure: ${message}\n`);
    return FAILURE_EXIT;
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
