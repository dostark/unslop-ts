/**
 * @module ProjectLoader
 * @path src/cli/project_loader.ts
 * @description Discovers a project, loads local entries, and reads the version 2 file for the CLI.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/config/compile.ts, src/config/schema.ts, src/cli/unslop.ts]
 */

import { dirname, fromFileUrl, join, resolve, toFileUrl } from "@std/path";
import type { JsonValue } from "../engine/catalog.ts";
import { compileConfig } from "../config/compile.ts";
import type { ICompiledConfig, IProjectDescriptor } from "../config/descriptor.ts";
import type { IUnslopProject } from "../../deno.ts";
import { ConfigError, ConfigV2Schema, type IConfigV2 } from "../config/schema.ts";
import { CliError, FAILURE_EXIT, USAGE_EXIT } from "./error.ts";

const LINT_CONFIG = "deno.json";
const LINT_CONFIG_JSONC = "deno.jsonc";
const DEFAULT_DESCRIPTOR = "unslop.project.ts";
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const JSONC_SUFFIX = ".jsonc";

/** The project files the CLI found. */
interface IProjectLocation {
  readonly root: string;
  readonly lintConfigPath: string;
  readonly pluginPath: string;
  readonly descriptorPath: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function pathLabel(url: URL): string {
  return url.protocol === "file:" ? fromFileUrl(url) : url.href;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Resolves a filesystem path or a local `file:` URL, rejecting every other scheme before any import. */
export async function resolveLocalEntry(value: string, cwd: string): Promise<URL> {
  if (SCHEME.test(value) && !value.startsWith("file:")) {
    throw new CliError(USAGE_EXIT, `'${value}' is not a local file entry. Use a filesystem path or a file: URL.`);
  }
  let url: URL;
  if (value.startsWith("file:")) {
    try {
      url = new URL(value);
    } catch {
      throw new CliError(USAGE_EXIT, `'${value}' is not a valid file: URL.`);
    }
    if (url.protocol !== "file:" || url.host !== "") {
      throw new CliError(USAGE_EXIT, `'${value}' is not a local file entry. A file: URL must have no host.`);
    }
  } else {
    url = toFileUrl(resolve(cwd, value));
  }
  let realPath: string;
  try {
    realPath = await Deno.realPath(fromFileUrl(url));
  } catch {
    throw new CliError(USAGE_EXIT, `'${value}' does not exist.`);
  }
  if (!await isFile(realPath)) throw new CliError(USAGE_EXIT, `'${value}' is not a file.`);
  return toFileUrl(realPath);
}

/** Loads a local module after the scheme check. Local entries are trusted executable project code. */
async function loadLocalModule(value: string, cwd: string): Promise<Record<string, unknown>> {
  const url = await resolveLocalEntry(value, cwd);
  try {
    // deno-lint-ignore self/import-inside-statement -- the plugin entry is a runtime path
    return await import(url.href) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(FAILURE_EXIT, `${value}: failed to load (${message})`);
  }
}

/** Finds the nearest JSON lint config, refusing a directory whose only config is JSONC. */
async function findLintConfig(cwd: string): Promise<{ root: string; configPath: string }> {
  for (let dir = resolve(cwd);; dir = dirname(dir)) {
    const jsonPath = join(dir, LINT_CONFIG);
    if (await isFile(jsonPath)) return { root: dir, configPath: jsonPath };
    const jsoncPath = join(dir, LINT_CONFIG_JSONC);
    if (await isFile(jsoncPath)) {
      throw new CliError(
        USAGE_EXIT,
        `${jsoncPath}: JSONC is not supported. Use a JSON deno.json or pass --descriptor.`,
      );
    }
    if (dirname(dir) === dir) break;
  }
  throw new CliError(USAGE_EXIT, "no deno.json found. Run inside a project or pass --plugin.");
}

async function readLintConfig(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    throw new CliError(FAILURE_EXIT, `${path}: cannot read the lint configuration.`);
  }
  try {
    const parsed = JSON.parse(text);
    const record = asRecord(parsed);
    if (!record) throw new Error("the root value is not an object");
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(FAILURE_EXIT, `${path}: invalid JSON (${message})`);
  }
}

function configuredPlugins(config: Record<string, unknown>): string[] {
  const lint = asRecord(config.lint);
  const plugins = lint?.plugins;
  if (!Array.isArray(plugins)) return [];
  return plugins.filter((plugin): plugin is string => typeof plugin === "string");
}

async function siblingDescriptor(pluginPath: string, root: string): Promise<string | null> {
  const sibling = join(dirname(pluginPath), DEFAULT_DESCRIPTOR);
  if (await isFile(sibling)) return sibling;
  const atRoot = join(root, DEFAULT_DESCRIPTOR);
  return await isFile(atRoot) ? atRoot : null;
}

/** Finds the project and its single configured local plugin. Several plugins require `--plugin`. */
async function locateProject(cwd: string, pluginArg: string | null): Promise<IProjectLocation> {
  const lint = await findLintConfig(cwd);
  let pluginPath: string;
  if (pluginArg !== null) {
    pluginPath = resolve(cwd, pluginArg);
  } else {
    const plugins = configuredPlugins(await readLintConfig(lint.configPath));
    if (plugins.length === 0) {
      throw new CliError(USAGE_EXIT, `${lint.configPath}: no local plugin is configured. Pass --plugin.`);
    }
    if (plugins.length > 1) {
      throw new CliError(USAGE_EXIT, `${lint.configPath}: several plugins are configured. Pass --plugin.`);
    }
    pluginPath = resolve(lint.root, plugins[0]);
  }
  return {
    root: lint.root,
    lintConfigPath: lint.configPath,
    pluginPath,
    descriptorPath: await siblingDescriptor(pluginPath, lint.root),
  };
}

function isDescriptor(value: unknown): value is IProjectDescriptor {
  const record = asRecord(value);
  return record !== null && typeof record.pluginName === "string" && Array.isArray(record.packs) &&
    record.rootUrl instanceof URL && record.configUrl instanceof URL &&
    record.lintConfigUrl instanceof URL && record.pluginUrl instanceof URL &&
    asRecord(record.scriptRules) !== null && asRecord(record.wholeTreeHosts) !== null;
}

function isProject(value: unknown): value is IUnslopProject {
  const record = asRecord(value);
  return record !== null && isDescriptor(record.descriptor) && asRecord(record.compiled) !== null &&
    asRecord(record.plugin) !== null;
}

async function loadProjectEntry(value: string, cwd: string): Promise<IUnslopProject> {
  const module = await loadLocalModule(value, cwd);
  if (!isProject(module.project)) {
    throw new CliError(USAGE_EXIT, `${value}: the entry must export 'project' from createUnslopProject.`);
  }
  return module.project;
}

/** Loads the configured project, whose entry exports a compiled `project`. */
export async function loadProject(cwd: string, pluginArg: string | null): Promise<IUnslopProject> {
  if (pluginArg !== null) return await loadProjectEntry(pluginArg, cwd);
  const location = await locateProject(cwd, null);
  return await loadProjectEntry(location.pluginPath, cwd);
}

async function loadDescriptorEntry(value: string, cwd: string): Promise<IProjectDescriptor> {
  const module = await loadLocalModule(value, cwd);
  if (!isDescriptor(module.descriptor)) {
    throw new CliError(USAGE_EXIT, `${value}: the entry must export 'descriptor'.`);
  }
  return module.descriptor;
}

/** Loads the descriptor that a configuration command needs, without importing the plugin. */
export async function loadConfigDescriptor(
  cwd: string,
  descriptorArg: string | null,
  pluginArg: string | null,
): Promise<IProjectDescriptor> {
  if (descriptorArg !== null) return await loadDescriptorEntry(descriptorArg, cwd);
  const location = await locateProject(cwd, pluginArg);
  if (location.descriptorPath === null) {
    throw new CliError(
      USAGE_EXIT,
      `no ${DEFAULT_DESCRIPTOR} next to ${location.pluginPath}. Pass --descriptor.`,
    );
  }
  return await loadDescriptorEntry(location.descriptorPath, cwd);
}

function configLabel(descriptor: IProjectDescriptor): string {
  return pathLabel(descriptor.configUrl);
}

function assertJsonConfig(url: URL): void {
  if (url.pathname.endsWith(JSONC_SUFFIX)) {
    throw new CliError(USAGE_EXIT, `${pathLabel(url)}: JSONC is not supported. Use a JSON configuration.`);
  }
}

/** The exact bytes and parsed value of the version 2 file, before schema defaults apply. */
export interface IConfigSource {
  readonly text: string;
  readonly value: JsonValue;
}

/** Reads and parses the version 2 file as raw JSON, so an edit can preserve the author's fields. */
export async function readConfigSource(descriptor: IProjectDescriptor): Promise<IConfigSource> {
  assertJsonConfig(descriptor.configUrl);
  const label = configLabel(descriptor);
  let text: string;
  try {
    text = await Deno.readTextFile(descriptor.configUrl);
  } catch {
    throw new CliError(FAILURE_EXIT, `${label}: cannot read the configuration.`);
  }
  try {
    return { text, value: JSON.parse(text) as JsonValue };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(FAILURE_EXIT, `${label}: invalid JSON (${message})`);
  }
}

/** Reads and structurally parses the version 2 file without compiling it. */
export async function readConfigObject(descriptor: IProjectDescriptor): Promise<IConfigV2> {
  const source = await readConfigSource(descriptor);
  const result = ConfigV2Schema.safeParse(source.value);
  if (!result.success) {
    const label = configLabel(descriptor);
    const issue = result.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.map(String).join(".") : "config";
    throw new CliError(FAILURE_EXIT, `${label}: ${path}: ${issue?.message ?? "invalid configuration"}`);
  }
  return result.data;
}

/** Reads the version 2 file from disk and compiles it against the descriptor. */
export async function readAndCompile(descriptor: IProjectDescriptor): Promise<ICompiledConfig> {
  const source = await readConfigSource(descriptor);
  try {
    return compileConfig(source.value, descriptor);
  } catch (error) {
    if (error instanceof ConfigError) throw new CliError(FAILURE_EXIT, `${configLabel(descriptor)}: ${error.message}`);
    throw error;
  }
}
