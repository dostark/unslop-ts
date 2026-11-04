/**
 * @module ClassPassRepoTestHelper
 * @path tests/helpers/class_pass_repo.ts
 * @description Shared helper that writes source files into a temporary repository and runs the class pass over them.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [src/report/class_pass.ts, tests/class_pass_test.ts, tests/design_strategies_test.ts]
 */

import { join } from "@std/path";
import { classPassOf, type IClassPassResult } from "../../src/report/class_pass.ts";
import { moduleGraphOf } from "../../src/report/exports.ts";
import { type IParsedHealthFile, parseHealthFile } from "../../src/report/parse.ts";
import type { IClassMetrics } from "../../src/metrics/types.ts";
import { CLASSIC_OPTIONS } from "./measurement.ts";
import { withRepo, write } from "./temp_repo.ts";

const SRC = "packages/p/src";

/** Writes the files into a temporary repository and runs the class pass over them. */
export async function passOver(files: Readonly<Record<string, string>>): Promise<IClassPassResult> {
  let result: IClassPassResult | undefined;
  await withRepo(async (root) => {
    const parsed = new Map<string, IParsedHealthFile>();
    for (const [name, text] of Object.entries(files)) {
      const path = `${SRC}/${name}`;
      await write(root, path, text);
      parsed.set(path, await parseHealthFile(join(root, path), path));
    }
    const graph = await moduleGraphOf(parsed, { rootPath: root, publicEntries: [] });
    result = classPassOf({ files: parsed, graph, options: CLASSIC_OPTIONS });
  });
  return result!;
}

export function classNamed(result: IClassPassResult, name: string): IClassMetrics {
  const found = result.classes.find((entry) => entry.metrics.name === name);
  if (found === undefined) throw new Error(`The pass reports no class ${name}.`);
  return found.metrics;
}
