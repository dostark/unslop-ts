/**
 * @module CheckCodeStyleTest
 * @path packages/lint-rules/tests/check_code_style_test.ts
 * @description Regression tests for the moved style checker, including test-file multiline fixture detection.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");

async function runCheckCodeStyle(filePath: string): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config=deno.json", "-A", "packages/lint-rules/src/exaix/check_code_style.ts", filePath],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

  return { code: result.code, output };
}

Deno.test("check_code_style flags inline multiline fixture text in test files", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "inline_fixture_test.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempInlineFixtureTest
 * @path packages/lint-rules/tests/inline_fixture_test.ts
 */

Deno.test("inline fixture markdown", () => {
  const markdown = \Deno.readTextFileSync(join(FIXTURE_ROOT, 'packages', 'lint-rules', 'tests', 'fixtures', 'check_code_style_test', 'markdown.md'));
  assertEquals(markdown.includes("Bad"), true);
});
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 1);
  assertStringIncludes(result.output, "Header is missing mandatory '@description' tag.");
});

Deno.test("check_code_style does not flag same inline multiline text in non-test files", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "inline_fixture.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempInlineFixtureNonTest
 * @path tests/scripts/inline_fixture.ts
 * @description Temporary non-test fixture file for code style regression coverage.
 */

const markdown = \Deno.readTextFileSync(join(FIXTURE_ROOT, 'packages', 'lint-rules', 'tests', 'fixtures', 'check_code_style_test', 'markdown.md'));
export { markdown };
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 0, result.output);
});

Deno.test("check_code_style flags deep imports into package tests when a public testing subpath exists", async () => {
  const filePath = join(REPO_ROOT, "tests", "scripts", "__temp_package_testing_deep_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageTestingDeepImport
 * @path tests/scripts/__temp_package_testing_deep_import.ts
 * @description Temporary regression file for package testing-subpath import enforcement.
 */

import { TEST_DEFAULT_BRANCH } from "../../packages/git/tests/helpers/constants.ts";

console.log(TEST_DEFAULT_BRANCH);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-testing-import]");
    assertStringIncludes(result.output, "@exaix/git/testing");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style allows root import of testing shims (rule removed)", async () => {
  const filePath = join(REPO_ROOT, "tests", "scripts", "__temp_package_testing_shim_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageTestingShimImport
 * @path tests/scripts/__temp_package_testing_shim_import.ts
 * @description Temporary regression file for root testing shim import enforcement.
 */

import { TEST_DEFAULT_BRANCH } from "../helpers/constants.ts";

console.log(TEST_DEFAULT_BRANCH);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);
    // [package-testing-import] rule was removed; style check now passes.
    assertEquals(result.code, 0, result.output);
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style allows compatibility re-export shims under tests helpers", async () => {
  const filePath = join(REPO_ROOT, "tests", "helpers", "__temp_git_testing_shim.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempGitTestingShim
 * @path tests/helpers/__temp_git_testing_shim.ts
 * @description Temporary compatibility shim regression file for code style coverage.
 */

export { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 0, result.output);
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test.ignore(
  "check_code_style flags deep src imports into package-owned runtime surfaces when a canonical package alias exists",
  async () => {
    const tempDir = await Deno.makeTempDir();
    await Deno.mkdir(join(tempDir, "packages", "somepkg", "src"), { recursive: true });
    await Deno.mkdir(join(tempDir, "packages", "mcp", "server"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "packages", "mcp", "server", "local_tool_dispatcher.ts"),
      `export class LocalToolDispatcher {}`,
    );
    const filePath = join(tempDir, "packages", "somepkg", "src", "__temp_package_runtime_import.ts");
    await Deno.writeTextFile(
      filePath,
      `/**
 * @module TempPackageRuntimeImport
 * @path packages/somepkg/src/__temp_package_runtime_import.ts
 * @description Temporary regression file for canonical package runtime import enforcement.
 */

import { LocalToolDispatcher as LocalToolDispatcherBase } from "../../../mcp/server/local_tool_dispatcher.ts";

export class LocalToolDispatcher extends LocalToolDispatcherBase {}
`,
    );

    try {
      const result = await runCheckCodeStyle(filePath);

      assertEquals(result.code, 1, result.output);
      assertStringIncludes(result.output, "[package-canonical-import]");
      assertStringIncludes(result.output, "@exaix-team/mcp-server");
    } finally {
      await Deno.remove(filePath);
    }
  },
);

Deno.test("check_code_style flags deep package alias imports when a canonical subpath barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_package_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageAliasImport
 * @path __temp_package_alias_import.ts
 * @description Temporary regression file for canonical package subpath alias enforcement.
 */

import { parsePortalURI } from "@exaix-team/mcp-server/resources.ts";

console.log(parsePortalURI);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix-team/mcp-server");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep logger package alias imports when a canonical logger barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_package_logger_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageLoggerAliasImport
 * @path __temp_package_logger_alias_import.ts
 * @description Temporary regression file for canonical logger barrel enforcement.
 */

import { EventLogger } from "@exaix/core/logger/event_logger.ts";

console.log(EventLogger);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/core/logger");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep config package alias imports when a canonical config barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_package_config_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPackageConfigAliasImport
 * @path __temp_package_config_alias_import.ts
 * @description Temporary regression file for canonical config barrel enforcement.
 */

import { ConfigService } from "@exaix/core/config/service.ts";

console.log(ConfigService);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/core/config");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep ai provider imports when a canonical providers barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_ai_provider_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempAiProviderAliasImport
 * @path __temp_ai_provider_alias_import.ts
 * @description Temporary regression file for canonical ai providers barrel enforcement.
 */

import { MockLLMProvider } from "@exaix/ai/providers/mock_llm_provider.ts";

console.log(MockLLMProvider);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/ai/providers");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags deep core status imports when a canonical status barrel exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "__temp_core_status_alias_import.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempCoreStatusAliasImport
 * @path __temp_core_status_alias_import.ts
 * @description Temporary regression file for canonical core status barrel enforcement.
 */

import { RequestStatus } from "@exaix/core/status/request_status.ts";

console.log(RequestStatus);
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-canonical-import]");
    assertStringIncludes(result.output, "@exaix/core/status");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style flags parent package barrels that promote canonical subpackage exports", async () => {
  const filePath = join(REPO_ROOT, "packages", "core", "mod.ts");
  const originalContent = await Deno.readTextFile(filePath);
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempParentPackagePromotion
 * @path packages/core/mod.ts
 * @description Temporary regression file for parent package barrel promotion enforcement.
 */

export * from "./src/status/mod.ts";
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-subpath-promotion]");
    assertStringIncludes(result.output, "@exaix/core/status");
  } finally {
    await Deno.writeTextFile(filePath, originalContent);
  }
});

