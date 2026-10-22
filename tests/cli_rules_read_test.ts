/**
 * @module CliRulesReadTest
 * @path tests/cli_rules_read_test.ts
 * @description The spawned CLI lists and shows resolved rules with status, controls, host modes, options, and sources.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/cli/rules_read.ts, src/cli/selection.ts, tests/helpers/cli_project.ts]
 */

import { assertArrayIncludes, assertEquals, assertStringIncludes } from "@std/assert";
import { configPath, runCli, withCliProject } from "./helpers/cli_project.ts";

interface IRuleView {
  readonly id: string;
  readonly engine: string;
  readonly status: string;
  readonly effectiveLevel: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly controls: { readonly editable: readonly string[]; readonly hostModes: Record<string, string> };
  readonly docs: string;
  readonly command: readonly string[] | null;
  readonly configuredOptions: Record<string, unknown>;
  readonly defaultOptions: Record<string, unknown> | null;
  readonly effectiveOptions: Record<string, unknown> | null;
  readonly exclusionCodes: Record<string, string> | null;
  readonly sources: { readonly fields: Record<string, string> };
}

interface IRulesJson {
  readonly rules: IRuleView[];
}

function parseRules(stdout: string): IRuleView[] {
  return (JSON.parse(stdout) as IRulesJson).rules;
}

function findRule(rules: readonly IRuleView[], id: string): IRuleView {
  const rule = rules.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`missing rule ${id}`);
  return rule;
}

function ruleOf(stdout: string): IRuleView {
  return (JSON.parse(stdout) as { rule: IRuleView }).rule;
}

Deno.test("rules_list_shows_every_rule_with_status_and_category", async () => {
  await withCliProject(async (dir) => {
    const rules = parseRules((await runCli(dir, ["rules", "list", "--format=json"])).stdout);
    const ids = rules.map((rule) => rule.id);
    assertArrayIncludes(ids, ["demo/no-chained-type-assertions", "demo/exported-interface-naming", "optional-params"]);
    const parked = findRule(rules, "demo/exported-interface-naming");
    assertEquals(parked.status, "parked");
    assertEquals(parked.category, "interfaces");
    assertEquals(parked.controls.editable, ["level", "scope", "include", "exclude", "options"]);
    assertEquals(parked.controls.hostModes, { default: "error" });
    assertEquals(findRule(rules, "demo/require-module-header").status, "off");
    assertEquals(findRule(rules, "project-check").status, "active");

    const comments = parseRules((await runCli(dir, ["rules", "list", "--format=json", "--category=comments"])).stdout);
    assertEquals(comments.every((rule) => rule.category === "comments"), true);
    assertEquals(comments.length > 0, true);

    const active = parseRules((await runCli(dir, ["rules", "list", "--format=json", "--status=active"])).stdout);
    assertEquals(active.every((rule) => rule.status === "active"), true);

    const table = (await runCli(dir, ["rules", "list"])).stdout;
    assertStringIncludes(table, "demo/no-chained-type-assertions");
    assertStringIncludes(table, "STATUS");
    assertStringIncludes(table, "default=error");
  });
});

Deno.test("rules_show_reports_configured_effective_and_default_options_with_sources", async () => {
  await withCliProject(async (dir) => {
    const maxParams = ruleOf((await runCli(dir, ["rules", "show", "demo/max-params", "--format=json"])).stdout);
    assertEquals(maxParams.configuredOptions, { max: 2 });
    assertEquals(maxParams.defaultOptions, { max: 7 });
    assertEquals(maxParams.effectiveOptions, { max: 2 });
    assertEquals(maxParams.sources.fields.level, "config:rules.demo/max-params");
    assertEquals(maxParams.sources.fields.options, "config:rules.demo/max-params");
    assertEquals(maxParams.tags, ["project-choice"]);

    const optional = ruleOf((await runCli(dir, ["rules", "show", "optional-params", "--format=json"])).stdout);
    assertEquals(optional.status, "off");
    assertEquals(optional.configuredOptions, {});
    assertEquals(optional.defaultOptions, null);
    assertEquals(optional.effectiveOptions, null);

    const script = ruleOf((await runCli(dir, ["rules", "show", "project-check", "--format=json"])).stdout);
    assertEquals(script.engine, "script");
    assertEquals(script.docs, "#consumer-guide");
    assertEquals(script.controls.hostModes, { default: "warn" });
    assertEquals(script.command, ["deno", "task", "check:project"]);

    const table = (await runCli(dir, ["rules", "show", "demo/max-params"])).stdout;
    assertStringIncludes(table, 'configured options: {"max":2}');
    assertStringIncludes(table, "sources: docs=default");
  });
});

