/**
 * @module ToHostConfigWrapper
 * @path scripts/to_host_config.mjs
 * @description Node.js and Bun wrapper that writes an ESLint or Oxlint config fragment with safe writes.
 */

import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileConfig } from "../mod.ts";
import { renderEslintFragment, renderOxlintFragment, toHostConfig } from "../src/config/to_host_config.ts";

const USAGE =
  "usage: to_host_config.mjs --descriptor=<entry> --config=<path> --host=eslint|oxlint --out=<path> [--overwrite]";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  for (const argument of argv) {
    if (!argument.startsWith("--")) fail(`${USAGE}\nunexpected argument: ${argument}`, 2);
    const [name, value] = argument.slice(2).split("=", 2);
    if (value === undefined) flags.add(name);
    else values[name] = value;
  }
  return { values, flags };
}

async function descriptorOf(path) {
  // deno-lint-ignore self/dynamic-import self/import-inside-statement -- the descriptor path is a runtime argument
  const module = await import(pathToFileURL(resolve(path)).href);
  const descriptor = module.descriptor ?? module.default;
  if (descriptor === undefined || typeof descriptor !== "object") {
    fail(`${path}: the module must export 'descriptor'`, 2);
  }
  return descriptor;
}

async function writeOutput(out, contents, overwrite) {
  const target = resolve(out);
  const existing = await lstat(target).catch(() => null);
  if (existing?.isSymbolicLink()) fail(`${target}: the destination is a symlink`, 2);
  if (existing !== null && !overwrite) fail(`${target}: the file exists; pass --overwrite to replace it.`, 2);
  if (!overwrite) {
    const handle = await open(target, "wx");
    try {
      await handle.writeFile(contents);
    } finally {
      await handle.close();
    }
    return target;
  }
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(contents);
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return target;
}

async function main() {
  const { values, flags } = parseArgs(process.argv.slice(2));
  for (const required of ["descriptor", "config", "host", "out"]) {
    if (values[required] === undefined) fail(`${USAGE}\nmissing --${required}`, 2);
  }
  if (values.host !== "eslint" && values.host !== "oxlint") fail(`${USAGE}\n--host must be eslint or oxlint`, 2);
  const descriptor = await descriptorOf(values.descriptor);
  const config = JSON.parse(await readFile(values.config, "utf8"));
  const compiled = compileConfig(config, descriptor);
  const fragment = toHostConfig(compiled, values.host);
  const contents = values.host === "eslint"
    ? renderEslintFragment(fragment, descriptor.pluginName)
    : renderOxlintFragment(fragment);
  const written = await writeOutput(values.out, contents, flags.has("overwrite"));
  console.log(`wrote ${written}`);
  if (fragment.skipped.length > 0) console.log(`skipped: ${fragment.skipped.join(", ")}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
