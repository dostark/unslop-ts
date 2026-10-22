/**
 * @module ConfigCompileTest
 * @path tests/config_compile_test.ts
 * @description Version 2 configuration compilation: preset expansion, option validation, capability refusal, catalog emission, and field origins.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/config/schema.ts, src/config/compile.ts, src/config/registry.ts, src/config/presets.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  compileConfig,
  ConfigError,
  DENO_RULE_PACK,
  type ICompiledConfig,
  type IProjectDescriptor,
  type IRuleControls,
  type IRuleMeta,
  type IScriptRuleSpec,
  type JsonValue,
  parseCatalog,
  parseWholeTreeSettings,
  TYPESCRIPT_RULE_PACK,
} from "../mod.ts";
import { testDescriptor } from "./helpers/descriptor.ts";
import { TEST_REGISTRY } from "./helpers/registry.ts";

const DOCS_BASE = "https://example.test/guide/";
const NOT_ENABLED = "Not enabled by the configuration.";
const PLUGIN_PREFIX = "demo/";
const BOTH_PACK_COUNTS = { recommended: 13, strict: 34 };
const TYPESCRIPT_PACK_COUNTS = { recommended: 11, strict: 32 };
const PLUGIN_RULE_COUNT = 39;
const DESCRIPTOR_RULE_COUNT = 45;
const OPTIONAL_PARAMS_OPTIONS = {
  wrapperType: "Opt",
  wrapperImport: "@demo/types",
  reasonExamples: ["OptionalContext"],
  testSegments: ["/tests/"],
  testSuffixes: ["_test.ts"],
  skipSegments: ["/fixtures/"],
  walkSkipSegments: ["/vendor/"],
  pluginRuleId: "demo/require-optional-wrapper",
};
const SCRIPT_META: IRuleMeta = {
  description: "A consumer script rule.",
  category: "scripts",
  docs: "#consumer-guide",
  preset: "opt-in",
  limits: null,
};
const SCRIPT_CONTROLS: IRuleControls = {
  editable: ["level"],
  fixedLevel: null,
  fixedScope: null,
  fixedInclude: null,
  fixedExclude: null,
  hostModes: { default: "warn" },
};

function compile(config: JsonValue, descriptor?: IProjectDescriptor): ICompiledConfig {
  return compileConfig(config, descriptor ?? testDescriptor());
}

/** Serializes and parses a value so the legacy parsers see plain JSON, as they do from disk. */
function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function minimal(extra?: JsonValue): JsonValue {
  const base = { version: 2, plugin: "demo" };
  return (extra === undefined ? base : { ...base, ...(extra as Record<string, JsonValue>) }) as JsonValue;
}

function pluginIds(): string[] {
  return [
    ...Object.keys(TYPESCRIPT_RULE_PACK.rules).map((key) => `${PLUGIN_PREFIX}${key}`),
    ...Object.keys(DENO_RULE_PACK.rules).map((key) => `${PLUGIN_PREFIX}${key}`),
  ];
}

function activeCount(compiled: ICompiledConfig): number {
  return Object.values(compiled.rules).filter((rule) => rule.configuredLevel !== "off").length;
}

function scriptRule(): IScriptRuleSpec {
  return {
    meta: SCRIPT_META,
    optionSchema: null,
    controls: SCRIPT_CONTROLS,
    command: ["deno", "task", "check:extra"],
  };
}

function errorPath(run: () => unknown): string {
  return assertThrows(run, ConfigError).path;
}

