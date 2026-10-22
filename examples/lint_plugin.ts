/**
 * @module ExampleLintPlugin
 * @path examples/lint_plugin.ts
 * @description Plugin entry for a Deno project: it compiles the example version 2 configuration and exports the project and its plugin.
 * @architectural-layer Example
 * @dependencies [@dostark/unslop-ts]
 * @related-files [examples/unslop.project.ts, examples/unslop.config.json, tests/example_project_test.ts]
 *
 * Usage:
 *   Add `"lint": { "plugins": ["./examples/lint_plugin.ts"] }` to the `deno.json` of the project, then run `deno lint`.
 */

import { createUnslopProject } from "@dostark/unslop-ts";
import { descriptor } from "./unslop.project.ts";
import config from "./unslop.config.json" with { type: "json" };

export const project = createUnslopProject({ descriptor, config });

export default project.plugin;