Deno.test("fix(check_code_style): flags package headers that reference retired root src ownership paths", async () => {
  const filePath = join(REPO_ROOT, "packages", "core", "src", "types", "__temp_related_files_root_src.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module ITempRelatedFilesRootSrc
 * @path packages/core/src/types/__temp_related_files_root_src.ts
 * @description Temporary regression file for package header related-files validation.
 * @related-files ["src/services/core/db.ts"]
 */

export interface ITempRelatedFilesRootSrc {
  ok: boolean;
}
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "[package-related-files-boundary]");
    assertStringIncludes(result.output, "src/services/core/db.ts");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("check_code_style allows parent package barrels to export the root-owned core types surface", async () => {
  const filePath = join(REPO_ROOT, "packages", "core", "mod.ts");
  const originalContent = await Deno.readTextFile(filePath);
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempParentPackageTypesExport
 * @path packages/core/mod.ts
 * @description Temporary regression file for root-owned core types export allowance.
 */

export type { Actor } from "./src/types/actor.ts";
`,
  );

  try {
    const result = await runCheckCodeStyle(filePath);

    assertEquals(result.code, 0, result.output);
  } finally {
    await Deno.writeTextFile(filePath, originalContent);
  }
});

Deno.test("check_code_style flags a block comment longer than three lines outside the module header", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "long_block_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempLongBlockComment
 * @path long_block_comment.ts
 * @description Temporary regression file for long in-module comment enforcement.
 */

export function run(): number {
  /*
   * one
   * two
   * three
   */
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[long-comment]");
});

Deno.test("check_code_style flags a run of consecutive line comments longer than three lines", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "long_line_comment_run.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempLongLineCommentRun
 * @path long_line_comment_run.ts
 * @description Temporary regression file for long line-comment run enforcement.
 */

export function run(): number {
  // one
  // two
  // three
  // four
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[long-comment]");
});

Deno.test("check_code_style allows an in-module comment of exactly three lines", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "short_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempShortComment
 * @path short_comment.ts
 * @description Temporary regression file confirming three-line comments are allowed.
 */

export function run(): number {
  // one
  // two
  // three
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.output.includes("[long-comment]"), false, result.output);
});

Deno.test("check_code_style does not flag the module's own header comment for length", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "long_header.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempLongHeader
 * @path long_header.ts
 * @description Temporary regression file confirming the module header is exempt
 *   from the in-module comment length rule regardless of how many lines it uses.
 * @related-files []
 */

export function run(): number {
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.output.includes("[long-comment]"), false, result.output);
});

Deno.test("check_code_style flags a comment referencing a phase or step number", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "ephemeral_phase_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempEphemeralPhaseComment
 * @path ephemeral_phase_comment.ts
 * @description Temporary regression file for ephemeral phase-reference enforcement.
 */

export function run(): number {
  // Phase 12 Step 3: wire this up.
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[ephemeral-comment]");
});

Deno.test("check_code_style flags a comment narrating a prior failed attempt", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "ephemeral_attempt_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempEphemeralAttemptComment
 * @path ephemeral_attempt_comment.ts
 * @description Temporary regression file for ephemeral prior-attempt enforcement.
 */

export function run(): number {
  // We tried caching here but it didn't work.
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[ephemeral-comment]");
});

Deno.test("check_code_style flags a comment referencing a specific GAP identifier or post-gap analysis", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "ephemeral_gap_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempEphemeralGapComment
 * @path ephemeral_gap_comment.ts
 * @description Temporary regression file for ephemeral GAP-reference enforcement.
 */

export function run(): number {
  // GAP-12 remediation: validate inputs.
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[ephemeral-comment]");
});

Deno.test("check_code_style flags a comment referencing a document section via §", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "ephemeral_section_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempEphemeralSectionComment
 * @path ephemeral_section_comment.ts
 * @description Temporary regression file for ephemeral §-reference enforcement.
 */

export function run(): number {
  // Read-only tools skip re-validation here (§5.9).
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[ephemeral-comment]");
});

Deno.test("check_code_style flags calendar dates in common numeric and named forms", async () => {
  const dateForms = [
    "2026-08-31",
    "20260831",
    "31/08/2026",
    "08/31/26",
    "August 31, 2026",
    "31 Aug 2026",
    "August 2026",
    "Q3 2026",
  ];

  for (const [index, dateForm] of dateForms.entries()) {
    const tempDir = await Deno.makeTempDir();
    const filePath = join(tempDir, `ephemeral_date_comment_${index}.ts`);
    await Deno.writeTextFile(
      filePath,
      `/**
 * @module TempEphemeralDateComment
 * @path ephemeral_date_comment.ts
 * @description Temporary regression file for date-reference enforcement.
 */

export function run(): number {
  const value = 1; // Released on ${dateForm}.
  return value;
}
`,
    );

    const result = await runCheckCodeStyle(filePath);

    assertStringIncludes(result.output, "[ephemeral-comment]", dateForm);
    assertStringIncludes(result.output, "calendar date", dateForm);
  }
});

Deno.test("check_code_style flags a calendar date in the module header", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "ephemeral_header_date.ts");
  const headerDate = "2026-08-31";
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempEphemeralHeaderDate
 * @path ephemeral_header_date.ts
 * @description Generated on ${headerDate} for date-reference enforcement.
 */

export const value = 1;
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[ephemeral-comment]");
  assertStringIncludes(result.output, "calendar date");
});

Deno.test("check_code_style allows date-shaped text outside comments", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "runtime_date_string.ts");
  const runtimeDate = "2026-08-31";
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempRuntimeDateString
 * @path runtime_date_string.ts
 * @description Confirms runtime data is outside comment discipline.
 */

export const releaseDate = "${runtimeDate}";
export const releaseNote = \`// Released on ${runtimeDate}.\`;
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.output.includes("[ephemeral-comment]"), false, result.output);
});

Deno.test("check_code_style allows natural language usage of the word gap", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "natural_gap_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempNaturalGapComment
 * @path natural_gap_comment.ts
 * @description Temporary regression file for natural gap word allowance.
 */

export function run(): number {
  // Check the price gap between models.
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.output.includes("[ephemeral-comment]"), false, result.output);
});

Deno.test("check_code_style flags a decorative comment separator", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "decorative_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempDecorativeComment
 * @path decorative_comment.ts
 * @description Temporary regression file for decorative-separator enforcement.
 */

export function run(): number {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertStringIncludes(result.output, "[decorative-comment]");
});

Deno.test("check_code_style allows a plain comment with a short parenthetical dash", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "plain_dash_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempPlainDashComment
 * @path plain_dash_comment.ts
 * @description Temporary regression file for plain dash allowance.
 */

export function run(): number {
  // Helpers -- kept short on purpose.
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.output.includes("[decorative-comment]"), false, result.output);
});

Deno.test("check_code_style allows a comment echoing a triple-equals code comparison", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "code_echo_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempCodeEchoComment
 * @path code_echo_comment.ts
 * @description Temporary regression file for triple-equals code-echo allowance.
 */

export function run(): number {
  // No migration records (inputHash === "") — only real execution records
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.output.includes("[decorative-comment]"), false, result.output);
});

Deno.test("check_code_style allows a comment quoting a markdown heading example", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "markdown_heading_comment.ts");
  await Deno.writeTextFile(
    filePath,
    `/**
 * @module TempMarkdownHeadingComment
 * @path markdown_heading_comment.ts
 * @description Temporary regression file for markdown-heading-example allowance.
 */

export function run(): number {
  // Extract ATX headings (\`#\` … \`######\`) from markdown text.
  return 1;
}
`,
  );

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.output.includes("[decorative-comment]"), false, result.output);
});

Deno.test("check_code_style does not exempt lines after a backtick inside a regex literal", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "backtick_regex_mask.ts");
  const lines = [
    "/**",
    " * @module TempBacktickRegexMask",
    " * @path backtick_regex_mask.ts",
    " * @description Temporary fixture: a regex backtick must not mask later lines.",
    " */",
    "",
    'const stripBackticks = (s: string): string => s.replace(/[\\$`]/g, "");',
    "const value: unknown = {};",
    "",
  ];
  await Deno.writeTextFile(filePath, lines.join("\n"));

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 1, result.output);
  assertStringIncludes(result.output, "[explicit-unknown]");
  assertStringIncludes(result.output, `${filePath}:8`);
});

