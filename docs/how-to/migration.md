# Migration

## Migration

`unslop migrate` reads a version 1 catalog through the descriptor, so it works before any version 2
file exists. It moves `scopes`, `ignore`, and `tagVocabulary` to their version 2 fields, keeps explicit
applicability, options, docs, and tags, and maps the six whole-tree setting sections to their rule ids.
The layout moves to a separate file and requires `--layout-out` when the input has one. An engine limit
that differs from the rule metadata is refused instead of discarded.

The pair is written without overwriting: canonical parent paths, sibling locks, staged temporary files,
and no-clobber hard links. Layout commits first and the configuration last. If the second commit fails,
only the layout inode created by that invocation is removed. If cleanup cannot complete, the command
exits `1` and reports the exact surviving paths; it never reports a successful partial pair. The output
is compiled before it is written, so a value that is legal in version 1 but illegal in version 2 is
refused with no file created.

## Whole-tree hosts today

A whole-tree host reads a legacy catalog until it adopts the version 2 adapter.
`unslop config print` emits one with the `wholeTree` section, so a migrated project can keep its checks
running:

```sh
deno task unslop config print > catalog.json
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --catalog=catalog.json --rule=unused-exports
deno run -A <path-to-unslop-ts>/src/cli/whole_tree.ts --catalog=catalog.json --rule=unused-files
```
