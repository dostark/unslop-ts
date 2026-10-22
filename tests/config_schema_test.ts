/**
 * @module ConfigSchemaTest
 * @path tests/config_schema_test.ts
 * @description The generated JSON Schema accepts a valid version 2 file and rejects structural errors, while semantic-only errors fail compilation.
 * @architectural-layer Test
 * @dependencies [ajv, ajv-formats]
 * @related-files [src/config/json_schema.ts, src/config/schema.ts, src/config/compile.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import type { ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import { Ajv2020 } from "ajv/dist/2020.js";
import { compileConfig, ConfigError, configJsonSchema, type IConfigV2, type JsonValue } from "../mod.ts";
import { testDescriptor } from "./helpers/descriptor.ts";

type IAddFormats = (ajv: Ajv2020) => Ajv2020;

/** The package is CommonJS, so Deno types its default import as the module namespace. */
const addFormatsNamespace: unknown = addFormatsModule;
const addFormats = addFormatsNamespace as IAddFormats;

function validator(): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(configJsonSchema() as object);
}

Deno.test("json_schema_accepts_the_example_and_rejects_an_unknown_key", async () => {
  const validate = validator();
  const example: IConfigV2 = JSON.parse(
    await Deno.readTextFile(new URL("./cases/config_minimal.json", import.meta.url)),
  );
  assertEquals(validate(example), true, JSON.stringify(validate.errors));
  assertEquals(validate({ ...example, unexpected: true }), false);
  assertEquals(validate({ version: 1, plugin: "demo" }), false);

  const semanticOnly = {
    version: 2,
    plugin: "demo",
    rules: { "demo/no-explicit-unknown": "off" },
  } satisfies JsonValue;
  assertEquals(validate(semanticOnly), true);
  assertEquals(
    assertThrows(() => compileConfig(semanticOnly, testDescriptor()), ConfigError).path,
    "rules.demo/no-explicit-unknown.reason",
  );

  const unknownOption = {
    version: 2,
    plugin: "demo",
    rules: { "demo/max-params": ["error", { nope: 1 }] },
  } satisfies JsonValue;
  assertEquals(validate(unknownOption), true);
  assertThrows(() => compileConfig(unknownOption, testDescriptor()), ConfigError);
});