Deno.test("level_tuple_and_long_form_compile_to_the_same_entry", () => {
  const shortForm = compile(minimal({ rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: "error" } }));
  const emptyTuple = compile(minimal({ rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: ["error", {}] } }));
  const longForm = compile(minimal({ rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: { level: "error" } } }));
  const id = `${PLUGIN_PREFIX}no-explicit-unknown`;
  assertEquals(emptyTuple.rules[id], shortForm.rules[id]);
  assertEquals(longForm.rules[id], shortForm.rules[id]);
  assertEquals(emptyTuple.catalog.rules[id], shortForm.catalog.rules[id]);

  const tupleOptions = compile(
    minimal({ rules: { [id]: ["error", { allowCatchBinding: false }] } }),
  );
  const longOptions = compile(
    minimal({ rules: { [id]: { level: "error", options: { allowCatchBinding: false } } } }),
  );
  assertEquals(tupleOptions.rules[id], longOptions.rules[id]);
  assertEquals(tupleOptions.rules[id].effectiveOptions, {
    allowCatchBinding: false,
    allowTypePredicateSubject: true,
  });
  assertEquals(tupleOptions.rules[id].sources.fields.options, `config:rules.${id}`);
  assertEquals(shortForm.rules[id].sources.fields.options, "default");
  assertEquals(shortForm.rules[id].reason, null);
  assertEquals(shortForm.catalog.rules[id].reason, undefined);
});

Deno.test("presets_expand_by_membership", () => {
  const bothRecommended = compile(minimal({ extends: ["unslop:recommended"] }));
  const bothStrict = compile(minimal({ extends: ["unslop:strict"] }));
  assertEquals(activeCount(bothRecommended), BOTH_PACK_COUNTS.recommended);
  assertEquals(activeCount(bothStrict), BOTH_PACK_COUNTS.strict);

  const typescriptOnly = testDescriptor({ packs: [TYPESCRIPT_RULE_PACK] });
  assertEquals(
    activeCount(compile(minimal({ extends: ["unslop:recommended"] }), typescriptOnly)),
    TYPESCRIPT_PACK_COUNTS.recommended,
  );
  assertEquals(
    activeCount(compile(minimal({ extends: ["unslop:strict"] }), typescriptOnly)),
    TYPESCRIPT_PACK_COUNTS.strict,
  );

  assertEquals(bothStrict.catalog.wholeTree?.optionalParams, undefined);
  assertEquals(bothStrict.catalog.wholeTree?.unusedExports, undefined);
  assertEquals(bothStrict.catalog.wholeTree?.constantRestatement, undefined);
  assertEquals(parseWholeTreeSettings(asJson(bothStrict.catalog)).magicLiterals?.checkNumbers, true);
  assertEquals(bothStrict.rules["optional-params"].configuredLevel, "off");
  assertEquals(bothStrict.rules["unused-exports"].configuredLevel, "off");
});

Deno.test("invalid_configs_report_the_field", () => {
  const cases: { run: () => unknown; path: string }[] = [
    {
      run: () => compile(minimal({ rules: { [`${PLUGIN_PREFIX}missing`]: "error" } })),
      path: `rules.${PLUGIN_PREFIX}missing`,
    },
    {
      run: () => compile(minimal({ rules: { [`${PLUGIN_PREFIX}max-params`]: ["error", { nope: 1 }] } })),
      path: `rules.${PLUGIN_PREFIX}max-params.options.nope`,
    },
    {
      run: () => compile(minimal({ rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: "warn" } })),
      path: `rules.${PLUGIN_PREFIX}no-explicit-unknown.level`,
    },
    {
      run: () => compile(minimal({ rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: "off" } })),
      path: `rules.${PLUGIN_PREFIX}no-explicit-unknown.reason`,
    },
    {
      run: () =>
        compile(minimal({
          tags: { "prod-only": { description: "Production only.", requiresScope: ["prod"] } },
          rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: { level: "error", tags: ["prod-only"] } },
        })),
      path: `rules.${PLUGIN_PREFIX}no-explicit-unknown.tags.prod-only`,
    },
    {
      run: () => compile(minimal({ rules: { "duplicate-type": "warn" } })),
      path: "rules.duplicate-type.level",
    },
    {
      run: () => compile(minimal({ rules: { "other/missing": "error" } })),
      path: "rules.other/missing",
    },
    {
      run: () =>
        compile(minimal({
          rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: { level: "error", tags: ["undefined-tag"] } },
        })),
      path: `rules.${PLUGIN_PREFIX}no-explicit-unknown.tags`,
    },
    {
      run: () =>
        compile(
          minimal({
            rules: { [`${PLUGIN_PREFIX}no-explicit-unknown`]: { level: "error", exclusionCodes: { A: "b" } } },
          }),
        ),
      path: `rules.${PLUGIN_PREFIX}no-explicit-unknown.exclusionCodes`,
    },
    {
      run: () => compile(minimal({ extends: ["unslop:unknown"] })),
      path: "extends.0",
    },
    {
      run: () => compile(minimal({ paths: { ignore: [{ glob: "vendor/**" }] } })),
      path: "paths.ignore.0.reason",
    },
    {
      run: () => compile({ version: 2, plugin: "other" } as JsonValue),
      path: "plugin",
    },
    {
      run: () => compile(minimal(), testDescriptor({ scriptRules: { "optional-params": scriptRule() } })),
      path: "scriptRules.optional-params",
    },
    {
      run: () =>
        compile(
          minimal(),
          testDescriptor({ wholeTreeHosts: { "magic-literals": { controls: SCRIPT_CONTROLS, command: ["x"] } } }),
        ),
      path: "wholeTreeHosts.magic-literals",
    },
  ];
  for (const { run, path } of cases) assertEquals(errorPath(run), path);
});

