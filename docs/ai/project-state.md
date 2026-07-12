# Project State

## Current focus

**Boot-stomp class fix (2026-07-11)** — one architectural fix for the whole
"my agent/skill/task edits are gone on the next boot" bug family. Root cause:
one-time seeds/repairs coded as eternal enforcement (unguarded content writes
firing on every boot / every picker refresh). Full taxonomy + fix in
`docs/ai/runs/2026-07-11-boot-stomp-class-fix.md`; the convention is recorded
in `docs/ai/decisions/2026-07-11-content-writes-are-one-time.md`.

## Active branch / PR

- **PR #1080** `fix/1039-profile-sync-mode-all-revert` — mode:'all' sync fix
  (open, awaiting merge).
- **NEW (this session)** `fix/boot-stomp-config-revert-class` (stacked on
  #1080) — runOnce marker mechanism for all migration content repairs,
  session_selectable made user-owned (insert-only in sync), secretary roster
  reconcile one-time, seeded-task delete tombstones, CLI-preset scheduling
  guard fix. Draft PR to be opened; do NOT merge without owner sign-off.

## In progress

- Draft PR + owner smoke of the fix branch. Everything else verified:
  tsc clean, 2702/2702 tests, live 3-boot restart proof 16/16, negative
  control (replay guard fails on pre-fix code) confirmed.

## Risks / known issues

1. Repairs now fire once per install — shipping a NEW default prompt/preset
   value requires a new `runOnce` key (contract documented at top of
   runMigrations; enforced by `migrations_replay_guard.test.ts`).
2. Postgres bootstrap marker path is code-reviewed but not integration-tested
   (test infra is SQLite-only) — verify on next prod deploy.
3. Follow-ups to file: stale DB-body snapshot in org-optimizer
   `applySkillBodyRevision` revert path; `allowed_mcps_json` NULL overload
   (unset vs unrestricted); prod-task mirror reverts local edits to mirrored
   non-done tasks (by design, but undocumented for users).

## Test status

- api_server: 2702 passed / 26 skipped; `tsc` clean.
- Live: 3 real server boots against scratch DB — all user edits survived.

## Next step

Open draft PR, hand to owner for manual smoke (edit Config Doctor in the real
app, restart, confirm it sticks), merge #1080 first or fold it in.
