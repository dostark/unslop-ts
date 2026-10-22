/**
 * @module MigrateCommand
 * @path src/cli/commands/migrate.ts
 * @description The `migrate` route: reads a version 1 catalog through the descriptor and writes a no-clobber configuration/layout pair.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/config/migrate.ts, src/cli/safe_write.ts, src/cli/unslop.ts]
 */

import { fromFileUrl, resolve } from "@std/path";
import type { JsonValue } from "../../engine/catalog.ts";
import { compileConfig } from "../../config/compile.ts";
import { migrateCatalog } from "../../config/migrate.ts";
import { ConfigError } from "../../config/schema.ts";
import { CliError, FAILURE_EXIT, USAGE_EXIT } from "../error.ts";
import { loadConfigDescriptor, resolveLocalEntry } from "../project_loader.ts";
import { type IMigrationWriteResult, PartialWriteError, writeMigrationPair, WriteRefusalError } from "../safe_write.ts";

/** The options of one migration. */
export interface IMigrateOptions {
  readonly descriptor: string;
  readonly from: string;
  readonly out: string;
  readonly layoutOut?: string;
}

/** Two-space JSON with a trailing newline, matching every other written file. */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Migrates a version 1 catalog to a version 2 configuration plus its separate layout. */
export async function runMigrate(cwd: string, options: IMigrateOptions): Promise<IMigrationWriteResult> {
  const descriptor = await loadConfigDescriptor(cwd, options.descriptor, null);
  const fromUrl = await resolveLocalEntry(options.from, cwd);
  let text: string;
  try {
    text = await Deno.readTextFile(fromUrl);
  } catch {
    throw new CliError(FAILURE_EXIT, `${options.from}: cannot read the version 1 catalog.`);
  }
  let catalog: JsonValue;
  try {
    catalog = JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new CliError(FAILURE_EXIT, `${options.from}: invalid JSON (${messageOf(error)})`);
  }
  let migrated: { config: JsonValue; layout: JsonValue | null };
  try {
    migrated = migrateCatalog(catalog, descriptor);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new CliError(FAILURE_EXIT, `${options.from}: ${error.message}`);
    }
    throw new CliError(FAILURE_EXIT, `${options.from}: ${messageOf(error)}`);
  }
  try {
    compileConfig(migrated.config, descriptor);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new CliError(
        FAILURE_EXIT,
        `${options.from}: the migrated configuration does not compile: ${error.message}`,
      );
    }
    throw new CliError(
      FAILURE_EXIT,
      `${options.from}: the migrated configuration does not compile: ${messageOf(error)}`,
    );
  }
  if (migrated.layout !== null && options.layoutOut === undefined) {
    throw new CliError(USAGE_EXIT, "--layout-out is required because the input catalog has a layout.");
  }
  const layoutPath = options.layoutOut === undefined ? null : resolve(cwd, options.layoutOut);
  try {
    return await writeMigrationPair({
      config: { path: resolve(cwd, options.out), contents: serializeJson(migrated.config) },
      layout: migrated.layout === null || layoutPath === null
        ? null
        : { path: layoutPath, contents: serializeJson(migrated.layout) },
      sources: [fromFileUrl(fromUrl)],
    });
  } catch (error) {
    if (error instanceof WriteRefusalError || error instanceof PartialWriteError) {
      throw new CliError(error.exitCode, error.message);
    }
    throw new CliError(FAILURE_EXIT, `${options.out}: ${messageOf(error)}`);
  }
}