Deno.test("inactive_whole_tree_needs_no_project_defaults", () => {
  const compiled = compile(minimal());
  for (const id of ["optional-params", "unused-exports", "constant-restatement"]) {
    const rule = compiled.rules[id];
    assertEquals(rule.configuredOptions, {});
    assertEquals(rule.defaultOptions, null);
    assertEquals(rule.effectiveOptions, null);
    assertEquals(rule.configuredLevel, "off");
  }
  assertEquals(compiled.rules["magic-literals"].defaultOptions !== null, true);
  assertEquals(compiled.rules["magic-literals"].effectiveOptions, null);
  assertEquals(compiled.catalog.wholeTree, undefined);

  const configured = compile(minimal({ rules: { "optional-params": ["warn", OPTIONAL_PARAMS_OPTIONS] } }));
  assertEquals(configured.catalog.wholeTree?.optionalParams, OPTIONAL_PARAMS_OPTIONS);

  const { wrapperImport: _omitted, ...incomplete } = OPTIONAL_PARAMS_OPTIONS;
  assertEquals(
    errorPath(() => compile(minimal({ rules: { "optional-params": ["warn", incomplete] } }))),
    "rules.optional-params.options.wrapperImport",
  );
});

Deno.test("unnamed_plugin_rules_compile_to_off_opt_in", () => {
  const compiled = compile(minimal());
  for (const id of pluginIds()) {
    const rule = compiled.rules[id];
    assertEquals(rule.configuredLevel, "off", id);
    assertEquals(rule.effectiveLevel, "off", id);
    assertEquals(rule.optIn, true, id);
    assertEquals(rule.reason, NOT_ENABLED, id);
    assertEquals(compiled.catalog.rules[id].severity, "off", id);
    assertEquals(compiled.catalog.rules[id].reason, NOT_ENABLED, id);
  }
  assertEquals(Object.keys(compiled.rules).length, DESCRIPTOR_RULE_COUNT);
  assertEquals(Object.keys(compiled.catalog.rules).length, PLUGIN_RULE_COUNT);
});

