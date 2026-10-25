/**
 * @module DenoPolicyCommand
 * @path src/cli/commands/deno_policy.ts
 * @description The `deno-policy` route: turns a version 2 configuration into a complete offline Deno lint policy directory.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/cli/bundle_engine.ts, src/cli/unslop.ts, src/config/compile.ts, scripts/bundle.ts]
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-env --allow-run=deno,git src/cli/unslop.ts deno-policy --config=<file> --packs=typescript[,deno] --out=<dir>
 *
 * The directory holds the engine bundle, the catalog, a plugin entry, a Deno config, and a manifest.
 * `deno lint --config <dir>/deno.json` then runs the plugin offline.
 */

import { dirname, fromFileUrl, join, resolve, SEPARATOR, toFileUrl } from "@std/path";
import type { ICatalog, JsonValue } from "../../engine/catalog.ts";
import { parseCatalog } from "../../engine/catalog.ts";
import { createRuleRegistry, type IRulePack } from "../../engine/registry.ts";
import { compileConfig } from "../../config/compile.ts";
import type { IProjectDescriptor } from "../../config/descriptor.ts";
import { ConfigError } from "../../config/schema.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../../rules/mod.ts";
import { bundleEngine } from "../bundle_engine.ts";

/** The packs a policy directory can load, in the order the plugin lists them. */
export const DENO_POLICY_PACKS = ["typescript", "deno"] as const;

export type DenoPolicyPack = typeof DENO_POLICY_PACKS[number];

/** The version of the manifest layout. */
const MANIFEST_FORMAT_VERSION = 1;
const ENGINE_FILE = "unslop_engine.js";
const CATALOG_FILE = "catalog.json";
const PLUGIN_FILE = "plugin.ts";
const DENO_CONFIG_FILE = "deno.json";
const MANIFEST_FILE = "manifest.json";
const JSON_INDENT = 2;
const SUFFIX_LENGTH = 8;

const PACK_IDENTIFIERS: Readonly<Record<DenoPolicyPack, string>> = {
  typescript: "TYPESCRIPT_RULE_PACK",
  deno: "DENO_RULE_PACK",
};
const PACK_IMPLEMENTATIONS: Readonly<Record<DenoPolicyPack, IRulePack>> = {
  typescript: TYPESCRIPT_RULE_PACK,
  deno: DENO_RULE_PACK,
};

/** Failure of one policy build. A usage failure comes from the caller's input, not from the content. */
export class DenoPolicyError extends Error {
  readonly usage: boolean;

  constructor(message: string, usage = false) {
    super(message);
    this.name = "DenoPolicyError";
    this.usage = usage;
  }
}

/** Produces the engine library file. A test replaces it to skip the slow real bundle. */
export interface IEngineBundler {
  bundle(outFile: string): Promise<void>;
}

export interface IDenoPolicyOptions {
  /** Path of the version 2 configuration file. */
  readonly config: string;
  /** Pack names to load. `typescript` is required, and `deno` is optional. */
  readonly packs: readonly string[];
  /** The policy directory to create, or to replace when it holds a previous build. */
  readonly out: string;
  readonly bundler?: IEngineBundler;
}

/** One file of the policy directory as the manifest records it. */
export interface IDenoPolicyFileHash {
  readonly sha256: string;
  readonly bytes: number;
}

export interface IDenoPolicyManifest {
  readonly format_version: number;
  readonly deno_version: string;
  readonly plugin: string;
  readonly packs: readonly DenoPolicyPack[];
  readonly engine: { readonly package_version: string; readonly git_sha?: string };
  readonly files: Readonly<Record<string, IDenoPolicyFileHash>>;
}

export interface IDenoPolicyReport {
  readonly out: string;
  readonly files: readonly string[];
  readonly manifest: IDenoPolicyManifest;
}

const ENGINE_ROOT = fromFileUrl(new URL("../../../", import.meta.url));

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkedPacks(packs: readonly string[]): readonly DenoPolicyPack[] {
  const known = new Set<string>(DENO_POLICY_PACKS);
  const unknown = packs.filter((pack) => !known.has(pack));
  if (unknown.length > 0) {
    throw new DenoPolicyError(`unknown pack '${unknown[0]}'; use ${DENO_POLICY_PACKS.join(", ")}`, true);
  }
  if (new Set(packs).size !== packs.length) throw new DenoPolicyError("a pack is listed twice", true);
  if (!packs.includes("typescript")) throw new DenoPolicyError("the typescript pack is required", true);
  return DENO_POLICY_PACKS.filter((pack) => packs.includes(pack));
}

