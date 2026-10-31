/**
 * @module GitFixture
 * @path tests/helpers/git_fixture.ts
 * @description Shared isolated Git commands for health history fixtures.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/health_churn_test.ts, tests/health_cli_test.ts]
 */
const TEST_GIT_ENV = {
  LD_LIBRARY_PATH: "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** Runs Git with fixture identities and reports any command failure. */
export async function fixtureGit(
  cwd: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<string> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd,
    env: { ...TEST_GIT_ENV, ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`);
  return new TextDecoder().decode(output.stdout);
}
