/**
 * @module TypeSafetyUpstreamCasesTest
 * @path packages/lint-rules/tests/type_safety_upstream_cases_test.ts
 * @description Upstream cases for the five type-safety rules, ported from anti-slop (MIT) at
 *   commit 13909c9e07590f5a85d93c62712259fe14a883f7, with upstream case names kept.
 *   A case whose local result differs from upstream carries its reason in `reason`.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/type_safety_rules.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "../mod.ts";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const RULES = [
  "demo/no-explicit-unknown",
  "demo/no-object-parameters",
  "demo/no-unsafe-dictionary",
] as const;

const PROD = "packages/x/src/a.ts";

function catalogFor(only: string): Record<string, JsonValue> {
  const rules: Record<string, JsonValue> = {};
  for (const id of RULES) {
    const off = id !== only;
    rules[id] = {
      engine: "plugin",
      severity: off ? "off" : "error",
      scope: "prod",
      ...(off ? { reason: "Not under test in this case." } : {}),
      tags: ["type-safety", "deslop"],
    };
  }
  return {
    version: "1",
    scopes: SCOPES,
    tagVocabulary: { "type-safety": { description: "Rules that keep type evidence." }, deslop: { description: "x" } },
    rules,
  };
}

/** A ported case. `reason` marks a case whose local result differs from upstream. */
interface ICase {
  readonly name: string;
  readonly code: string;
  readonly reason?: string;
}

interface IUpstreamGroup {
  readonly rule: string;
  readonly valid: readonly ICase[];
  readonly invalid: readonly ICase[];
}

function check(rule: string, code: string): number {
  const plugin = createTestPlugin(loadTestCatalog(catalogFor(rule)));
  return runPlugin(plugin, PROD, code).length;
}

function expectGroup(group: IUpstreamGroup): void {
  for (const [shouldReport, cases] of [[false, group.valid], [true, group.invalid]] as const) {
    for (const testCase of cases) {
      const count = check(group.rule, testCase.code);
      const detail = testCase.reason ? ` [changed from upstream: ${testCase.reason}]` : "";
      assertEquals(
        count > 0,
        shouldReport,
        `${group.rule} / ${testCase.name}: expected ${shouldReport ? "a report" : "no report"}${detail}`,
      );
    }
  }
}

// anti-slop no-unknown-parameters + no-unknown-returns + no-unknown-type-aliases, merged into
// demo/no-explicit-unknown. The local rule matches every `unknown` annotation, so several
// upstream-valid cases in the parameters/returns rules are reported here.

