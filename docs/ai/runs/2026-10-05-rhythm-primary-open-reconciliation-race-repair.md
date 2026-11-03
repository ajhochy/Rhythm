---
date: 2026-10-05
repo: Rhythm
branch: codex/rhythm-primary-entry-repair-20261005
status: in_review
tags: [run, rhythm, web, coordinator]
---

# Primary entry reconciliation race repair

## Scope

Incremental source-only delta after frozen R6 UI source `1c41f5bdf44eb9eb5076055790c4937108cb7afa`.

- `use-coordinator-conversation.ts` now treats a current-root open, its authoritative status read, and its canonical-history read as one coalesced scoped reconciliation. A second open joins that work rather than interpreting the in-flight refresh as a failed open; return-to-normal, selection change, disposal, or a newer attempt fences the old continuation before those reads can re-enable it.
- `AgentsWorkspace.tsx` presents an SDK-less, already-confirmed primary root as `Opening` while that exact reconciliation is active (including a completed status with a still-loading history page), then `Ready` only after it completes. Existing held, offline, unavailable, child, and ordinary-chat presentation paths remain outside this override.
- Focused controller and rendered-entry regressions cover the repeated-open ordering and visible SDK-less restart state.

## Source freeze

| Path | R6 blob / SHA-256 | Current blob / SHA-256 |
| --- | --- | --- |
| `apps/web/src/components/AgentsWorkspace.tsx` | `3a722ee8c6ef9a36265c8fb0c04f036bc806d023` / `5f4fe8e3a2aca7c60ec5eec48f2b8578e5bc4dbaace5f2429d5588d1e5ed48a0` | `29f08f22b77822073a21123f02a9ac91a15307b6` / `d9e1275e47aa294898199795d3c1cfddeaddb42dae612bc54265e66b6fe5b130` |
| `apps/web/src/components/use-coordinator-conversation.ts` | `d5ac30d0f07011ceb2f0fd72f837dfb0c3e1f26a` / `838c151aa4d34e2f9c6423275430833ae613f53f90468e20f815860a5a1dbffc` | `0d8adab4ef702b75cd35d61263c66332b044a715` / `ba4a11ed91b9c624918fb2f8ca44e14e11caa7daaff6c165a8f44f05a66e7dcb` |
| `apps/web/tests/coordinator-conversation-controller.test.mjs` | `a3b972df1d74ae96cbc5656563dc92418dd55b19` / `71ccbc30f5746bde56da4a55941d1fd86e009f44fd662833add11f019f7d21d5` | `3ae15b790602d3e26874415000d6790cd747f468` / `e58eba091200f6845e498938a67e419a70e3634ad87b0b2f93d0a8bc04c14f24` |
| `apps/web/tests/rhythm-primary-entry.test.mjs` | `dcdcbb49f1c131b5b4771f0afe409ba35881796d` / `83a9a19b7e7a991670129bcd1d1363805a7c0d5d666ee4934c341682985f2942` | `7bf7c00d707bdb96ee4a8937115c57b2f17bbffa` / `df9d07e3ae7551cc816c6bd1308ac493e7692f29d3398d05a4e489ba572130b8` |

## Checks

- `node --experimental-vm-modules --test tests/coordinator-conversation-controller.test.mjs` — 15 passed.
- `node --test tests/rhythm-primary-entry.test.mjs` — 11 passed.
- `npm run typecheck` — passed (`tsc -b`).
- `git diff --check` — passed.

## Boundaries and remaining validation

No browser, normal app, API, model, SDK, database, or runtime action was performed. GitNexus impact for this isolated checkout remains `UNKNOWN`: the exact worktree is not registered, so the bounded manual caller review covered `AgentsWorkspace`, the coordinator hook/controller, its chat-menu caller, and the focused controller/entry tests. Root must compose these bytes and rerun the normal signed-app current-root click/reopen smoke; that is the remaining acceptance gate.
