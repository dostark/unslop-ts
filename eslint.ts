/**
 * @module EslintAdapter
 * @path eslint.ts
 * @description ESLint and Oxlint adapter: maps the host rule context onto the runtime-neutral rule contract.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [mod.ts, deno.ts, src/engine/rule_gate.ts]
 */

import { z } from "zod";
import { asJsonRecord, classifyPath, type ICatalogScopes, PATH_CLASS } from "./src/engine/catalog.ts";
import { matchesAnyGlob } from "./src/engine/glob.ts";
import { relative, resolve } from "./src/engine/posix_path.ts";
import type { IRulePack } from "./src/engine/registry.ts";
import { asNode } from "./src/engine/type_environment.ts";
import { ENGINE_DOCS_URL, type RuleCategory } from "./src/rules/meta.ts";
import type { IRuleContext, IRuleNode, IRuleReport, IRuleSourceCode } from "./src/rules/types.ts";

export { ENGINE_DOCS_URL };

/** The ESLint rule type of each category. */
export const ESLINT_RULE_TYPE: Readonly<Record<RuleCategory, "problem" | "suggestion">> = {
  "type-safety": "problem",
  "imports": "problem",
  "boundaries": "problem",
  "interfaces": "suggestion",
  "magic-values": "suggestion",
  "module-structure": "suggestion",
  "test-quality": "suggestion",
  "scripts": "suggestion",
  "complexity": "suggestion",
  "optional-parameters": "suggestion",
  "comments": "suggestion",
};
/** Separates the message from the hint under a host with no hint field. */
export const HINT_SEPARATOR = " Hint: ";
/** The suppression dialects the adapter understands. */
export const DEFAULT_DIALECTS = ["eslint", "oxlint"] as const;

/** A named adapter failure. */
export class EslintAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EslintAdapterError";
  }
}

interface IEslintComment {
  readonly type: "Line" | "Block";
  readonly range: readonly [number, number];
  readonly value: string;
}

interface IEslintPosition {
  readonly line: number;
  readonly column: number;
}

/** The subset of the ESLint source code the adapter reads. */
export interface IEslintSourceCode {
  readonly text: string;
  readonly ast: unknown;
  getText(node?: unknown): string;
  getAllComments(): readonly IEslintComment[];
  getCommentsBefore(node: unknown): readonly IEslintComment[];
  getLocFromIndex(index: number): IEslintPosition;
}

/** The subset of an ESLint report descriptor the adapter writes. */
export interface IEslintReportDescriptor {
  readonly node?: unknown;
  readonly loc?: { readonly start: IEslintPosition; readonly end: IEslintPosition };
  readonly message: string;
}

/** The subset of the ESLint rule context the adapter reads. */
export interface IEslintContext {
  readonly cwd: string;
  readonly filename: string;
  readonly options: readonly unknown[];
  readonly settings?: unknown;
  readonly sourceCode: IEslintSourceCode;
  report(descriptor: IEslintReportDescriptor): void;
}

/** The ESLint rule shape the adapter emits. */
export interface IEslintRule {
  readonly meta: {
    readonly type: "problem" | "suggestion";
    readonly docs: { readonly url: string };
    readonly schema: readonly unknown[];
    readonly defaultOptions: readonly unknown[];
  };
  create(context: IEslintContext): Record<string, (node: IRuleNode) => void>;
}

/** The `settings.unslop` defaults a preset carries. */
const PRESET_SETTINGS: IUnslopSettings = {
  testGlobs: ["**/*_test.ts", "**/tests/**"],
  fixtureGlobs: ["**/tests/fixtures/**"],
  ignoreGlobs: [],
  docsBase: ENGINE_DOCS_URL,
  docs: {},
};

/** One additive flat-config preset. */
export interface IEslintConfig {
  readonly plugins: { readonly unslop: IEslintPlugin };
  readonly settings: { readonly unslop: IUnslopSettings };
  readonly rules: Readonly<Record<string, "warn" | "error" | "off">>;
}

/** The ESLint plugin shape the adapter emits. */
export interface IEslintPlugin {
  readonly meta: { readonly name: string };
  readonly rules: Readonly<Record<string, IEslintRule>>;
  readonly configs: Readonly<Record<string, IEslintConfig>>;
}

/** The `settings.unslop` block the adapter reads. */
export interface IUnslopSettings {
  readonly root?: string;
  readonly docs?: Readonly<Record<string, string>>;
  readonly docsBase?: string;
  readonly testGlobs?: readonly string[];
  readonly fixtureGlobs?: readonly string[];
  readonly ignoreGlobs?: readonly string[];
}

/** The options of {@link createEslintPlugin}. */
export interface IEslintPluginOptions {
  readonly name: string;
}

function unslopSettings(settings: unknown): IUnslopSettings | null {
  if (settings === null || typeof settings !== "object") return null;
  const value = (settings as { unslop?: unknown }).unslop;
  return value !== null && typeof value === "object" ? value as IUnslopSettings : null;
}

function scopesOf(settings: IUnslopSettings | null): ICatalogScopes {
  return { test: [...(settings?.testGlobs ?? [])], fixture: [...(settings?.fixtureGlobs ?? [])] };
}

function repoPathOf(context: IEslintContext, settings: IUnslopSettings | null): string {
  const root = settings?.root === undefined ? context.cwd : resolve(context.cwd, settings.root);
  return relative(root, context.filename).split("\\").join("/");
}

function codeStyleOf(settings: IUnslopSettings | null, key: string, docs: string): string {
  const override = settings?.docs?.[key];
  if (override !== undefined) return override;
  return `${settings?.docsBase ?? ENGINE_DOCS_URL}${docs}`;
}