const NO_EXPLICIT_UNKNOWN: IUpstreamGroup = {
  rule: "demo/no-explicit-unknown",
  valid: [
    {
      name: "type-predicate function parameter",
      code: "function isString(value: unknown): value is string { return true; }",
    },
    { name: "type-predicate arrow parameter", code: "const isString = (value: unknown): value is string => true;" },
    { name: "asserts predicate parameter", code: "function assertString(value: unknown): asserts value is string {}" },
    { name: "declared predicate function", code: "declare function isString(value: unknown): value is string;" },
    { name: "predicate method signature", code: "type Guards = { isString(value: unknown): value is string };" },
    { name: "non-unknown parameter", code: "function parse(value: string | number): void {}" },
    { name: "inferred return", code: "function infer() { return input; }" },
    { name: "generic return", code: "function generic<Value>(): Value { return value; }" },
    {
      name: "every parameter of a predicate function is exempt",
      code: "function isString(value: unknown, context: unknown): value is string { return true; }",
      reason:
        "the local predicate exemption covers all parameters of the declared function, upstream reports the second parameter",
    },
  ],
  invalid: [
    { name: "unknown parameter", code: "function parse(value: unknown): void {}" },
    { name: "unknown union parameter", code: "function parse(value: string | unknown): void {}" },
    {
      name: "parenthesized unknown union parameter",
      code: "function parse(value: string | (number | unknown)): void {}",
    },
    { name: "destructured unknown parameter", code: "export function parse({ value }: unknown = {}): void {}" },
    { name: "unknown return", code: "function load(): unknown { return input; }" },
    { name: "unknown arrow return", code: "const load = (): unknown => input;" },
    { name: "unknown function-type return", code: "type Loader = () => unknown;" },
    { name: "unknown method return", code: "interface Loader { load(): unknown }" },
    { name: "declared unknown return", code: "declare function load(): unknown;" },
    { name: "unknown union return", code: "function load(): string | unknown { return input; }" },
    { name: "Promise<unknown> return", code: "function load(): Promise<unknown> { return promise; }" },
    {
      name: "unknown alias return",
      code: "type UnknownValue = unknown; function load(): UnknownValue { return input; }",
    },
    {
      name: "infer-name unknown alias",
      code: "type Item = unknown; type Fallback<Input> = Input extends infer Item ? string : () => Item;",
    },
    {
      name: "block-scoped unknown alias return",
      code: "function outer() { type Result = unknown; function load(): Result { return input; } }",
    },
    {
      name: "unknown type argument",
      code: "type Identity<T> = T; function load(): Identity<unknown> { return input; }",
    },
    {
      name: "unknown through a wrapped type argument",
      code:
        "type Identity<T> = T; type Wrapped<T> = Promise<Identity<T>>; function load(): Wrapped<unknown> { return promise; }",
    },
    { name: "unknown alias", code: "type Alias = unknown;" },
    { name: "unknown alias through a named alias", code: "type UnknownValue = unknown; type Alias = UnknownValue;" },
    { name: "unknown union alias", code: "type Payload = string | unknown;" },
    {
      name: "unknown alias through a nested union",
      code: "type Payload = string | unknown; type NestedPayload = number | Payload;",
    },
    { name: "unknown type argument alias", code: "type Identity<T> = T; type Payload = Identity<unknown>;" },
    { name: "block-scoped unknown alias", code: "function outer() { type Payload = unknown; }" },
    {
      name: "bare unknown parameter",
      code: "function enrich(cause: unknown): void {}",
      reason: "the local rule matches every unknown annotation, not only returns and aliases as upstream",
    },
    {
      name: "unknown union parameter (Error | unknown)",
      code: "function enrich(cause: Error | unknown): void {}",
      reason: "the local rule matches every unknown annotation",
    },
    {
      name: "unknown parameter in a function-type alias",
      code: "type Guard = (value: unknown) => value is string;",
      reason: "the local predicate exemption covers declared functions and methods, not function-type aliases",
    },
    {
      name: "top-level unknown alias",
      code: "type ImportedValue = unknown;",
      reason: "the local rule merges the alias rule, so a bare unknown alias is reported",
    },
    {
      name: "shadowed unknown alias",
      code: "type Value = unknown; function generic<Value>(): Value { return value; }",
      reason: "the local rule does not apply block-scope shadowing to an alias declaration",
    },
    {
      name: "unknown alias used as a mapped-type key",
      code: "type Key = unknown; type Mapped<Input> = { [Key in keyof Input]: () => Key };",
      reason: "the local rule matches the alias declaration without modelling the mapped-type key",
    },
    {
      name: "unknown alias used as an infer binding",
      code: "type Item = unknown; type Unpacked<Input> = Input extends Promise<infer Item> ? () => Item : never;",
      reason: "the local rule matches the alias declaration without modelling the infer binding",
    },
    {
      name: "unknown inside an object return type",
      code: "function cause(): { cause: unknown } { return { cause: input }; }",
      reason: "the local rule matches every unknown annotation, not only the top-level return",
    },
    {
      name: "unknown inside an aliased object return type",
      code: "type Result = { value: unknown }; function load(): Result { return result; }",
      reason: "the local rule matches every unknown annotation",
    },
    {
      name: "unknown alias shadowed inside a function",
      code: "type Value = unknown; function outer() { type Value = User; function load(): Value { return user; } }",
      reason: "the local rule does not apply block-scope shadowing to an alias declaration",
    },
    {
      name: "unknown type argument alias",
      code: "type Box<T> = { readonly value: T }; type Payload = Box<unknown>;",
      reason: "the local rule matches an unknown type argument, which the upstream alias rule allows",
    },
  ],
};

// anti-slop no-object-parameters maps to demo/no-object-parameters. The local rule reads the
// annotation from the parameter node directly and does not resolve local aliases.

const NO_OBJECT_PARAMETERS: IUpstreamGroup = {
  rule: "demo/no-object-parameters",
  valid: [
    { name: "object alias declaration", code: "type Alias = object;" },
    { name: "named interface parameter", code: "interface Owner { readonly id: string } function f(value: Owner) {}" },
    { name: "unconstrained generic parameter", code: "function f<Value>(value: Value) {}" },
    { name: "object-constrained generic parameter", code: "function f<Value extends object>(value: Value) {}" },
    {
      name: "object alias parameter is not resolved",
      code: "type Alias = object; function f(value: Alias) {}",
      reason: "the local rule does not resolve a local alias to object in a parameter position",
    },
    {
      name: "parenthesized object alias parameter is not resolved",
      code: "type Alias = (object); function f(value: Alias) {}",
      reason: "the local rule does not resolve a local alias to object in a parameter position",
    },
    {
      name: "object parameter with a default value",
      code: "function consume(value: object = {}): void {}",
      reason: "the local rule reads the annotation from the parameter node, so a default-value wrapper is missed",
    },
    {
      name: "destructured object parameter with a default value",
      code: "function consume({ value }: object = {}): void {}",
      reason: "the local rule reads the annotation from the parameter node, so a default-value wrapper is missed",
    },
    {
      name: "destructured object alias parameter",
      code: "type Bag = object; function consume({ value }: Bag): void {}",
      reason: "the local rule does not resolve a local alias to object in a parameter position",
    },
    {
      name: "object alias parameter in a nested function",
      code: "function outer() { type Payload = object; function consume(value: Payload) {} }",
      reason: "the local rule does not resolve a local alias to object in a parameter position",
    },
  ],
  invalid: [
    { name: "object parameter", code: "function f(value: object) {}" },
  ],
};

