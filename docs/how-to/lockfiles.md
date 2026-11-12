# Lockfiles

## Lockfiles

- `deno.lock` belongs to Deno and covers the engine and the Deno test suite.
- `../../hosts/package-lock.json` belongs to npm and covers the Node.js host suite.
- `hosts/bun.lock` belongs to Bun and covers the Bun host suite.

Do not edit a lockfile by hand; regenerate it with the tool that owns it.
