/**
 * @module HealthAliases
 * @path src/report/aliases.ts
 * @description Reads the import map and the workspace package exports of the project configs for the health graph.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/report/graph.ts, src/report/health.ts, src/engine/posix_path.ts]
 */

import { join as platformJoin } from "@std/path";
import { join, normalize } from "../engine/posix_path.ts";

/** The alias value of a key that two configs map to different files, so no single target is right. */
export const AMBIGUOUS_ALIAS = "\0ambiguous";

const CONFIG_NAMES: readonly string[] = ["deno.json", "deno.jsonc"];
const ROOT_DIRECTORY = ".";
const EXPORT_ROOT = ".";
const GLOB_MARK = "*";
const SLASH = "/";

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text without `//` and block comments and without trailing commas, string contents untouched. */
function stripJsonc(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end + 1;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** The first config of a directory that parses to an object, or null. */
async function readConfig(rootPath: string, dir: string): Promise<ConfigRecord | null> {
  for (const name of CONFIG_NAMES) {
    try {
      const value: unknown = JSON.parse(stripJsonc(await Deno.readTextFile(platformJoin(rootPath, dir, name))));
      if (isRecord(value)) return value;
    } catch {
      // A missing or unparsable config contributes nothing.
    }
  }
  return null;
}

/** The repository-relative directories a `workspace` field names, with a trailing `*` segment expanded. */
async function memberDirectories(rootPath: string, workspace: unknown): Promise<string[]> {
  const entries = isRecord(workspace) ? workspace.members : workspace;
  if (!Array.isArray(entries)) return [];
  const directories: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const path = normalize(entry);
    if (!path.endsWith(`${SLASH}${GLOB_MARK}`)) {
      directories.push(path);
      continue;
    }
    const parent = path.slice(0, -2);
    try {
      for await (const item of Deno.readDir(platformJoin(rootPath, parent))) {
        if (item.isDirectory) directories.push(join(parent, item.name));
      }
    } catch {
      // A missing glob root contributes no members.
    }
  }
  return directories;
}

/** The target of a relative value as a repository path; a directory target keeps its trailing slash. */
function targetOf(dir: string, value: string, isPrefix: boolean): string {
  const path = normalize(join(dir, value));
  return isPrefix && !path.endsWith(SLASH) ? `${path}${SLASH}` : path;
}

/** The import map entries of one config, then the exports of the package it names. */
function entriesOf(dir: string, config: ConfigRecord): [string, string][] {
  const entries: [string, string][] = [];
  if (isRecord(config.imports)) {
    for (const [key, value] of Object.entries(config.imports)) {
      if (typeof value !== "string" || !value.startsWith(ROOT_DIRECTORY)) continue;
      entries.push([key, targetOf(dir, value, key.endsWith(SLASH))]);
    }
  }
  if (typeof config.name !== "string") return entries;
  const exports = typeof config.exports === "string" ? { [EXPORT_ROOT]: config.exports } : config.exports;
  if (!isRecord(exports)) return entries;
  for (const [subpath, value] of Object.entries(exports)) {
    if (typeof value !== "string") continue;
    entries.push([`${config.name}${subpath === EXPORT_ROOT ? "" : subpath.slice(1)}`, targetOf(dir, value, false)]);
  }
  return entries;
}

/**
 * The alias map of the project configs, as import map keys to repository paths. A key that ends in a slash is a
 * directory prefix; any other key matches only itself. A key two configs map to different files is ambiguous.
 */
export async function readImportAliases(rootPath: string): Promise<Record<string, string>> {
  const root = await readConfig(rootPath, ROOT_DIRECTORY);
  const aliases: Record<string, string> = {};
  const add = (config: ConfigRecord | null, dir: string): void => {
    if (config === null) return;
    for (const [key, target] of entriesOf(dir, config)) {
      aliases[key] = key in aliases && aliases[key] !== target ? AMBIGUOUS_ALIAS : target;
    }
  };
  add(root, ROOT_DIRECTORY);
  for (const dir of await memberDirectories(rootPath, root?.workspace)) add(await readConfig(rootPath, dir), dir);
  return aliases;
}