// anti-slop no-unsafe-dictionary-type maps to demo/no-unsafe-dictionary. The local rule also covers Map<K, V> and allows a generic constraint.
// It does not follow wrapper types or non-alias declarations in the value position.

const NO_UNSAFE_DICTIONARY: IUpstreamGroup = {
  rule: "demo/no-unsafe-dictionary",
  valid: [
    { name: "typed record", code: "type Commands = Record<string, Command>;" },
    { name: "PropertyKey record", code: "type Metadata = Record<PropertyKey, JsonValue>;" },
    { name: "typed index signature", code: "type Indexed = { [key: string]: Command };" },
    { name: "mapped type over a permission key", code: "type Exhaustive = { [K in Permission]: number };" },
    { name: "record with an object value type", code: "type Allowed = Record<string, { payload: unknown }>;" },
    {
      name: "generic record aliases",
      code: "type Index<T> = Record<string, T>; type EntityIndex<T extends Entity> = Record<string, T>;",
    },
    {
      name: "generic constraint is allowed",
      code: "type WithSchema<T extends Record<string, unknown>> = (schema: T) => void;",
    },
    {
      name: "generic constraint is allowed in a function",
      code: "function run<T extends Record<string, unknown>>(input: T): T { return input; }",
    },
    {
      name: "generic constraint is allowed in a class",
      code: "declare class Store<T extends Record<string, unknown>> { read(): T }",
    },
    {
      name: "unknown intersected with a named type",
      code: "interface Owner { readonly id: string } type A = Record<string, unknown & Owner>;",
    },
    {
      name: "mapped-type index signature is not checked",
      code: "type A = { [K in PropertyKey]: object };",
      reason: "the local rule checks a TSIndexSignature, not a mapped-type signature",
    },
    {
      name: "NonNullable in an index signature is not followed",
      code: "type A = { [key: string]: NonNullable<unknown> };",
      reason: "the local rule does not follow wrapper types in the value position",
    },
    {
      name: "empty-interface value is not resolved",
      code: "interface Escape {} type A = Record<string, Escape>;",
      reason: "the local rule resolves only type aliases, not interfaces, in the value position",
    },
    {
      name: "intersection with an empty object is not flattened",
      code: "type A = Record<string, unknown & {}>;",
      reason: "the local rule flattens unions, not intersections, in the value position",
    },
    {
      name: "generic record alias instantiation is not followed",
      code: "type Index<T> = Record<string, T>; type A = Index<unknown>;",
      reason: "the local rule does not follow a generic alias that expands to Record<K, V>",
    },
    {
      name: "Readonly of unknown is not followed",
      code: "type A = Record<string, Readonly<unknown>>;",
      reason: "the local rule does not follow wrapper types in the value position",
    },
    {
      name: "Readonly alias value is not followed",
      code: "type Escape = Readonly<unknown>; type A = Record<string, Escape>;",
      reason: "the local rule does not follow wrapper types in the value position",
    },
    {
      name: "generic default instantiation is not followed",
      code: "type Index<T = unknown> = Record<string, T>; type A = Index;",
      reason: "the local rule does not follow a generic alias default",
    },
  ],
  invalid: [
    { name: "unknown record", code: "type A = Record<string, unknown>;" },
    {
      name: "Map with an unknown value",
      code: "type A = Map<string, unknown>; type B = ReadonlyMap<string, unknown>; type C = WeakMap<object, unknown>;",
      reason: "the local rule includes Map<K, V> by the Step 6 decision, which upstream does not",
    },
    { name: "any index signature", code: "type A = { [key: string]: any };" },
    {
      name: "unknown union index signature",
      code: "type A = { [index: number]: Command; [key: string]: unknown | Command };",
    },
    { name: "empty object record", code: "type A = Record<string, {}>;" },
    { name: "unknown union record", code: "type A = Record<string, string | unknown>;" },
    { name: "unknown alias record", code: "type Escape = unknown; type A = Record<string, Escape>;" },
    { name: "unknown named record", code: "type Dict = Record<string, unknown>;" },
    { name: "readonly unknown index signature", code: "type A = { readonly [key: string]: unknown };" },
    { name: "unknown index signature", code: "interface A { [key: string]: unknown }" },
    { name: "readonly record wrapper", code: "type A = Readonly<Record<string, unknown>>;" },
  ],
};

Deno.test("no-explicit-unknown upstream cases", () => {
  expectGroup(NO_EXPLICIT_UNKNOWN);
});

Deno.test("no-object-parameters upstream cases", () => {
  expectGroup(NO_OBJECT_PARAMETERS);
});

Deno.test("no-unsafe-dictionary upstream cases", () => {
  expectGroup(NO_UNSAFE_DICTIONARY);
});
