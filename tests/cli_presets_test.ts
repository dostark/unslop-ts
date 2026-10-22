/**
 * @module CliPresetsTest
 * @path tests/cli_presets_test.ts
 * @description The spawned CLI expands each engine preset from the registered packs and refuses an unknown preset.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/cli/presets.ts, src/config/presets.ts, tests/helpers/cli_project.ts]
 */

import { assertArrayIncludes, assertEquals, assertStringIncludes } from "@std/assert";
import { runCli, withCliProject } from "./helpers/cli_project.ts";

interface IPresetView {
  readonly id: string;
  readonly description: string;
  readonly memberships: readonly string[];
  readonly rules: readonly string[];
}

function presetNamed(presets: readonly IPresetView[], id: string): IPresetView {
  const preset = presets.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`missing preset ${id}`);
  return preset;
}

Deno.test("presets_list_and_show_dispatch", async () => {
  await withCliProject(async (dir) => {
    const list = JSON.parse((await runCli(dir, ["presets", "list", "--format=json"])).stdout) as {
      presets: IPresetView[];
    };
    assertEquals(list.presets.map((preset) => preset.id), ["unslop:recommended", "unslop:strict"]);
    const recommended = presetNamed(list.presets, "unslop:recommended");
    const strict = presetNamed(list.presets, "unslop:strict");
    assertEquals(recommended.rules.length, 11);
    assertEquals(strict.rules.length, 32);
    assertArrayIncludes(strict.rules, ["demo/no-explicit-unknown", "demo/no-chained-type-assertions"]);
    assertEquals(strict.rules.includes("optional-params"), false);

    const shown = JSON.parse((await runCli(dir, ["presets", "show", "unslop:strict", "--format=json"])).stdout) as {
      preset: IPresetView;
    };
    assertEquals(shown.preset.rules.length, 32);
    assertEquals(shown.preset.memberships, ["recommended", "strict"]);

    const table = (await runCli(dir, ["presets", "list"])).stdout;
    assertStringIncludes(table, "unslop:recommended");
    assertStringIncludes(table, "unslop:strict");
    const shownTable = (await runCli(dir, ["presets", "show", "unslop:recommended"])).stdout;
    assertStringIncludes(shownTable, "unslop:recommended");

    const unknown = await runCli(dir, ["presets", "show", "nope"]);
    assertEquals(unknown.code, 2);
    assertStringIncludes(unknown.stderr, "unknown preset");
  });
});
