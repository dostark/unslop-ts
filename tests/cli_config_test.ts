/**
 * @module CliConfigTest
 * @path tests/cli_config_test.ts
 * @description The spawned CLI validates, prints, and schematizes a configuration, refuses non-local entries, and rejects unknown usage.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [src/cli/config_read.ts, src/cli/project_loader.ts, tests/helpers/cli_project.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { configPath, runCli, runCliAt, withCliProject } from "./helpers/cli_project.ts";

interface IPrintedCatalog {
  readonly version: string;
  readonly rules: Record<string, unknown>;
}

Deno.test("config_validate_and_print_dispatch", async () => {
  await withCliProject(async (dir) => {
    const valid = await runCli(dir, ["config", "validate"]);
    assertEquals(valid.code, 0, valid.stderr);
    assertStringIncludes(valid.stdout, "ok demo");

    const printed = await runCli(dir, ["config", "print"]);
    assertEquals(printed.code, 0, printed.stderr);
    assertEquals((JSON.parse(printed.stdout) as IPrintedCatalog).version, "1");

    const resolved = await runCli(dir, ["config", "print", "--resolved"]);
    const model = JSON.parse(resolved.stdout) as { catalog: IPrintedCatalog; rules: Record<string, unknown> };
    assertEquals(model.catalog.version, "1");
    assert("demo/max-params" in model.rules);

    const schema = await runCli(dir, ["config", "schema"]);
    assertEquals(schema.code, 0, schema.stderr);
    assertEquals((JSON.parse(schema.stdout) as { type?: string }).type, "object");

    const descriptor = await runCli(dir, ["config", "validate", "--descriptor=examples/unslop.project.ts"]);
    assertEquals(descriptor.code, 0, descriptor.stderr);

    const badPlugin = join(dir, "examples", "bad_plugin.ts");
    await Deno.writeTextFile(badPlugin, 'export default { name: "bad", rules: {} };\n');
    const missingProject = await runCli(dir, ["rules", "list", "--plugin=examples/bad_plugin.ts"]);
    assertEquals(missingProject.code, 2);
    assertStringIncludes(missingProject.stderr, "project");

    await Deno.mkdir(join(dir, "src", "nested"), { recursive: true });
    const nested = await runCliAt(join(dir, "src", "nested"), ["rules", "list", "--format=json"]);
    assertEquals(nested.code, 0, nested.stderr);
    assertStringIncludes(nested.stdout, "demo/no-chained-type-assertions");
  });

  await withCliProject(async (dir) => {
    await Deno.rename(join(dir, "deno.json"), join(dir, "deno.jsonc"));
    const refusal = await runCli(dir, ["rules", "list"]);
    assertEquals(refusal.code, 2);
    assertStringIncludes(refusal.stderr, "JSONC");
  });
});

Deno.test("invalid_config_content_exits_1", async () => {
  await withCliProject(async (dir) => {
    await Deno.writeTextFile(configPath(dir), "{");
    const broken = await runCli(dir, ["config", "validate"]);
    assertEquals(broken.code, 1);
    assertStringIncludes(broken.stderr, "unslop.config.json");
    assertStringIncludes(broken.stderr, "invalid JSON");

    await Deno.writeTextFile(
      configPath(dir),
      JSON.stringify({ version: 2, plugin: "demo", rules: { "demo/missing": "error" } }),
    );
    const semantic = await runCli(dir, ["config", "validate"]);
    assertEquals(semantic.code, 1);
    assertStringIncludes(semantic.stderr, "rules.demo/missing");
  });
});

Deno.test("the_cli_refuses_every_non_file_entry", async () => {
  await withCliProject(async (dir) => {
    const refused = [
      "data:text/javascript,export const project = {};",
      "https://example.test/plugin.ts",
      "HTTPS://EXAMPLE.TEST/plugin.ts",
      "npm:left-pad",
      "jsr:@std/path",
    ];
    for (const entry of refused) {
      const result = await runCli(dir, ["rules", "list", `--plugin=${entry}`]);
      assertEquals(result.code, 2, entry);
      assertStringIncludes(result.stderr, "not a local file entry");
    }

    const pluginUrl = toFileUrl(join(dir, "examples", "lint_plugin.ts")).href;
    const accepted = await runCli(dir, ["rules", "list", `--plugin=${pluginUrl}`]);
    assertEquals(accepted.code, 0, accepted.stderr);

    const sideEffectPath = join(dir, "examples", "side_effect.ts");
    await Deno.writeTextFile(sideEffectPath, 'console.error("SIDE_EFFECT");\nexport const project = {};\n');
    const sideEffectCode = `await import(${JSON.stringify(toFileUrl(sideEffectPath).href)});`;
    const payload = `data:text/javascript,${encodeURIComponent(sideEffectCode)}`;
    const dataRefusal = await runCli(dir, ["rules", "list", `--plugin=${payload}`]);
    assertEquals(dataRefusal.code, 2);
    assertEquals(dataRefusal.stderr.includes("SIDE_EFFECT"), false);
  });
});

Deno.test("unknown_command_option_or_format_exits_2", async () => {
  await withCliProject(async (dir) => {
    const negativeCases: readonly (readonly string[])[] = [
      [],
      ["rules"],
      ["rules", "bogus"],
      ["rules", "list", "--format=xml"],
      ["rules", "list", "--bogus=1"],
      ["rules", "list", "extra"],
      ["rules", "show"],
      ["rules", "show", "demo/nope"],
      ["presets", "show"],
      ["presets", "show", "nope"],
      ["config", "bogus"],
      ["config", "schema", "--format=json"],
      ["config", "schema", "extra"],
    ];
    for (const args of negativeCases) {
      const result = await runCli(dir, args);
      assertEquals(result.code, 2, args.join(" "));
    }

    const positiveCases: readonly (readonly string[])[] = [
      ["rules", "list"],
      ["rules", "show", "demo/max-params"],
      ["presets", "list"],
      ["presets", "show", "unslop:strict"],
      ["config", "validate"],
      ["config", "print"],
      ["config", "schema"],
    ];
    for (const args of positiveCases) {
      const result = await runCli(dir, args);
      assertEquals(result.code, 0, `${args.join(" ")}: ${result.stderr}`);
    }
  });
});
