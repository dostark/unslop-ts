/**
 * @module TypeScriptApiSurfaceTest
 * @path tests/typescript_api_surface_test.ts
 * @description Freezes the legacy TypeScript compiler-API surface that the engine whole-tree checks consume.
 * @architectural-layer Test
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/optional_params.ts, src/rules/whole_tree/unused_exports.ts, tests/whole_tree_optional_params_test.ts]
 */

import ts from "typescript";

const CONSUMER_FILES = [
  "src/rules/whole_tree/optional_params.ts",
  "src/rules/whole_tree/unused_exports.ts",
  "tests/whole_tree_optional_params_test.ts",
] as const;

const TS_API_ALLOWLIST = [
  "ConciseBody",
  "Expression",
  "ExportDeclaration",
  "FunctionBody",
  "Identifier",
  "Modifier",
  "NamedExports",
  "Node",
  "ParameterDeclaration",
  "ScriptTarget",
  "SignatureDeclaration",
  "SourceFile",
  "StringLiteral",
  "SyntaxKind",
  "createSourceFile",
  "forEachChild",
  "getLeadingCommentRanges",
  "isArrowFunction",
  "isBlock",
  "isAwaitExpression",
  "isCallExpression",
  "isClassDeclaration",
  "isConstructorDeclaration",
  "isEnumDeclaration",
  "isExportAssignment",
  "isExportDeclaration",
  "isFunctionDeclaration",
  "isFunctionExpression",
  "isIdentifier",
  "isImportDeclaration",
  "isInterfaceDeclaration",
  "isMethodDeclaration",
  "isModuleDeclaration",
  "isNamedExports",
  "isNamedImports",
  "isNamespaceImport",
  "isObjectBindingPattern",
  "isParameter",
  "isPropertyAccessExpression",
  "isStringLiteral",
  "isTypeAliasDeclaration",
  "isTypeReferenceNode",
  "isUnionTypeNode",
  "isVariableStatement",
  "VariableStatement",
] as const;

const allowlist = new Set<string>(TS_API_ALLOWLIST);

// Data members of the `ts` namespace are not API surface. Reading them (for example ts.version)
// must not force an allowlist expansion.
const TS_DATA_MEMBERS = ["version"] as const;
const dataMembers = new Set<string>(TS_DATA_MEMBERS);

function walkKinds(node: ts.Node, kinds: string[]): void {
  kinds.push(ts.SyntaxKind[node.kind]);
  ts.forEachChild(node, (child) => walkKinds(child, kinds));
}

/** Replaces every character except a newline with a space. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

function lineCommentEnd(source: string, start: number): number {
  const newline = source.indexOf("\n", start);
  return newline === -1 ? source.length : newline;
}

function blockCommentEnd(source: string, start: number): number {
  const close = source.indexOf("*/", start + 2);
  return close === -1 ? source.length : close + 2;
}

function quotedEnd(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length && source[index] !== quote) index += source[index] === "\\" ? 2 : 1;
  return Math.min(index + 1, source.length);
}

/** The end of the comment, string, or template that starts at `start`, or `start` when none does. */
function skippedEnd(source: string, start: number): number {
  const char = source[start];
  const next = source[start + 1];
  if (char === "/" && next === "/") return lineCommentEnd(source, start);
  if (char === "/" && next === "*") return blockCommentEnd(source, start);
  if (char === '"' || char === "'" || char === "`") return quotedEnd(source, start, char);
  return start;
}

/** Blanks out comments, string literals, and template literals while preserving newlines. */
function stripCommentsAndStrings(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const end = skippedEnd(source, index);
    if (end === index) {
      output += source[index];
      index += 1;
    } else {
      output += blank(source.slice(index, end));
      index = end;
    }
  }
  return output;
}

Deno.test("P4: comment and string ts.<ident> references produce no violations", () => {
  const content = [
    "const x = 1; // ts.version is data, not API",
    'const msg = "ts.createSourceFile should not flag";',
    "const tpl = `ts.${name}`;",
    "/* block start: ts.forEachChild documented in the runbook",
    " * continuation line: ts.Node mentioned in docs",
    " */",
    "const y = 2; /* trailing block: ts.SyntaxKind */",
    "const ok = ts.createSourceFile;",
  ].join("\n");
  const stripped = stripCommentsAndStrings(content);
  const usages = [...stripped.matchAll(/(?<![A-Za-z0-9_$])ts\.([A-Za-z_$][A-Za-z0-9_$]*)/g)]
    .map((m) => m[1]);
  for (const u of usages) {
    if (!allowlist.has(u) && !dataMembers.has(u)) {
      throw new Error(`comment/string ts.${u} flagged as API usage`);
    }
  }
  if (!usages.includes("createSourceFile")) {
    throw new Error("real ts.createSourceFile usage was stripped by the scanner");
  }
});

Deno.test("P4: a ts.version data reference in a consumer is exempt", () => {
  const line = "const version = ts.version;";
  const stripped = stripCommentsAndStrings(line);
  const usages = [...stripped.matchAll(/(?<![A-Za-z0-9_$])ts\.([A-Za-z_$][A-Za-z0-9_$]*)/g)]
    .map((m) => m[1]);
  for (const u of usages) {
    if (!allowlist.has(u) && !dataMembers.has(u)) {
      throw new Error(`data member ts.${u} flagged as API usage in: ${line}`);
    }
  }
});

Deno.test("P4: createSourceFile + forEachChild walk works on the legacy API", () => {
  const source = ts.createSourceFile(
    "sample.ts",
    "function alpha(x: number): number {\n  if (x > 0) return x;\n  return x;\n}",
    ts.ScriptTarget.Latest,
    true,
  );
  const kinds: string[] = [];
  walkKinds(source, kinds);
  for (const expected of ["SourceFile", "FunctionDeclaration", "IfStatement", "Identifier"]) {
    if (!kinds.includes(expected)) {
      throw new Error(`expected ${expected} in walk, got kinds: ${kinds.join(",")}`);
    }
  }
  if (kinds.length < 10) {
    throw new Error(`walk produced unexpectedly few nodes: ${kinds.length}`);
  }
});

Deno.test("P4: engine checks use only the recorded ts.<ident> API surface", () => {
  const root = new URL("..", import.meta.url);
  const pattern = /(?<![A-Za-z0-9_$])ts\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const violations: string[] = [];

  for (const rel of CONSUMER_FILES) {
    const content = stripCommentsAndStrings(Deno.readTextFileSync(new URL(rel, root)));
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      pattern.lastIndex = 0;
      for (const match of lines[i].matchAll(pattern)) {
        const ident = match[1];
        if (!allowlist.has(ident) && !dataMembers.has(ident)) violations.push(`${rel}:${i + 1} — ts.${ident}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `ts.<ident> usages outside the recorded API surface (${allowlist.size} identifiers):\n` +
        violations.join("\n") +
        "\nRecorded surface lives in tests/typescript_api_surface_test.ts. Expanding it is a reviewed event.",
    );
  }
});
