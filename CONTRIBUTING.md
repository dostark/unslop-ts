# Contributing

## Setup

Use Deno 2.9. Clone the repository and run the checks from its root:

```sh
deno task test
deno task lint
deno task check
deno fmt --check
```

`deno task test` runs the Deno suite. The Node and Bun host suites run through npm or Bun:

```sh
npm ci --prefix hosts --ignore-scripts
npm --prefix hosts run test:node
npm --prefix hosts run test:oxlint
bun install --frozen-lockfile --ignore-scripts --cwd hosts
bun run --cwd hosts test:bun
```

## Add a rule

1. Implement `create(context, ctx)` in `src/rules/<rule>.ts` and add the rule to
   `TYPESCRIPT_RULE_PACK` or `DENO_RULE_PACK` in `src/rules/mod.ts` with its `meta`: description
   (at most 120 characters), category, guide anchor, preset membership, and limits.
1. Add its option schema to `TYPESCRIPT_OPTION_SCHEMAS` or `DENO_OPTION_SCHEMAS` in
   `src/rules/rule_options.ts`.
1. Add the anchor and the rule table row to `docs/style_guide.md`. Enable the rule through preset
   membership or an explicit project setting; do not add project data to the engine.
1. Add named valid and invalid cases in `tests/<rule>_test.ts`, and a case in
   `tests/deno_builtin_overlap_test.ts`. Run `tests/rule_meta_test.ts` and
   `tests/style_guide_claims_test.ts`.
1. Add one entry to `tests/cases/conformance.json`; a new rule needs it before the host tests pass.

## Documentation

Run `deno task check:docs` before a pull request. It checks the required document set, the index,
links, anchors, JSDoc on the public entrypoints, and the rule and CLI reference coverage.

## Review

- Keep one logical change per commit.
- Run the focused tests for the touched area, then the applicable task.
- Add a changelog entry for a user-facing change.
- Do not change a host pin without a conformance run.

## Commit format

Use the conventional form `type(scope): summary`, with a body that states what changed, why, the
tests run, and the impact.

## Code of conduct

This package does not adopt a separate code of conduct. The project's review and communication
standards apply.
