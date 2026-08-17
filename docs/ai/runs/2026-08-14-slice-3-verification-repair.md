---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [task-live-lifecycle, electron-m1-slice-3]
status: in-progress
tags: [run, Rhythm]
---

## Files

- `docs/ai/contracts/slice-3-verification-repair.json`
- `docs/ai/contracts/task-live-lifecycle.json`
- `docs/ai/runs/2026-08-14-slice-3-verification-repair.md`

Validated collaborator artifacts (already present before this repair):

- `apps/web/package.json`
- `apps/web/tests/gateway/gateway.spec.ts`
- `apps/web/tests/gateway/tasks-gateway.spec.ts`

c7 root-cause phase (coding-agent session f3f17fc8, completed by orchestrator after the
child aborted mid-run; worktree audited per the aborted-run protocol before continuing):

- `apps/api_server/src/repositories/tasks_repository.ts` — honest `rowToTask` shaping
  (`is_shared` absent → `undefined`, never `false`); `taskSelectForUser()` selects the
  actor-scoped `is_shared` on `findById`/`findByIdAsync`; `create`/`createAsync` return
  the owner-scoped read when `ownerId` is present (orchestrator completion).
- `apps/api_server/src/__tests__/tasks_permissions.test.ts` — HTTP contract: collaborator
  PATCH → `isShared: true`, owner PATCH → `isShared: false`, owner POST → `isShared: false`.
- `apps/api_server/src/__tests__/tasks_repository.test.ts` — Postgres detail-query shape
  selects the actor-scoped `is_shared` alias.
- `apps/web/src/pages/tasks/fixtures.ts` — `isShared: true` on `task-shared-with-me`, so
  the fixture c7 test exercises the same predicate arm live mode uses.
- `apps/web/tests/tasks/task-live-lifecycle.fixture.spec.ts` — c7 now discriminates:
  shared task delete `toBeDisabled()` AND owner task delete `toBeEnabled()`.
- `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts` — live collaborator PATCH
  response asserted `isShared: true` inside the existing single journey.

## Checks

- RED (captured before the token repair, orchestrator session, 2026-08-14 ~20:20):
  command `cd apps/web && npm run test:fixture` — **2 failed / 6 passed**. Both failures
  were early aborts, not the tests' original assertions:

  ```
  [4/8] … slice-2-c5: live gateway separates API and engine failures per health check
  [8/8] … slice-2-c7: requested live mode never falls back to fixtures on failure
  Error: Live configuration error: an explicit task token is required
     at createLiveTasksGateway (src/gateway/tasks.ts:92)
     at createLiveGateway (src/gateway/index.ts:33)
    2 failed, 6 passed (5.3s)
  ```

  This is the red-first evidence for c1: the disposable dummy token exists so these two
  tests can reach their original assertions again (green run below).
