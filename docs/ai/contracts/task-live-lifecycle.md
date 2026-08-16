# Task live lifecycle acceptance contract

| ID | Criterion | Test |
| --- | --- | --- |
| task-live-lifecycle-c1 | Typed fixture/live task gateway lists, creates, updates, and deletes without a fixture fallback. | `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts` |
| task-live-lifecycle-c2 | Live mode uses only explicit `:4098`/`:4097` configuration and an explicit bearer token, failing closed when absent or invalid. | `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts` |
| task-live-lifecycle-c3 | Live UI exposes loading, empty, error, and forbidden states. | `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts` |
| task-live-lifecycle-c4 | Create, edit, complete, reload, and delete persist through visible React controls before success is displayed. | `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts` |
| task-live-lifecycle-c5 | A second identity cannot list, read, update, or delete the primary task. | `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts` |
| task-live-lifecycle-c6 | The live suite captures request statuses, receipt, screenshot, and cleans all disposable data on success or failure. | `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts` |
| task-live-lifecycle-c7 | Fixture create/edit/complete/delete remains deterministic and network-free. | `apps/web/tests/tasks/task-live-lifecycle.fixture.spec.ts` |

## Evidence correction result

The corrected live suite observes `DELETE /tasks/:id → 204` before reloading; it then proves the deleted task is absent after reload. The in-memory receipt ledger is intentionally not asserted after that reload.

Inventory reconciliation: `SHA256SUMS` is 144/144 verified with root `4eab4560806627006c41b586f4056d7b81685c7e9de1bed60ec7887d0d72f9e1`.
