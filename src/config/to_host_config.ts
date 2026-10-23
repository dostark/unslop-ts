/**
 * @module ToHostConfig
 * @path src/config/to_host_config.ts
 * @description Maps a compiled version 2 configuration onto an ESLint or Oxlint config fragment.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/config/compile.ts, src/config/descriptor.ts, src/cli/unslop.ts, eslint.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";
import { ENGINE_DOCS_URL } from "../rules/meta.ts";
import type { ICompiledConfig, IResolvedRule } from "./descriptor.ts";

/** A host the generator writes for. */
export type HostId = "eslint" | "oxlint";

/** A generated severity. A v2 plugin rule is `error` or `off`. */
export type HostSeverity = "error" | "off";

/** One generated rule setting. */
export type HostRuleSetting = HostSeverity | readonly [HostSeverity, Readonly<Record<string, JsonValue>>];

/** The `settings.unslop` block a generated fragment carries. */
export interface IHostConfigSettings {
  readonly testGlobs: readonly string[];
  readonly fixtureGlobs: readonly string[];
  readonly ignoreGlobs: readonly string[];
  readonly docsBase: string;
  readonly docs: Readonly<Record<string, string>>;
}

/** One rule group with the same path restrictions. */
export interface IHostConfigGroup {
  readonly files: readonly (string | readonly string[])[] | null;
  readonly excludedFiles: readonly string[] | null;
  readonly rules: Readonly<Record<string, HostRuleSetting>>;
}

/** The generated fragment. */
export interface IHostConfigFragment {
  readonly host: HostId;
  readonly groups: readonly IHostConfigGroup[];
  readonly settings: IHostConfigSettings;
  /** Rules the host cannot run: script rules and whole-tree checks. */
  readonly skipped: readonly string[];
}

/** A rule whose scope the chosen host cannot express. */
export class HostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostConfigError";
  }
}

const ALL_FILES = ["**/*"];

function severityOf(rule: IResolvedRule): HostSeverity {
  return rule.configuredLevel === "off" ? "off" : "error";
}

function settingOf(rule: IResolvedRule): HostRuleSetting {
  const severity = severityOf(rule);
  const options = rule.effectiveOptions;
  if (options === null || Object.keys(options).length === 0) return severity;
  return [severity, options];
}

function filesOf(
  rule: IResolvedRule,
  config: ICompiledConfig,
  host: HostId,
): readonly (string | readonly string[])[] | null {
  if (rule.scope === "test") {
    const globs = config.catalog.scopes.test;
    if (globs.length === 0) {
      throw new HostConfigError(`${rule.id}: ${host} cannot express the test scope without test globs`);
    }
    const included = rule.include;
    if (included === null) return globs;
    if (included.length === 0) {
      throw new HostConfigError(`${rule.id}: ${host} cannot express an empty include list`);
    }
    if (host === "oxlint") {
      throw new HostConfigError(`${rule.id}: Oxlint cannot express both test scope and include globs`);
    }
    return globs.flatMap((testGlob) => included.map((includeGlob) => [testGlob, includeGlob]));
  }
  return rule.include;
}

function excludedFilesOf(rule: IResolvedRule, config: ICompiledConfig): readonly string[] | null {
  const excluded = [...(rule.exclude ?? [])];
  if (rule.scope === "prod") excluded.push(...config.catalog.scopes.test, ...config.catalog.scopes.fixture);
  return excluded.length > 0 ? excluded : null;
}

function groupKey(files: IHostConfigGroup["files"], excluded: readonly string[] | null): string {
  return JSON.stringify([files, excluded]);
}

/** Maps a compiled configuration onto the host fragment. Throws when a scope is inexpressible. */
export function toHostConfig(compiled: ICompiledConfig, host: HostId): IHostConfigFragment {
  const groups = new Map<
    string,
    {
      files: IHostConfigGroup["files"];
      excludedFiles: readonly string[] | null;
      rules: Record<string, HostRuleSetting>;
    }
  >();
  const docs: Record<string, string> = {};
  const skipped: string[] = [];
  for (const rule of Object.values(compiled.rules)) {
    if (rule.engine !== "plugin") {
      skipped.push(rule.id);
      continue;
    }
    const files = filesOf(rule, compiled, host);
    const excluded = excludedFilesOf(rule, compiled);
    const key = groupKey(files, excluded);
    const group = groups.get(key) ?? { files, excludedFiles: excluded, rules: {} };
    group.rules[rule.id] = settingOf(rule);
    groups.set(key, group);
    docs[rule.id] = rule.docs;
  }
  const settings: IHostConfigSettings = {
    testGlobs: [...compiled.catalog.scopes.test],
    fixtureGlobs: [...compiled.catalog.scopes.fixture],
    ignoreGlobs: (compiled.catalog.ignore ?? []).map((entry) => entry.glob),
    docsBase: ENGINE_DOCS_URL,
    docs,
  };
  return { host, groups: [...groups.values()], settings, skipped };
}

function rulesJson(rules: Readonly<Record<string, HostRuleSetting>>): string {
  const entries = Object.entries(rules).map(([id, setting]) =>
    `      ${JSON.stringify(id)}: ${JSON.stringify(setting)}`
  );
  return entries.join(",\n");
}

/** Renders the ESLint flat-config module. */
export function renderEslintFragment(fragment: IHostConfigFragment, pluginName: string): string {
  const settings = JSON.stringify(fragment.settings, null, 2)
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n")
    .trimStart();
  const configs = fragment.groups.map((group) => {
    const files = group.files === null ? "" : `    files: ${JSON.stringify(group.files)},\n`;
    const excluded = group.excludedFiles === null ? "" : `    ignores: ${JSON.stringify(group.excludedFiles)},\n`;
    return `  {
    plugins: { ${JSON.stringify(pluginName)}: unslop },
${files}${excluded}    settings: {
      unslop: ${settings},
    },
    rules: {
${rulesJson(group.rules)}
    },
  }`;
  });
  return [
    "// Generated by unslop config export for the ESLint host. Do not edit.",
    `import { createEslintPlugin } from "@dostark/unslop-ts/eslint";`,
    `import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";`,
    "",
    `const unslop = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: ${
      JSON.stringify(pluginName)
    } });`,
    "",
    `export default [\n${configs.join(",\n")}\n];`,
    "",
  ].join("\n");
}

/** Renders the Oxlint configuration fragment. */
export function renderOxlintFragment(fragment: IHostConfigFragment): string {
  const rules: Record<string, HostRuleSetting> = {};
  const overrides: {
    files: readonly string[];
    excludeFiles?: readonly string[];
    rules: Record<string, HostRuleSetting>;
  }[] = [];
  for (const group of fragment.groups) {
    if (group.files === null && group.excludedFiles === null) {
      Object.assign(rules, group.rules);
      continue;
    }
    const files = group.files ?? ALL_FILES;
    if (!files.every((pattern): pattern is string => typeof pattern === "string")) {
      throw new HostConfigError("Oxlint cannot express intersected file patterns");
    }
    overrides.push({
      files,
      ...(group.excludedFiles === null ? {} : { excludeFiles: group.excludedFiles }),
      rules: { ...group.rules },
    });
  }
  const document: Record<string, unknown> = {
    jsPlugins: ["./unslop.plugin.mjs"],
    rules,
    settings: { unslop: fragment.settings },
  };
  if (overrides.length > 0) document.overrides = overrides;
  return `${JSON.stringify(document, null, 2)}\n`;
}
