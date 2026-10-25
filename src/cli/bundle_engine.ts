/**
 * @module BundleEngine
 * @path src/cli/bundle_engine.ts
 * @description Runs `deno bundle` on the engine library entry. The release bundle script and the policy directory command share it.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [scripts/bundle.ts, src/cli/commands/deno_policy.ts, src/bundle/engine.ts]
 */

import { join } from "@std/path";

/** The engine library entry that `deno bundle` compiles into one file. */
const BUNDLE_ENTRY = "src/bundle/engine.ts";

/** The variables the child `deno bundle` needs to find itself, its cache, and a proxy. Nothing else is passed on. */
const CHILD_ENV_NAMES = [
  "PATH",
  "HOME",
  "DENO_DIR",
  "XDG_CACHE_HOME",
  "TMPDIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
] as const;

/** One variable, or undefined when it is unset or the process may not read it. */
function readVariable(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch (error) {
    if (error instanceof Deno.errors.NotCapable) return undefined;
    throw error;
  }
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of CHILD_ENV_NAMES) {
    const value = readVariable(name);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/** Bundles the engine library under `engineRoot` into the single file `outFile`. */
export async function bundleEngine(engineRoot: string, outFile: string): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform=deno", `--output=${outFile}`, join(engineRoot, BUNDLE_ENTRY)],
    cwd: engineRoot,
    env: childEnv(),
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.code !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
}
