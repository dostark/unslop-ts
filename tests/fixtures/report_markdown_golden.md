# unslop-ts report

- **Completion:** complete
- **Host exit:** 1
- **Files observed:** 1
- **Host-wide visitation:** unavailable

## Rule coverage

| Rule | Status | Coverage | Checked | Skipped | Findings |
| --- | --- | --- | --- | --- | --- |
| `demo/rule` | active | partial | 1 | ignored=1 fixture=0 scope=0 include=0 exclude=0 | 1 |

## Findings

| Rule | Origin | File | Location | Level | Message | Hint |
| --- | --- | --- | --- | --- | --- | --- |
| `demo/rule` | unslop | [src/a \\\\[x\\\\]\\\\#100%\\\\.ts](src/a%20%5Bx%5D%23100%25.ts) | 1:1-1:2 | error | Selected \| message [x] % | Use \| pipes |

## Foreign findings

| Rule | Origin | File | Location | Level | Message | Hint |
| --- | --- | --- | --- | --- | --- | --- |
| `no-explicit-any` | foreign | [src/a \\\\[x\\\\]\\\\#100%\\\\.ts](src/a%20%5Bx%5D%23100%25.ts) | 1:1-1:2 | error | Foreign \| message [x] % |  |

## Not run

| Check | Mode | Command |
| --- | --- | --- |
| `constant-restatement` | default | deno run -A /engine/src/cli/whole_tree.ts --rule=constant-restatement |