Deno.test("check_code_style exempts text inside a real multi-line template literal", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "template_text.ts");
  const lines = [
    "/**",
    " * @module TempTemplateText",
    " * @path template_text.ts",
    " * @description Temporary fixture: template text is not code.",
    " */",
    "",
    "export const guidance = `",
    "  Never write unknown in code;",
    "  name the shape at the boundary instead.",
    "`;",
    "",
  ];
  await Deno.writeTextFile(filePath, lines.join("\n"));

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 0, result.output);
  assertEquals(result.output.includes("[explicit-unknown]"), false, result.output);
});

Deno.test("check_code_style is not fooled by comment, escaped-string, or nested template backticks", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = join(tempDir, "backtick_forms.ts");
  const lines = [
    "/**",
    " * @module TempBacktickForms",
    " * @path backtick_forms.ts",
    " * @description Temporary fixture: backtick forms must not mask later lines.",
    " */",
    "",
    "// A comment that mentions a single backtick `",
    'export const escaped = "a \\` b";',
    "const nested = `",
    "  outer ${`inner`} text",
    "`;",
    "const value: unknown = {};",
    "",
  ];
  await Deno.writeTextFile(filePath, lines.join("\n"));

  const result = await runCheckCodeStyle(filePath);

  assertEquals(result.code, 1, result.output);
  assertStringIncludes(result.output, "[explicit-unknown]");
  assertStringIncludes(result.output, `${filePath}:12`);
});
