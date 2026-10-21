/**
 * @module RegexOption
 * @path src/engine/regex_option.ts
 * @description Zod schemas for a regular expression option, so a malformed pattern or flag fails when the catalog is parsed.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/rules/rule_options.ts, src/rules/whole_tree/options.ts]
 */

import { z } from "zod";

/** True when the source compiles with the flags. */
export function compilesAsRegex(source: string, flags = ""): boolean {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

/** A string that is a valid regular expression source. */
export const RegexSourceSchema = z.string().refine((value) => compilesAsRegex(value), {
  message: "is not a valid regular expression",
});

/** A string of valid, non-repeated regular expression flags. */
export const RegexFlagsSchema = z.string().refine((value) => compilesAsRegex("", value), {
  message: "holds an invalid or repeated regular expression flag",
});
