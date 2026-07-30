# Project State

## Current focus

2026-07-30: repair issue #1231's desktop-to-mobile session visibility. The
local database is backfilled and verified; the durable tokenless desktop owner
inheritance change has passed the full repository and live API/engine gates.

## Active branch / PR

- Branch: `codex/mobile-session-owner-inheritance`, based on `main` at
  `eee9694cd073f2658a565a5e9570c667bb1e0b0c`.
- PR: none; branch is prepared for commit and draft-PR review.
- Run:
  [runs/2026-07-30-desktop-session-owner-inheritance.md](runs/2026-07-30-desktop-session-owner-inheritance.md).
- Decision:
  [decisions/2026-07-30-desktop-session-owner-inheritance.md](decisions/2026-07-30-desktop-session-owner-inheritance.md).

## In progress

- No implementation or verification work remains on the local branch.
- Commit/push/draft-PR actions await explicit authorization.

## Risks / known issues

- The currently installed desktop does not contain the new inheritance rule;
  desktop sessions created before an updated build is installed can still need
  a backfill.
- 532 legacy non-system SDK sessions have directories outside registered
  projects and remain intentionally excluded from the project-scoped mobile
  catalog.
- Eight orphan `agent_session_messages` rows predate this migration and remain
  a separate data-integrity issue.
- Issue #1231's full physical iPhone/desktop criterion remains a human smoke;
  the user has already confirmed mobile-to-desktop creation works.

## Test status

- Local SQLite: zero unowned sessions, zero eligible missing mobile claims,
  and `PRAGMA integrity_check = ok`.
- Focused contract: 6/6 passed.
- Pre-fix live test reproduced an empty mobile catalog for a tokenless desktop
  create; the post-fix test passed against a freshly rebuilt fork and API.
- `ai-workflow checks --level issue` and `--level pr` passed.
- Isolated `/health` returned `status: ok`; `/opencode/health` returned
  `status: ready`.
- GitNexus change detection: medium risk, one affected session-create flow.
- `git diff --check` passed.

## Next step

Commit the scoped branch and open a draft PR. After human desktop-to-mobile
smoke, merge and ship an updated desktop build so new sessions inherit the
paired owner automatically.
