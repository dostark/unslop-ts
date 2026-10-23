/**
 * @module SelfLintPlugin
 * @path lint/plugin.ts
 * @description Entry that compiles the engine's own configuration into the lint plugin.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [lint/unslop.project.ts, lint/unslop.config.json]
 */

import { createUnslopProject } from "../deno.ts";
import config from "./unslop.config.json" with { type: "json" };
import { descriptor } from "./unslop.project.ts";

export const project = createUnslopProject({ descriptor, config });

export default project.plugin;
