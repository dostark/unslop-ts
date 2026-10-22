/**
 * @module ConfigJsonSchema
 * @path src/config/json_schema.ts
 * @description The structural JSON Schema of a version 2 configuration, generated from the Zod schema.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/config/schema.ts, src/config/compile.ts]
 */

import { z } from "zod";
import type { JsonValue } from "../engine/catalog.ts";
import { ConfigV2Schema } from "./schema.ts";

/**
 * The structural JSON Schema: primitives, arrays, object shapes, and unknown-key rejection.
 * Registry-aware checks, such as a known rule id or an option key, run only in `compileConfig`.
 */
export function configJsonSchema(): JsonValue {
  return z.toJSONSchema(ConfigV2Schema, { io: "input" }) as JsonValue;
}