async function readConfig(path: string): Promise<{ config: JsonValue; plugin: string }> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    throw new DenoPolicyError(`${path}: cannot read the configuration`);
  }
  let config: JsonValue;
  try {
    config = JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new DenoPolicyError(`${path}: invalid JSON (${messageOf(error)})`);
  }
  const plugin = typeof config === "object" && config !== null && !Array.isArray(config) ? config.plugin : undefined;
  if (typeof plugin !== "string" || plugin.length === 0) {
    throw new DenoPolicyError(`${path}: the configuration needs a 'plugin' name`);
  }
  return { config, plugin };
}

function policyDescriptor(plugin: string, packs: readonly IRulePack[], out: string): IProjectDescriptor {
  const rootUrl = toFileUrl(out.endsWith(SEPARATOR) ? out : `${out}${SEPARATOR}`);
  return {
    pluginName: plugin,
    rootUrl,
    configUrl: new URL(CATALOG_FILE, rootUrl),
    lintConfigUrl: new URL(DENO_CONFIG_FILE, rootUrl),
    pluginUrl: new URL(PLUGIN_FILE, rootUrl),
    packs,
    scriptRules: {},
    wholeTreeHosts: {},
  };
}

/** Keeps the plugin rules and the tags they use. A policy directory runs no script rule. */
function projectCatalog(catalog: ICatalog): ICatalog {
  const rules: ICatalog["rules"] = {};
  for (const id of Object.keys(catalog.rules).sort()) {
    if (catalog.rules[id].engine === "plugin") rules[id] = catalog.rules[id];
  }
  const usedTags = new Set(Object.values(rules).flatMap((entry) => entry.tags));
  const tagVocabulary: ICatalog["tagVocabulary"] = {};
  for (const tag of Object.keys(catalog.tagVocabulary).sort()) {
    if (usedTags.has(tag)) tagVocabulary[tag] = catalog.tagVocabulary[tag];
  }
  return {
    version: catalog.version,
    scopes: { test: [...catalog.scopes.test], fixture: [...catalog.scopes.fixture] },
    tagVocabulary,
    rules,
  };
}

function compileCatalog(config: JsonValue, plugin: string, packs: readonly DenoPolicyPack[], out: string): ICatalog {
  const implementations = packs.map((pack) => PACK_IMPLEMENTATIONS[pack]);
  let compiled: ICatalog;
  try {
    compiled = compileConfig(config, policyDescriptor(plugin, implementations, out)).catalog;
  } catch (error) {
    const detail = error instanceof ConfigError ? error.message : messageOf(error);
    throw new DenoPolicyError(`configuration compilation failed: ${detail}`);
  }
  try {
    return parseCatalog(projectCatalog(compiled) as JsonValue, {
      scriptRuleSchemas: null,
      registry: createRuleRegistry(plugin, implementations),
    });
  } catch (error) {
    throw new DenoPolicyError(`catalog validation failed: ${messageOf(error)}`);
  }
}

/** The plugin entry: it loads the shared engine bundle, so the directory needs no import from outside. */
function pluginSource(plugin: string, packs: readonly DenoPolicyPack[]): string {
  const identifiers = packs.map((pack) => PACK_IDENTIFIERS[pack]).join(", ");
  const name = JSON.stringify(plugin);
  return [
    "// Generated by `unslop deno-policy`. Do not edit.",
    `import { createDenoPlugin, createRuleRegistry, parseCatalog, ${identifiers} } from "./${ENGINE_FILE}";`,
    `import catalogJson from "./${CATALOG_FILE}" with { type: "json" };`,
    `const catalog = parseCatalog(catalogJson, { scriptRuleSchemas: null, registry: createRuleRegistry(${name}, [${identifiers}]) });`,
    `export default createDenoPlugin(${name}, catalog, { rulePacks: [${identifiers}], selection: "" });`,
    "",
  ].join("\n");
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enginePackageVersion(): Promise<string> {
  const config = JSON.parse(await Deno.readTextFile(join(ENGINE_ROOT, "deno.json"))) as { version?: string };
  return config.version ?? "unknown";
}

/** The engine commit when `git` can resolve it, or undefined. A missing permission or checkout is not an error. */
async function engineGitSha(): Promise<string | undefined> {
  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd: ENGINE_ROOT,
      stdout: "piped",
      stderr: "null",
    }).output();
    const sha = new TextDecoder().decode(result.stdout).trim();
    return result.success && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

