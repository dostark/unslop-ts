/**
 * @module WholeTreeOptionalParams
 * @path packages/lint-rules/src/rules/whole_tree/optional_params.ts
 * @description Optional parameters whose optionality does not match usage. Whole-tree rule
 *   (TypeScript compiler API), moved from scripts/check_optional_params.ts.
 * @architectural-layer Shared
 * @dependencies [typescript, @std/fs]
 * @related-files [packages/lint-rules/src/rules/whole_tree/options.ts, packages/lint-rules/src/cli/whole_tree.ts]
 * @public Exports are the unit-test surface of this module.
 */

import ts from "typescript";
import { walk } from "@std/fs";
import type { IOptionalParamsSettings } from "./options.ts";

/** A collected parameter. */
export interface IFuncParam {
  readonly name: string;
  /** 0-based position in the parameter list. */
  readonly index: number;
  /** True when the parameter has `?` or a default value. */
  readonly isOptional: boolean;
  readonly hasQuestionToken: boolean;
  /** Position of the `?` token, or -1. */
  readonly qTokenPos: number;
  /** Position after the type annotation, or -1. */
  readonly typeEndPos: number;
  /** True when the type is wrapped with the configured wrapper. */
  readonly intentional: boolean;
  /** True when optional via a bare `?` or `| undefined`. */
  readonly bareOptional: boolean;
  /** Rendered type annotation. */
  readonly typeText: string;
}

/** A collected function or method declaration. */
export interface IFuncDecl {
  readonly name: string;
  readonly params: readonly IFuncParam[];
  readonly optionalCount: number;
  readonly requiredCount: number;
  readonly file: string;
  readonly line: number;
  readonly optionalUsedInBody: readonly boolean[];
}

/** A collected call site. */
export interface ICallSite {
  readonly name: string;
  readonly argCount: number;
  readonly file: string;
  readonly line: number;
}

export type TOptionalViolationKind =
  | "REDUNDANT_OPTIONAL"
  | "UNUSED_OPTIONAL"
  | "MARKED_NOT_OPTIONAL"
  | "BARE_OPTIONAL";

/** One optional-parameter finding. */
export interface IOptionalViolation {
  readonly kind: TOptionalViolationKind;
  readonly message: string;
  readonly funcFile: string;
  readonly funcLine: number;
  readonly optionalParam: string;
  readonly callerCount: number;
  readonly callersPassing: number;
  readonly callersOmitting: number;
  readonly qTokenPos: number;
  /** Position after the type annotation, or -1. */
  readonly typeEndPos: number;
}

function isTestFilePath(filePath: string, settings: IOptionalParamsSettings): boolean {
  return settings.testSegments.some((segment) => filePath.includes(segment)) ||
    settings.testSuffixes.some((suffix) => filePath.endsWith(suffix));
}

function isSkippedPath(filePath: string, settings: IOptionalParamsSettings): boolean {
  return settings.skipSegments.some((segment) => filePath.includes(segment));
}

/** True when a parameter is wrapped with the configured optionality wrapper. */
export function isWrapperType(
  param: ts.ParameterDeclaration,
  settings: IOptionalParamsSettings,
): boolean {
  if (!param.type || !ts.isTypeReferenceNode(param.type)) return false;
  const typeName = ts.isIdentifier(param.type.typeName) ? param.type.typeName.text : "";
  return typeName === settings.wrapperType;
}

/** True when a parameter is optional via a bare `?` or a bare `| undefined` union. */
export function hasBareOptional(
  param: ts.ParameterDeclaration,
  settings: IOptionalParamsSettings,
): boolean {
  if (isWrapperType(param, settings)) return false;
  if (param.questionToken) return true;
  if (param.type && ts.isUnionTypeNode(param.type)) {
    return param.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword);
  }
  return false;
}

/** The hint that shows the wrapper rewrite for a bare-optional parameter. */
function bareOptionalMessage(
  param: { name: string; typeText: string; hasQuestionToken: boolean },
  settings: IOptionalParamsSettings,
): string {
  const inner = param.typeText.replace(/\s*\|\s*undefined\b/, "").trim();
  const question = param.hasQuestionToken ? "?" : "";
  const shown = param.typeText.length > 0
    ? `\`${param.name}${question}: ${param.typeText}\``
    : `\`${param.name}?\` (implicit type)`;
  const innerHint = inner.length > 0 ? inner : "T";
  return `'${param.name}' is optional without a codified reason (${shown}) — declare it with the ${settings.wrapperType} wrapper: \`${param.name}?: ${settings.wrapperType}<${innerHint}, Reason.*>\` (import ${settings.wrapperType} + Reason from ${settings.wrapperImport}; pick a Reason that fits, e.g. ${
    settings.reasonExamples.join(" / ")
  }). A bare \`?\` and a bare \`| undefined\` are equivalent and both require ${settings.wrapperType}.`;
}

