/**
 * @module DocsContractTest
 * @path tests/docs_contract_test.ts
 * @description The documentation gate: required documents, index membership, relative links and
 *   anchors, public JSDoc, whole-tree and CLI reference coverage, and internal phase references.
 *   The fixture cases prove each check rejects the condition it targets.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [docs/README.md, docs/reference/api.md, README.md]
 */

import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { dirname, join, relative, resolve } from "@std/path";
import { WHOLE_TREE_CHECKS } from "../src/rules/whole_tree/checks.ts";

const ROOT = join(import.meta.dirname!, "..");
const FIXTURES = join(import.meta.dirname!, "fixtures", "docs_gate");
const INDEX = "docs/README.md";

/** Every document this repository must ship. */
const REQUIRED_DOCUMENTS: readonly string[] = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "examples/README.md",
  "docs/README.md",
  "docs/user-guide.md",
  "docs/tutorial.md",
  "docs/glossary.md",
  "docs/troubleshooting.md",
  "docs/compatibility.md",
  "docs/reference/api.md",
  "docs/reference/config.md",
  "docs/reference/cli.md",
  "docs/reference/rules.md",
  "docs/reference/whole-tree-checks.md",
  "docs/reference/report-schema.md",
  "docs/concepts/architecture.md",
  "docs/concepts/comparison.md",
  "docs/how-to/hosts.md",
  "docs/how-to/migration.md",
  "docs/how-to/editing.md",
  "docs/how-to/lockfiles.md",
];

/** Every published entrypoint whose exported symbols need JSDoc. */
const ENTRYPOINTS: readonly string[] = [
  "mod.ts",
  "deno.ts",
  "eslint.ts",
  "src/cli/unslop.ts",
  "src/report/mod.ts",
  "src/metrics/mod.ts",
  "src/rules/whole_tree/mod.ts",
  "src/cli/rule_ceiling.ts",
  "src/cli/commands/deno_policy.ts",
];

interface IMarkdownLink {
  readonly target: string;
  readonly anchor: string | null;
}

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

/** Removes fenced code so link-like text in examples is ignored. */
function withoutFences(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, "");
}

function linksOf(markdown: string): IMarkdownLink[] {
  const links: IMarkdownLink[] = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const match of withoutFences(markdown).matchAll(pattern)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split("#", 2);
    links.push({ target: path, anchor: anchor ?? null });
  }
  return links;
}

/** GitHub-style heading slug, plus explicit `{#custom-anchor}` ids. */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of withoutFences(markdown).split("\n")) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (!heading) continue;
    const custom = /\{#([a-z0-9-]+)\}\s*$/.exec(heading[1]);
    if (custom) anchors.add(custom[1]);
    const slug = heading[1]
      .replace(/\{#[a-z0-9-]+\}\s*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    anchors.add(slug);
  }
  return anchors;
}

async function missingDocuments(root: string, required: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const document of required) {
    if (!(await fileExists(join(root, document)))) missing.push(document);
  }
  return missing;
}

async function unindexedDocuments(root: string, index: string, required: readonly string[]): Promise<string[]> {
  const indexPath = join(root, index);
  if (!(await fileExists(indexPath))) return [...required];
  const indexDir = dirname(indexPath);
  const linked = new Set(
    linksOf(await read(indexPath))
      .filter((link) => link.target.length > 0)
      .map((link) => relative(root, resolve(indexDir, link.target))),
  );
  return required.filter((document) => document !== index && !linked.has(document));
}

async function brokenLinks(root: string, files: readonly string[]): Promise<string[]> {
  const broken: string[] = [];
  for (const file of files) {
    const filePath = join(root, file);
    if (!(await fileExists(filePath))) continue;
    const base = dirname(filePath);
    for (const link of linksOf(await read(filePath))) {
      const targetPath = link.target.length === 0 ? filePath : resolve(base, link.target);
      if (!(await fileExists(targetPath))) {
        broken.push(`${file}: missing ${relative(root, targetPath)}`);
        continue;
      }
      if (link.anchor !== null) {
        const anchors = anchorsOf(await read(targetPath));
        if (!anchors.has(link.anchor)) broken.push(`${file}: missing anchor #${link.anchor}`);
      }
    }
  }
  return broken;
}

