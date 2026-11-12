# Editing

## Editing

`rules enable`, `disable`, `set`, and `unset` re-read the file on every call, validate the result by
compiling it, and preserve unrelated rules and fields. Because an explicit entry replaces its preset
entry completely, an edit first materializes the effective level, options, scope, include/exclude, docs,
and tags, then changes only the target. The command writes the shortest form that compiles to the same
effective rule.

An edit refuses a control that the named host does not read, a plugin `warn` level, a missing reason,
and an `unset` whose option has no engine default. A refused or stale edit leaves the bytes unchanged.
A real edit locks the file, compares the current bytes and inode with the read copy, preserves the mode,
and replaces it atomically. An edit keeps an authored `reason`, `optIn`, and consumer `exclusionCodes`
at every level; `enable` clears the first two only when the rule was off. `--dry-run` prints a unified
diff before any lock or temporary file exists.