async function pathKind(path: string): Promise<"missing" | "empty" | "policy" | "other"> {
  let entries: string[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(path)) entries.push(entry.name);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "missing";
    return "other";
  }
  if (entries.length === 0) return "empty";
  return entries.includes(MANIFEST_FILE) && entries.includes(PLUGIN_FILE) ? "policy" : "other";
}

function assertSafeOut(out: string): void {
  if (ENGINE_ROOT === `${out}${SEPARATOR}` || ENGINE_ROOT.startsWith(`${out}${SEPARATOR}`)) {
    throw new DenoPolicyError("--out must not be the engine directory or one of its parents", true);
  }
}

/** Replaces `out` by `staging` with rename, and restores the old directory when the second rename fails. */
async function swapIn(staging: string, out: string, suffix: string): Promise<void> {
  const previous = (await pathKind(out)) === "missing" ? null : `${out}.old-${suffix}`;
  if (previous !== null) await Deno.rename(out, previous);
  try {
    await Deno.rename(staging, out);
  } catch (error) {
    if (previous !== null) await Deno.rename(previous, out);
    throw new DenoPolicyError(`cannot install the policy directory: ${messageOf(error)}`);
  }
  if (previous !== null) await Deno.remove(previous, { recursive: true });
}

/** Builds the policy directory in a staging directory and installs it with a rename. */
export async function buildDenoPolicy(options: IDenoPolicyOptions): Promise<IDenoPolicyReport> {
  const packs = checkedPacks(options.packs);
  const out = resolve(options.out);
  assertSafeOut(out);
  const existing = await pathKind(out);
  if (existing === "other") {
    throw new DenoPolicyError(`${out}: not a policy directory; remove it or choose another --out`, true);
  }
  const { config, plugin } = await readConfig(options.config);
  const catalog = compileCatalog(config, plugin, packs, out);
  const suffix = crypto.randomUUID().slice(0, SUFFIX_LENGTH);
  const staging = `${out}.tmp-${suffix}`;
  try {
    await Deno.mkdir(dirname(out), { recursive: true });
    await Deno.mkdir(staging);
    const bundler: IEngineBundler = options.bundler ?? { bundle: (file) => bundleEngine(ENGINE_ROOT, file) };
    try {
      await bundler.bundle(join(staging, ENGINE_FILE));
    } catch (error) {
      throw new DenoPolicyError(`engine bundle failed: ${messageOf(error)}`);
    }
    const encoder = new TextEncoder();
    const contents: Record<string, Uint8Array> = {
      [CATALOG_FILE]: encoder.encode(jsonText(catalog)),
      [PLUGIN_FILE]: encoder.encode(pluginSource(plugin, packs)),
      [DENO_CONFIG_FILE]: encoder.encode(jsonText({ lock: false, lint: { plugins: [`./${PLUGIN_FILE}`] } })),
    };
    for (const [name, bytes] of Object.entries(contents)) await Deno.writeFile(join(staging, name), bytes);
    contents[ENGINE_FILE] = await Deno.readFile(join(staging, ENGINE_FILE));
    const files: Record<string, IDenoPolicyFileHash> = {};
    for (const name of Object.keys(contents).sort()) {
      files[name] = { sha256: await sha256Hex(contents[name]), bytes: contents[name].byteLength };
    }
    const gitSha = await engineGitSha();
    const manifest: IDenoPolicyManifest = {
      format_version: MANIFEST_FORMAT_VERSION,
      deno_version: Deno.version.deno,
      plugin,
      packs,
      engine: { package_version: await enginePackageVersion(), ...(gitSha === undefined ? {} : { git_sha: gitSha }) },
      files,
    };
    await Deno.writeTextFile(join(staging, MANIFEST_FILE), jsonText(manifest));
    await swapIn(staging, out, suffix);
    return { out, files: Object.keys(files).concat(MANIFEST_FILE).sort(), manifest };
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => {});
  }
}
