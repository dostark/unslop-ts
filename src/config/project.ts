/**
 * @module UnslopProject
 * @path src/config/project.ts
 * @description Builds a project from a descriptor and a version 2 configuration: the compiled model and the lint plugin.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/config/compile.ts, src/config/descriptor.ts, src/engine/plugin.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";
import { createLintPlugin } from "../engine/plugin.ts";
import { compileConfig } from "./compile.ts";
import type { ICompiledConfig, IProjectDescriptor } from "./descriptor.ts";

/** The input of {@link createUnslopProject}. */
export interface IUnslopProjectInput {
  readonly descriptor: IProjectDescriptor;
  readonly config: JsonValue;
}

/** A configured project: the descriptor, its compiled model, and the plugin Deno lint loads. */
export interface IUnslopProject {
  readonly descriptor: IProjectDescriptor;
  readonly compiled: ICompiledConfig;
  readonly plugin: Deno.lint.Plugin;
}

/** Compiles a configuration and builds its lint plugin. The entry file exports the result of this call. */
export function createUnslopProject(input: IUnslopProjectInput): IUnslopProject {
  const compiled = compileConfig(input.config, input.descriptor);
  const plugin = createLintPlugin(input.descriptor.pluginName, compiled.catalog, {
    rulePacks: input.descriptor.packs,
  });
  return { descriptor: input.descriptor, compiled, plugin };
}