function sourceCodeOf(context: IEslintContext): IRuleSourceCode {
  return {
    text: context.sourceCode.text,
    ast: asNode(context.sourceCode.ast),
    getText: (node) => context.sourceCode.getText(node),
    getAllComments: () => context.sourceCode.getAllComments(),
    getCommentsBefore: (node) => context.sourceCode.getCommentsBefore(node),
  };
}

function messageOf(descriptor: IRuleReport): string {
  return descriptor.hint === undefined
    ? descriptor.message
    : `${descriptor.message}${HINT_SEPARATOR}${descriptor.hint}`;
}

function reportWith(context: IEslintContext, descriptor: IRuleReport): void {
  const message = messageOf(descriptor);
  if (descriptor.node !== undefined) {
    context.report({ node: descriptor.node, message });
    return;
  }
  const range = descriptor.range;
  if (range === undefined) {
    context.report({ message });
    return;
  }
  const sourceCode = context.sourceCode;
  context.report({
    loc: { start: sourceCode.getLocFromIndex(range[0]), end: sourceCode.getLocFromIndex(range[1]) },
    message,
  });
}

function ruleOf(
  pack: IRulePack,
  key: string,
  options: IEslintPluginOptions,
): IEslintRule | null {
  const rule = pack.rules[key];
  if (rule === undefined) return null;
  const schema = pack.optionSchemas[key];
  const jsonSchema = schema === undefined ? {} : z.toJSONSchema(schema, { io: "input", target: "draft-04" });
  return {
    meta: {
      type: ESLINT_RULE_TYPE[rule.meta.category],
      docs: { url: ENGINE_DOCS_URL + rule.meta.docs },
      schema: [jsonSchema],
      defaultOptions: [schema === undefined ? {} : schema.parse({})],
    },
    create(context) {
      const settings = unslopSettings(context.settings);
      if (rule.requiresTestGlobs && settings === null) {
        throw new EslintAdapterError(`rule '${key}' needs settings.unslop with testGlobs`);
      }
      const repoPath = repoPathOf(context, settings);
      const pathClass = classifyPath(repoPath, scopesOf(settings));
      if (matchesAnyGlob(repoPath, settings?.ignoreGlobs ?? [])) return {};
      if (pathClass === PATH_CLASS.fixture) return {};
      const parsed = schema === undefined ? {} : schema.parse(context.options[0] ?? {});
      const structural: IRuleContext = {
        filename: context.filename,
        sourceCode: sourceCodeOf(context),
        report: (descriptor) => reportWith(context, descriptor),
      };
      return rule.create(structural, {
        options: asJsonRecord(parsed),
        repoPath,
        isTestFile: pathClass === PATH_CLASS.test,
        codeStyle: codeStyleOf(settings, key, rule.meta.docs),
        pluginName: options.name,
        dialects: DEFAULT_DIALECTS,
      });
    },
  };
}

/** The rule keys of a pack whose metadata preset is one of the memberships. */
function membershipKeys(pack: IRulePack, memberships: readonly string[]): string[] {
  return Object.entries(pack.rules)
    .filter(([, rule]) => memberships.includes(rule.meta.preset))
    .map(([key]) => key);
}

function presetRules(
  pack: IRulePack,
  memberships: readonly string[],
  severity: "warn" | "error",
): Record<string, "warn" | "error"> {
  return Object.fromEntries(membershipKeys(pack, memberships).map((key) => [`unslop/${key}`, severity]));
}

function presetConfig(
  plugin: IEslintPlugin,
  rules: Readonly<Record<string, "warn" | "error" | "off">>,
): IEslintConfig {
  return { plugins: { unslop: plugin }, settings: { unslop: PRESET_SETTINGS }, rules };
}

function buildConfigs(
  plugin: IEslintPlugin,
  typescript: IRulePack,
  deno: IRulePack | undefined,
): Record<string, IEslintConfig> {
  const strictAll = {
    ...presetRules(typescript, ["recommended", "strict"], "warn"),
    ...(deno === undefined ? {} : presetRules(deno, ["recommended", "strict"], "warn")),
  };
  const duplicates = Object.entries(typescript.rules)
    .filter(([, rule]) =>
      rule.overlaps.some((overlap) => overlap.ecosystem === "typescript-eslint" && overlap.kind === "duplicate")
    )
    .map(([key]) => key);
  return {
    "recommended": presetConfig(plugin, presetRules(typescript, ["recommended"], "warn")),
    "strict": presetConfig(plugin, presetRules(typescript, ["recommended", "strict"], "warn")),
    "deno": presetConfig(plugin, strictAll),
    "strict-error": presetConfig(plugin, presetRules(typescript, ["recommended", "strict"], "error")),
    "typescript-eslint-compat": presetConfig(plugin, {
      ...Object.fromEntries(duplicates.map((key) => [`unslop/${key}`, "off" as const])),
    }),
  };
}

/** Builds an ESLint or Oxlint plugin from the registered rule packs. */
export function createEslintPlugin(packs: readonly IRulePack[], options: IEslintPluginOptions): IEslintPlugin {
  const rules: Record<string, IEslintRule> = {};
  for (const pack of packs) {
    for (const key of Object.keys(pack.rules)) {
      const rule = ruleOf(pack, key, options);
      if (rule !== null) rules[key] = rule;
    }
  }
  const typescript = packs.find((pack) => pack.name === "typescript") ?? packs[0];
  const deno = packs.find((pack) => pack.name === "deno");
  const plugin: IEslintPlugin = { meta: { name: options.name }, rules, configs: {} };
  return { ...plugin, configs: buildConfigs(plugin, typescript, deno) };
}
