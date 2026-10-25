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

/** Environment variable that makes a child `deno` fail on some hosts. */
const LINKER_PATH_VARIABLE = "LD_LIBRARY_PATH";

/** Bundles the engine library under `engineRoot` into the single file `outFile`. */
export async function bundleEngine(engineRoot: string, outFile: string): Promise<void> {
  const env = Deno.env.toObject();
  delete env[LINKER_PATH_VARIABLE];
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform=deno", `--output=${outFile}`, join(engineRoot, BUNDLE_ENTRY)],
    cwd: engineRoot,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.code !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
}
