# Security

## Supported versions

Security fixes land on the latest `0.1.x` release. A fix is not backported to an older release
unless the changelog states it.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on `dostark/unslop-ts`. Do not open a public issue
for a vulnerability. Include the affected version, a minimal reproduction, and the impact.

## Trust model

- Local plugin entries and their transitive imports are trusted executable project code. The CLI
  loads them; it is not a sandbox.
- The CLI accepts filesystem paths and local `file:` URLs only. It rejects `data:`, remote, and
  registry schemes before import.
- The CLI itself does not request, store, or print credentials.
- A skill or lint rule declared in a project cannot widen a host's permissions.
- `deno lint` runs plugin rules inside the Deno process. ESLint and Oxlint run the adapter inside
  their own process, with the permissions of the invoking user.

## Data handled

The engine reads project source, configuration, lockfiles, LCOV files, and git history when a
history flag is used. Reports contain file paths and findings; they do not contain file contents
beyond the evidence a finding quotes.
