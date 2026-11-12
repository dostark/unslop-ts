# Changelog

All notable user-facing changes to `@dostark/unslop-ts`. The format follows Keep a Changelog;
versions follow semantic versioning.

## 0.1.1

- Commit the lockfile so a checkout installs the pinned dependency graph.

## 0.1.0

- First release.
- Rule engine with the TypeScript pack and the Deno pack.
- Hosts: `deno lint`, ESLint 9 and later (below 11), and Oxlint 1.88 (experimental).
- Version 2 configuration, presets, the project descriptor, and the `unslop` CLI.
- `unslop health` report with complexity, maintainability, CRAP, history, duplication, and class
  design signals.
- Whole-tree checks: unused exports, unused files, duplicate code, duplicate type, duplicate
  constant, magic literals, constant restatement, and optional parameters.
