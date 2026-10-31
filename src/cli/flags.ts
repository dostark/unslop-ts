/**
 * @module CliFlags
 * @path src/cli/flags.ts
 * @description Shared value lookup for equals-form command flags.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/cli/rule_report.ts, src/cli/whole_tree.ts]
 */

/** Reads the first equals-form value for one flag. */
export function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
