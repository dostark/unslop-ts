# Compatibility

This page states the supported runtime and host versions and the policy for changing them.

## Runtimes

| Runtime | Version | Role                                                                                                                 |
| ------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| Deno    | 2.9     | Reference runtime; `deno lint`, the CLI, `unslop report`, the coverage trace protocol, and `./whole-tree`.           |
| Node.js | 24      | Runs ESLint and Oxlint. Node strips TypeScript types, so the adapter imports a relative path outside `node_modules`. |
| Bun     | 1.4     | Runs ESLint. The `test:bun` task needs no Deno.                                                                      |

## Hosts

| Host        | Supported range           | Status                                                           |
| ----------- | ------------------------- | ---------------------------------------------------------------- |
| `deno lint` | Deno 2.9                  | Supported                                                        |
| ESLint      | 9.0.0 and later, below 11 | Supported                                                        |
| Oxlint      | 1.88.0                    | Experimental; the upstream JavaScript-plugin API is experimental |
| `jscpd`     | 5.4.2                     | Used by the duplication signal when installed                    |

## Policy

- A host or runtime version is supported only when the conformance suite passes on it.
- Raising a pin is a compatibility change; it needs the conformance suite and a changelog entry.
- The package follows semantic versioning. A breaking API or behavior change bumps the major
  version while the project is above `1.0.0`; below `1.0.0`, a minor bump carries the change and
  the changelog states it.
- A deprecation is announced in the changelog and kept for at least one minor release before
  removal.