async function countMissingJsdoc(entry: string): Promise<number> {
  const command = new Deno.Command("deno", {
    args: ["doc", "--lint", entry],
    cwd: ROOT,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const text = `${new TextDecoder().decode(output.stdout)}${new TextDecoder().decode(output.stderr)}`;
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  let count = 0;
  for (const block of clean.split("error[missing-jsdoc]").slice(1)) {
    const location = /-->\s+(\S+):(\d+):(\d+)/.exec(block);
    if (!location) continue;
    const source = await read(location[1]).catch(() => "");
    const declaration = source.split("\n")[Number(location[2]) - 1] ?? "";
    if (declaration.trimStart().startsWith("export ")) count++;
  }
  return count;
}

function wholeTreeIds(): string[] {
  return Object.keys(WHOLE_TREE_CHECKS);
}

async function missingWholeTreeIds(reference: string): Promise<string[]> {
  if (!(await fileExists(reference))) return wholeTreeIds();
  const text = await read(reference);
  return wholeTreeIds().filter((id) => !text.includes(id));
}

/** Command groups parsed from the CLI usage block. */
async function cliGroups(): Promise<string[]> {
  const text = await read(join(ROOT, "src", "cli", "unslop.ts"));
  const groups = new Set<string>();
  for (const match of text.matchAll(/"\s+unslop\s+([a-z][a-z-]*)/g)) groups.add(match[1]);
  return [...groups].sort();
}

async function missingCliGroups(reference: string): Promise<string[]> {
  const groups = await cliGroups();
  if (!(await fileExists(reference))) return groups;
  const text = await read(reference);
  return groups.filter((group) => !text.includes(group));
}

async function phaseReferences(root: string, files: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const file of files) {
    const filePath = join(root, file);
    if (!(await fileExists(filePath))) continue;
    if (/\bPhase \d+/.test(await read(filePath))) found.push(file);
  }
  return found;
}

/** Every document that exists and belongs to the published set. */
async function existingDocuments(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const document of REQUIRED_DOCUMENTS) {
    if (await fileExists(join(root, document))) found.push(document);
  }
  return found;
}

Deno.test("docs-fixture: a missing required document is named", async () => {
  assertEquals(await missingDocuments(FIXTURES, ["present.md", "absent.md"]), ["absent.md"]);
});

Deno.test("docs-fixture: an unindexed document is named", async () => {
  assertEquals(await unindexedDocuments(FIXTURES, "index.md", ["present.md", "absent.md"]), ["absent.md"]);
});

Deno.test("docs-fixture: a broken link and a broken anchor are named", async () => {
  const broken = await brokenLinks(FIXTURES, ["broken.md.txt"]);
  assertArrayIncludes(broken, ["broken.md.txt: missing missing.md"]);
  assertArrayIncludes(broken, ["broken.md.txt: missing anchor #nope"]);
});

Deno.test("docs-fixture: an undocumented entrypoint reports a missing-jsdoc count", async () => {
  assert((await countMissingJsdoc(join(FIXTURES, "undocumented.ts"))) > 0);
});

Deno.test("docs-fixture: a phase reference is reported", async () => {
  assertEquals(await phaseReferences(FIXTURES, ["phase_ref.txt", "present.md"]), ["phase_ref.txt"]);
});

Deno.test("docs-fixture: a partial whole-tree reference is named", async () => {
  const missing = await missingWholeTreeIds(join(FIXTURES, "whole_tree_ref.md"));
  assert(missing.length > 0);
});

Deno.test("docs-fixture: a partial CLI reference is named", async () => {
  const missing = await missingCliGroups(join(FIXTURES, "cli_ref.md"));
  assert(missing.length > 0);
});

Deno.test("docs-contract: every required document exists", async () => {
  assertEquals(await missingDocuments(ROOT, REQUIRED_DOCUMENTS), []);
});

Deno.test("docs-contract: every required document is linked from the index", async () => {
  assertEquals(await unindexedDocuments(ROOT, INDEX, REQUIRED_DOCUMENTS), []);
});

Deno.test("docs-contract: no documented file has a broken relative link or anchor", async () => {
  assertEquals(await brokenLinks(ROOT, await existingDocuments(ROOT)), []);
});

Deno.test("docs-contract: every public entrypoint has JSDoc on its top-level declarations", async () => {
  for (const entry of ENTRYPOINTS) {
    assertEquals(await countMissingJsdoc(entry), 0, `${entry} has missing JSDoc`);
  }
});

Deno.test("docs-contract: the whole-tree reference covers every check", async () => {
  assertEquals(await missingWholeTreeIds(join(ROOT, "docs", "reference", "whole-tree-checks.md")), []);
});

Deno.test("docs-contract: the CLI reference covers every command group", async () => {
  assertEquals(await missingCliGroups(join(ROOT, "docs", "reference", "cli.md")), []);
});

Deno.test("docs-contract: no user document contains an internal phase reference", async () => {
  const documents = (await existingDocuments(ROOT)).filter((document) => !document.startsWith("docs/reference/api"));
  assertEquals(await phaseReferences(ROOT, documents), []);
});