/** True when a node or its children reference a parameter name. */
function paramNameUsedInBody(body: ts.FunctionBody, paramName: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === paramName) {
      const isDeclaration = node.parent && ts.isParameter(node.parent) && node.parent.name === node;
      if (!isDeclaration) found = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

function collectParams(
  node: ts.SignatureDeclaration,
  sourceFile: ts.SourceFile,
  settings: IOptionalParamsSettings,
): IFuncParam[] {
  const params: IFuncParam[] = [];
  for (let index = 0; index < node.parameters.length; index++) {
    const param = node.parameters[index];
    if (!ts.isIdentifier(param.name)) continue;
    const hasQuestionToken = !!param.questionToken;
    params.push({
      name: param.name.text,
      index,
      isOptional: hasQuestionToken || !!param.initializer,
      hasQuestionToken,
      qTokenPos: param.questionToken ? param.questionToken.pos : -1,
      typeEndPos: param.type ? param.type.end : -1,
      intentional: isWrapperType(param, settings),
      bareOptional: hasBareOptional(param, settings),
      typeText: param.type ? param.type.getText(sourceFile) : "",
    });
  }
  return params;
}

function isFunctionLike(node: ts.Node): node is ts.SignatureDeclaration & { body?: ts.ConciseBody } {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) || ts.isFunctionExpression(node);
}

function usedInBodyFlags(params: readonly IFuncParam[], func: { body?: ts.ConciseBody }): boolean[] {
  const body = func.body;
  return params.map((param) =>
    param.isOptional && body && ts.isBlock(body) ? paramNameUsedInBody(body, param.name) : false
  );
}