Deno.test("compiled_catalog_passes_parseCatalog_and_whole_tree_settings", () => {
  const id = `${PLUGIN_PREFIX}no-explicit-unknown`;
  const compiled = compile({
    version: 2,
    plugin: "demo",
    extends: ["unslop:strict"],
    docsBase: DOCS_BASE,
    paths: {
      test: ["**/tests/**"],
      fixture: ["**/fixtures/**"],
      ignore: [{ glob: "**/vendor/**", reason: "Vendored code" }],
    },
    tags: {
      "project-only": { description: "A project tag." },
      "unused-tag": { description: "Never used." },
    },
    rules: {
      [`${PLUGIN_PREFIX}max-params`]: ["error", { max: 5 }],
      [`${PLUGIN_PREFIX}exported-interface-naming`]: { level: "error", tags: ["project-only"] },
      [id]: { level: "error", docs: "https://example.test/custom#anchor" },
      "optional-params": ["warn", OPTIONAL_PARAMS_OPTIONS],
    },
  } as JsonValue);

  assertEquals(
    parseCatalog(asJson(compiled.catalog), { scriptRuleSchemas: null, registry: TEST_REGISTRY }).version,
    "1",
  );
  assertEquals(parseWholeTreeSettings(asJson(compiled.catalog)).optionalParams, OPTIONAL_PARAMS_OPTIONS);
  assertEquals(compiled.catalog.rules[`${PLUGIN_PREFIX}max-params`].options?.max, 5);
  assertEquals(compiled.catalog.rules[`${PLUGIN_PREFIX}max-params`].codeStyle, `${DOCS_BASE}#complexity-rules`);
  assertEquals(compiled.catalog.rules[id].codeStyle, "https://example.test/custom#anchor");
  assertEquals(compiled.catalog.rules[`${PLUGIN_PREFIX}exported-interface-naming`].tags, ["project-only"]);
  assertEquals(compiled.catalog.tagVocabulary["project-only"].description, "A project tag.");
  assertEquals(compiled.catalog.tagVocabulary["unused-tag"], undefined);
  assertEquals(compiled.catalog.ignore, [{ glob: "**/vendor/**", reason: "Vendored code" }]);
  assertEquals(compiled.catalog.scopes.test, ["**/tests/**"]);
  assertEquals(compiled.catalog.rules["duplicate-type"].engine, "script");
  assertEquals(compiled.catalog.rules["duplicate-type"].severity, "error");
  assertEquals(compiled.catalog.rules["magic-literals"], undefined);
  assertEquals(
    compiled.catalog.rules[`${PLUGIN_PREFIX}max-params`].limits,
    TYPESCRIPT_RULE_PACK.rules["max-params"].meta.limits,
  );
  assertEquals(
    compiled.rules[`${PLUGIN_PREFIX}max-params`].sources.fields.level,
    `config:rules.${PLUGIN_PREFIX}max-params`,
  );
  assertEquals(compiled.rules[`${PLUGIN_PREFIX}max-params`].sources.fields.scope, "default");
  assertEquals(compiled.rules["demo/ignore-needs-reason"].sources.fields.level, "preset:unslop:strict");
});

Deno.test("script_rules_keep_consumer_docs_and_reject_unknown_options", () => {
  const descriptor = testDescriptor({
    scriptRules: { "project-check": scriptRule() },
    wholeTreeHosts: {
      "duplicate-type": {
        controls: { ...SCRIPT_CONTROLS, editable: ["options"], fixedLevel: "error", fixedScope: "prod" },
        command: ["deno", "task", "check:duplicates"],
      },
    },
  });
  const compiled = compile(
    minimal({ docsBase: DOCS_BASE, rules: { "project-check": ["warn", {}] } }),
    descriptor,
  );
  const entry = compiled.catalog.rules["project-check"];
  assertEquals(entry.engine, "script");
  assertEquals(entry.codeStyle, "#consumer-guide");
  assertEquals(entry.severity, "warn");
  assertEquals(compiled.rules["duplicate-type"].command, ["deno", "task", "check:duplicates"]);
  assertEquals(compiled.rules["duplicate-type"].scope, "prod");
  assertEquals(
    errorPath(() => compile(minimal({ rules: { "project-check": ["warn", { extra: true }] } }), descriptor)),
    "rules.project-check.options",
  );
});
