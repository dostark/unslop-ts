/**
 * @module CliConfigRead
 * @path src/cli/config_read.ts
 * @description `config validate`, `config print`, and `config schema`: disk validation and JSON model output.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/config/compile.ts, src/config/json_schema.ts, src/cli/unslop.ts]
 */

import type { ICompiledConfig, IProjectDescriptor } from "../config/descriptor.ts";
import { configJsonSchema } from "../config/json_schema.ts";
import { jsonText } from "./output.ts";

const VALIDATION_OK = "ok";

/** The one-line success result of `config validate`. */
export function validationText(descriptor: IProjectDescriptor, compiled: ICompiledConfig): string {
  return `${VALIDATION_OK} ${descriptor.pluginName} ${Object.keys(compiled.rules).length} rules\n`;
}

/** `config print`: the emitted catalog, or the full compiled model with `--resolved`. */
export function printConfigText(compiled: ICompiledConfig, resolved: boolean): string {
  return resolved ? jsonText({ catalog: compiled.catalog, rules: compiled.rules }) : jsonText(compiled.catalog);
}

/** `config schema`: the generated structural JSON Schema. */
export function schemaText(): string {
  return jsonText(configJsonSchema());
}
