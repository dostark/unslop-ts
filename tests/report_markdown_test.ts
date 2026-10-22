/**
 * @module ReportMarkdownTest
 * @path tests/report_markdown_test.ts
 * @description The Markdown report escapes table/link content and matches a golden file.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/markdown.ts, tests/helpers/report_fixture.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { markdownReport } from "../src/report/markdown.ts";
import { markdownFixture } from "./helpers/report_fixture.ts";

Deno.test("markdown_report_matches_the_golden_file", async () => {
  const report = markdownFixture();
  const markdown = markdownReport(report);
  const golden = await Deno.readTextFile(new URL("./fixtures/report_markdown_golden.md", import.meta.url));
  assertEquals(markdown, golden);
  assert(markdown.includes("\\|"));
  assert(markdown.includes("src/a%20%5Bx%5D%23100%25.ts"));
  assert(markdown.includes("partial"));
  assert(markdown.includes("Foreign findings"));
});