Deno.test("a_valid_profile_still_selects_a_parked_rule", async () => {
  await withCliProject(async (dir) => {
    const rules = parseRules((await runCli(dir, ["rules", "list", "--format=json", "--profile=parked"])).stdout);
    assertEquals(findRule(rules, "demo/exported-interface-naming").status, "active");
    assertEquals(findRule(rules, "demo/no-chained-type-assertions").status, "not-selected");
  });
});

Deno.test("status_follows_the_selection_variable", async () => {
  await withCliProject(async (dir) => {
    const selected = parseRules(
      (await runCli(dir, ["rules", "list", "--format=json", "--select=demo/exported-interface-naming"])).stdout,
    );
    const parked = findRule(selected, "demo/exported-interface-naming");
    assertEquals(parked.status, "active");
    assertEquals(parked.effectiveLevel, "error");
    assertEquals(findRule(selected, "demo/no-chained-type-assertions").status, "not-selected");

    const bare = parseRules(
      (await runCli(dir, ["rules", "list", "--format=json", "--select=exported-interface-naming"])).stdout,
    );
    assertEquals(findRule(bare, "demo/exported-interface-naming").status, "active");

    const tagged = parseRules(
      (await runCli(dir, ["rules", "list", "--format=json", "--select=tag:comments"])).stdout,
    );
    assertEquals(findRule(tagged, "demo/decorative-comment").status, "active");
    assertEquals(findRule(tagged, "demo/no-chained-type-assertions").status, "not-selected");

    const profiled = parseRules(
      (await runCli(dir, ["rules", "list", "--format=json", "--profile=parked"])).stdout,
    );
    assertEquals(findRule(profiled, "demo/exported-interface-naming").status, "active");

    const envOnly = parseRules(
      (await runCli(dir, ["rules", "list", "--format=json"], { DEMO_LINT_RULES: "demo/import-boundaries" })).stdout,
    );
    assertEquals(findRule(envOnly, "demo/import-boundaries").status, "active");
    assertEquals(findRule(envOnly, "demo/no-chained-type-assertions").status, "not-selected");

    const overridden = parseRules(
      (await runCli(dir, ["rules", "list", "--format=json", "--select=demo/no-explicit-unknown"], {
        DEMO_LINT_RULES: "demo/import-boundaries",
      })).stdout,
    );
    assertEquals(findRule(overridden, "demo/no-explicit-unknown").status, "active");
    assertEquals(findRule(overridden, "demo/import-boundaries").status, "not-selected");

    const conflict = await runCli(dir, ["rules", "list", "--select=demo/max-params", "--profile=parked"]);
    assertEquals(conflict.code, 2);
    assertStringIncludes(conflict.stderr, "--select and --profile");

    const ambiguous = await runCli(dir, ["rules", "list", "--select=no-explicit-unknown"]);
    assertEquals(ambiguous.code, 2);
    assertStringIncludes(ambiguous.stderr, "ambiguous");

    assertEquals((await runCli(dir, ["rules", "list", "--select=demo/missing"])).code, 2);
    assertEquals((await runCli(dir, ["rules", "list", "--profile=missing"])).code, 2);
    assertEquals((await runCli(dir, ["rules", "list", "--select=tag:missing"])).code, 2);
  });
});

Deno.test("rules_show_prints_the_corrected_origins", async () => {
  await withCliProject(async (dir) => {
    const rule = ruleOf(
      (await runCli(dir, ["rules", "show", "demo/no-chained-type-assertions", "--format=json"])).stdout,
    );
    assertEquals(rule.sources.fields.level, "preset:unslop:recommended");
    assertEquals(rule.sources.fields.options, "default");
    assertEquals(rule.sources.fields.scope, "default");
    assertEquals(rule.sources.fields.docs, "default");
    assertEquals(rule.sources.fields.tags, "default");
  });
});

Deno.test("rules_show_prints_exclusion_codes", async () => {
  await withCliProject(async (dir) => {
    const config = JSON.parse(await Deno.readTextFile(configPath(dir))) as { rules: Record<string, unknown> };
    config.rules["project-check"] = { level: "warn", exclusionCodes: { "a-code": "Because." } };
    await Deno.writeTextFile(configPath(dir), JSON.stringify(config, null, 2));
    const rule = ruleOf((await runCli(dir, ["rules", "show", "project-check", "--format=json"])).stdout);
    assertEquals(rule.exclusionCodes, { "a-code": "Because." });
  });
});