/** Collect function and method declarations that carry an optionality signal. */
export function collectFunctions(
  sourceFile: ts.SourceFile,
  funcs: Map<string, IFuncDecl[]>,
  settings: IOptionalParamsSettings,
): void {
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) {
      const declaredName = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const name = declaredName ?? `__anon@${sourceFile.fileName}:${line}`;
      const params = collectParams(node, sourceFile, settings);
      const optionalCount = params.filter((param) => param.isOptional).length;
      const bareOptionalCount = params.filter((param) => param.bareOptional).length;
      if (optionalCount > 0 || bareOptionalCount > 0) {
        if (!funcs.has(name)) funcs.set(name, []);
        funcs.get(name)!.push({
          name,
          params,
          optionalCount,
          requiredCount: params.length - optionalCount,
          file: sourceFile.fileName,
          line,
          optionalUsedInBody: usedInBodyFlags(params, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

/** Collect every call site name and argument count. */
function collectCallSites(sourceFile: ts.SourceFile, calls: ICallSite[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const name = ts.isIdentifier(expr)
        ? expr.text
        : ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)
        ? expr.name.text
        : null;
      if (name) {
        calls.push({
          name,
          argCount: node.arguments.length,
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

function markNotOptional(decl: IFuncDecl, param: IFuncParam, active: boolean): IOptionalViolation | null {
  if (!param.intentional || param.isOptional || active) return null;
  return {
    kind: "MARKED_NOT_OPTIONAL",
    message:
      `'${param.name}' uses the wrapper but is not optional — add ? or a default value to match the marker's intent`,
    funcFile: decl.file,
    funcLine: decl.line,
    optionalParam: param.name,
    callerCount: 0,
    callersPassing: 0,
    callersOmitting: 0,
    qTokenPos: param.qTokenPos,
    typeEndPos: param.typeEndPos,
  };
}

function bareOptionalViolation(
  decl: IFuncDecl,
  param: IFuncParam,
  settings: IOptionalParamsSettings,
): IOptionalViolation {
  return {
    kind: "BARE_OPTIONAL",
    message: bareOptionalMessage(param, settings),
    funcFile: decl.file,
    funcLine: decl.line,
    optionalParam: param.name,
    callerCount: 0,
    callersPassing: 0,
    callersOmitting: 0,
    qTokenPos: param.qTokenPos,
    typeEndPos: param.typeEndPos,
  };
}

/** Caller-independent type-shape rules (BARE_OPTIONAL, MARKED_NOT_OPTIONAL). */
export function collectTypeShapeViolations(
  funcs: Map<string, IFuncDecl[]>,
  settings: IOptionalParamsSettings,
): IOptionalViolation[] {
  const violations: IOptionalViolation[] = [];
  for (const decls of funcs.values()) {
    for (const decl of decls) {
      const lastRequiredIndex = decl.params.reduce((acc, param, index) => (param.isOptional ? acc : index), -1);
      for (const param of decl.params) {
        if (param.bareOptional) violations.push(bareOptionalViolation(decl, param, settings));
        const marked = markNotOptional(decl, param, param.index < lastRequiredIndex);
        if (marked) violations.push(marked);
      }
    }
  }
  return violations;
}

interface IMatchedFunc {
  readonly decl: IFuncDecl;
  readonly calls: readonly ICallSite[];
}

/** Dedupe declarations by name, keeping the widest signature, paired with its call sites. */
function matchCallsToFuncs(
  funcs: Map<string, IFuncDecl[]>,
  calls: readonly ICallSite[],
): IMatchedFunc[] {
  const matched: IMatchedFunc[] = [];
  for (const [name, decls] of funcs) {
    const matchingCalls = calls.filter((call) => call.name === name);
    const fullDecl = decls.reduce((a, b) => (a.params.length >= b.params.length ? a : b));
    matched.push({ decl: fullDecl, calls: matchingCalls });
  }
  return matched;
}

function callerViolations(decl: IFuncDecl, calls: readonly ICallSite[], param: IFuncParam): IOptionalViolation[] {
  if (param.intentional) return [];
  const callersPassing = calls.filter((call) => call.argCount > param.index).length;
  const callersOmitting = calls.filter((call) => call.argCount <= param.index).length;
  const base = {
    funcFile: decl.file,
    funcLine: decl.line,
    optionalParam: param.name,
    callerCount: calls.length,
    callersPassing,
    callersOmitting,
    qTokenPos: param.qTokenPos,
    typeEndPos: param.typeEndPos,
  };
  const violations: IOptionalViolation[] = [];
  if (callersPassing === calls.length && param.hasQuestionToken) {
    violations.push({
      ...base,
      kind: "REDUNDANT_OPTIONAL",
      message: `'${param.name}' is optional (?) but all ${calls.length} callers pass it — should be required`,
    });
  }
  if (callersPassing === 0 && decl.optionalUsedInBody[param.index]) {
    violations.push({
      ...base,
      kind: "UNUSED_OPTIONAL",
      message:
        `'${param.name}' is optional (?) with ${calls.length} calls, none pass it — but IS used in body; possible wiring gap`,
    });
  }
  return violations;
}

/** Caller-dependent rules (REDUNDANT_OPTIONAL, UNUSED_OPTIONAL). */
export function analyze(matched: readonly IMatchedFunc[]): IOptionalViolation[] {
  const violations: IOptionalViolation[] = [];
  for (const { decl, calls } of matched) {
    if (decl.optionalCount === 0 || calls.length === 0) continue;
    for (const param of decl.params) {
      if (param.isOptional) violations.push(...callerViolations(decl, calls, param));
    }
  }
  return violations;
}

/** The repository `.ts`/`.tsx` files in scope for the whole-tree run. */
async function collectTargetFiles(
  repoRoot: string,
  includeTests: boolean,
  settings: IOptionalParamsSettings,
): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(repoRoot, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: [/[/\\]\.git[/\\]/, /[/\\]node_modules[/\\]/, /[/\\]dist[/\\]/, /[/\\]coverage[/\\]/],
    })
  ) {
    if (settings.walkSkipSegments.some((segment) => entry.path.includes(segment))) continue;
    if (isSkippedPath(entry.path, settings)) continue;
    if (!includeTests && isTestFilePath(entry.path, settings)) continue;
    files.push(entry.path);
  }
  return files;
}

/** Walk a repository checkout and report its optional-parameter findings. */
export async function checkRepository(
  repoRoot: string,
  includeTests: boolean,
  settings: IOptionalParamsSettings,
): Promise<IOptionalViolation[]> {
  const files = await collectTargetFiles(repoRoot, includeTests, settings);
  const funcs = new Map<string, IFuncDecl[]>();
  const calls: ICallSite[] = [];
  const sources: Array<{ file: string; sourceFile: ts.SourceFile }> = [];
  for (const file of files) {
    const sourceFile = ts.createSourceFile(file, await Deno.readTextFile(file), ts.ScriptTarget.Latest, true);
    sources.push({ file, sourceFile });
    collectFunctions(sourceFile, funcs, settings);
  }
  for (const { sourceFile } of sources) collectCallSites(sourceFile, calls);
  return [...collectTypeShapeViolations(funcs, settings), ...analyze(matchCallsToFuncs(funcs, calls))];
}