- `npm run typecheck` — PASS (exit 0).
- `npm run test:fixture` — PASS: gateway/receipt/task-gateway invocation 10 passed; invalid-live invocation 1 passed.
- `npx playwright test tests/tasks/task-live-lifecycle.fixture.spec.ts --workers=1` — PASS: 2 passed (2.8s).
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db npx playwright test tests/tasks/task-live-lifecycle.live.spec.ts --workers=1` — PASS: 1 passed (4.1s); `task screenshot sha256=1dfe26bfc8dac0379d5ddd052d1110deebebfb74546e03edf72997f4dfdc8440 bytes=133090 dimensions=1440x900`. No cleanup counts were printed.
- `npm run test:list` — PASS: Total: 254 tests in 39 files.

## Notes

- Sandbox status confirmed without starting, stopping, or restarting it: API :4098, engine :4097, gateway :4099.
- The requested `test:fixture` first invocation already included `tests/gateway/tasks-gateway.spec.ts`; no package edit was necessary in this repair turn.

## Checks — c7 root-cause phase (orchestrator completion, 2026-08-14 21:31–21:40)

- RED: `npx vitest run src/__tests__/tasks_permissions.test.ts` — 1 failed / 4 passed;
  new POST-shape assertion failed (`task.isShared` undefined, expected `false`) before the
  create-path fix. (The child's PATCH-shape test was already green on its repository fix.)
- GREEN: `npx vitest run src/__tests__/tasks_permissions.test.ts src/__tests__/tasks_repository.test.ts`
  — 30 passed (30). `npx tsc --noEmit` — pass. `npm run build` — pass.
- Sandbox rebuilt + restarted only via `tools/dev/sandbox.sh down && up && status`
  (API :4098, engine :4097, gateway :4099) so the live gate exercised the new API build.
- `npm run typecheck` (web) — pass. `npm run test:fixture` — 10 passed + invalid-live 1 passed.
- `npx playwright test tests/tasks/task-live-lifecycle.fixture.spec.ts --workers=1` — 2 passed.
- Live: `RHYTHM_LIVE_E2E=1 …` live lifecycle — 1 passed (3.9s); screenshot
  sha256 `eee51963c5a8aeb83e804b4de1236328a55b1eb718e0eb4716b8ba354e42bef8` 130896 bytes 1440x900;
  includes the live collaborator PATCH `isShared: true` assertion against the real API.
- `npm run test:list` — 254 tests in 39 files (unchanged; no new spec files this phase).
- `gitnexus detect_changes(scope=all, worktree=…)` — changed symbols confined to Slice 2
  backend hardening + Slice 3 tasks repository; affected processes exactly the expected
  `tasks_controller.update` and `addCollaborator` flows. Reported risk "high" reflects the
  cumulative uncommitted multi-slice worktree, resolved by the ownership table below.
- GitNexus impact (pre-edit): `rowToTask` upstream = MEDIUM, 9 direct callers, 30 impacted,
  2 processes. `create`/`createAsync` lie inside that analyzed radius (depth 2).

## Post-gate reconciliation (2026-08-14, after verification FAIL 522e06d5)

The full gate rerun failed on two bookkeeping items only (all behavior criteria passed):

1. `SHA256SUMS` 142/144 — the two approved adaptations were never reconciled. Repaired per
   the documented PROVENANCE.md convention (as Slices 2/3 did): entries updated for
   `package.json` → `fd024c60…` and `src/pages/tasks/fixtures.ts` → `6e0a06a1…`;
   `shasum -a 256 -c SHA256SUMS` now **144/144, 0 failures, 144 lines**; new inventory
   root `1239de54c04c1bad045527e044e680a22c53fabc773f51b6f56cf4fb8d922b49` recorded in
   PROVENANCE.md (historical chain preserved) and in `task-live-lifecycle.json`.
2. Missing red-first excerpt for the c5/c7 token repair — the captured red command/output
   is now recorded verbatim at the top of the first Checks section.

failure-triage was dispatched for these blockers (session 25a6ac1f) but returned no ruling
before repair; the reconciliation follows the repo's own recorded convention rather than
waiting indefinitely. Retro: `docs/ai/runs/2026-08-14-retro-slice-3-checksum-evidence.md`.

## Triage decisions (failure-triage session c11a60b7; scope decision by AJ)

**RULING 1 — collaborator UI evidence: INSUFFICIENT as previously argued; second live
browser journey NOT required.** The prior triangulation missed two links: (5) no test ever
rendered `isShared === true` (the fixture c7 task reached `isOwner=false` through the
`ownerId` fallback arm, not the live `!task.isShared` arm), and (6) single-task mutation
responses omitted `is_shared` and coerced it to `false` — a real c7 defect where a
collaborator edit/complete temporarily enabled Delete until reload. AJ chose the API
root-cause repair over React-only containment. Both links are now closed by focused tests
(fixture predicate-arm + discriminating assertions; API HTTP mutation shapes; live
collaborator PATCH assertion) — no second live-browser collaborator journey added.

**RULING 2 — ownership accounting: use the declared slice-start / verified-prior-slice
baseline; whole-worktree cleanliness is an invalid ownership test.** The worktree is one
uncommitted delta that six slices deposited in sequence; `git status` has no slice
dimension, so "unexplained files" re-charges Slice N with Slices 0…N−1. Verification must
assert "every modified path maps to a slice, and every Slice 3 path maps to Slice 3's
declared set" — not worktree cleanliness. Once commits exist, `baseline...HEAD` replaces
this table.

### Slice-ownership table (all modified/untracked paths, by group)

| Path group | Owning slice | Where verified |
| --- | --- | --- |
| `apps/api_server/src/{app.ts, config/env.ts, middleware/local_agent_surface_guard.ts, contract/local_agent_surface_hardening.test.ts}`, `tools/dev/sandbox.sh` | Slice 2 (approved local-renderer repair) | `runs/2026-08-14-electron-m1-gateway.md`; contract 48/48 + live receipt |
| `apps/api_server/src/{repositories/tasks_repository.ts, __tests__/tasks_permissions.test.ts, __tests__/tasks_repository.test.ts}` | Slice 3 (c7 root-cause repair) | this note |
| `.gitignore` (root) | Slice 6 (coverage tracking) | `runs/2026-08-14-electron-m1-parity-bootstrap.md` |
| `apps/web/**` — 144 paths in `apps/web/SHA256SUMS` + `.gitignore`/`PROVENANCE.md`/`SHA256SUMS` | Slice 1 import baseline | `runs/2026-08-14-electron-m1-web-import.md`; 144/144 verified |
| `apps/web/{index.html, package.json, src/App.tsx}` | Slice 1 → Slice 2 adapted | `PROVENANCE.md` §Slice 2 |
| `apps/web/src/main.tsx` | Slice 1 → 2 → 3 adapted | `PROVENANCE.md` §Slice 3 |
| `apps/web/src/gateway/{index.ts, context.tsx}`, `apps/web/tests/gateway/{gateway,receipt,invalid-live,live}.spec.ts` + configs | Slice 2 (index.ts extended by Slice 3) | Slice 2 + Slice 3 run notes |
| `apps/web/src/gateway/tasks.ts`, `apps/web/src/pages/tasks/{index.tsx, fixtures.ts}`, `apps/web/tests/tasks/*`, `apps/web/tests/gateway/tasks-gateway.spec.ts` | Slice 3 (fixtures.ts and tasks-gateway.spec.ts explicitly claimed here — previously omitted from Files lists) | `runs/2026-08-14-electron-m1-task-live.md` + this note |
| `apps/electron/**` (7 files) | Slice 5 by adoption — no creating run note exists (residual risk, accepted; do not re-litigate per slice) | `runs/2026-08-14-electron-m1-shell.md`; shell tests 5/5 |
| `docs/ai/contracts/*`, `docs/ai/runs/*`, `docs/ai/coverage/*`, `tools/validation/*` | Slices 0/1/2/3/5/6 per filename/frontmatter | each note self-documents |

Residual risks recorded: `apps/electron/**` lacks a creating run note (adopted+verified in
Slice 5); `is_shared` aliases are duplicated across list queries with no schema-parity
test pinning Postgres (known [[project_postgres_sqlite_schema_drift]] pattern); live
evidence is single-identity by construction — future "what a collaborator sees" criteria
need a second web instance (known ceiling, not needed for c7).
