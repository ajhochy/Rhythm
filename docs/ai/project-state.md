# Project State

## Current focus

**Mega integration `mega/run-2026-08-04`** — one branch consolidating eight PRs so
there is a single merge to `main` after smoke testing. Two themes:

1. **Scheduled-agent autonomy.** On 2026-08-04 all 8 of that day's scheduled runs
   ended `completed_no_op` or `blocked_on_approval` — none did its job unattended.
   Eight defects were diagnosed live against the running agent server on `:4001`
   and fixed; 16 of 17 enabled tasks then completed unattended, the 17th after a
   skill repair.
2. **Skill data loss.** Two independent mechanisms were destroying hand-written
   skills. Both addressed here.

## Active branch / PR

- Branch: `mega/run-2026-08-04` (off `main`)
- Consolidates **#1312, #1313, #1314, #1315, #1316, #1317, #1318, #1304** — those
  are superseded and closed in favour of one merge.
- Merge remains a manual human action after smoke testing.

## What is in the mega branch

**Scheduled-agent autonomy (#1312)**
- Taint → approval deadlock: `auto_approve_actions` was structurally unreachable,
  because any taint forced a security-bound approval and those hard-coded
  `autoApprove:false` (#1134). Fixed by widening
  `SOURCES_EXEMPT_FROM_APPROVAL_GATE` from 1 → 17 genuinely first-party sources,
  plus scheduler-originated auto-approve gated on `auto_approve_actions` AND
  `is_system` AND `scheduled_task_id`. One shared predicate,
  `isUnattendedAutoApproveSession`, serves both the enforcement and request paths.
- All-or-nothing injection scanner: 2 of 50 memory rows withheld all 50. Flagged
  first-party LIST payloads are now filtered per item.
- `MUTATION_TOOL_PATTERN` was `^`-anchored and matched 0 of the 40 real tool
  names, so no run could ever report `success`. Now segment-boundary matched, and
  both run signals traverse the delegation tree.
- Headless `ask` hang: permission-mode resolution hoisted above the #878 bash
  gate. Bare `bypassPermissions` is deliberately NOT treated as unattended.
- A clean session got 409 on `request_approval` — found only by live smoke; it had
  turned the deadlock into a different dead end.
- Curated-MCP sidecar dedupe (`requiredEnv` is UNIONED, never weakened) and a boot
  reaper for orphaned `agent_scheduled_tasks` rows.
- `api_client` rendered every structured API error as `[object Object]`.

**Engine timeouts (#1313 → #1315, #1314)**
- `glob` gained its own timeout; the guard then moved into the `Ripgrep` service so
  all six callers (`files`/`search`/`tree`) are bounded, not just `glob`.
- The provider-stream inactivity watchdog now waits out provider-executed tools,
  which is what killed `image_generation` on any render slower than 180s. The
  interim 600s global raise in `opencode_client_service.ts` was **removed** — the
  engine fix is better on both axes.

**Org optimizer (#1316, #1317)**
- Scope was parsed with an array-only helper, so 16 of 47 profiles using the
  tools-map shape read as having no tools — the source of two false high-risk
  proposals, one of which would have wiped nine tool grants if approved. Also
  fixed a dispatch-guard misread that denied granted tools at runtime.
- External adoption now fails **closed** when the judge is unavailable (it
  previously shortlisted every candidate unjudged) and has a relevance floor.

**Skill data loss (#1318, plus a follow-up in flight)**
- The test suite isolated the database but not the filesystem, so runs overwrote
  real `SKILL.md` files. `managedSkillsRoot()` now THROWS under vitest if it
  resolves to the real `~/.config/opencode/skills`.
- Separately, the harvest evaluator treated an unparseable score as 0 and disabled
  four skills in eight minutes on 2026-07-11. Fix in flight on
  `fix/harvest-eval-unknown-score-not-zero` — NOT in this branch yet.

**image_generation (#1304)** — the native OpenAI provider tool, plus the role-gate
fix that stops it being blocked.

## Risks / known issues

- **The engine binary MUST be rebuilt from this branch before smoke testing.** It
  carries fork changes (`glob`, `ripgrep`, the `llm` watchdog, `image_generation`).
- `secretary` deliberately has NO `auto_approve_actions`: `email.send` is a
  protected action and unattended sending needs an explicit human decision.
- The classifier cannot see through `bash`, so a task mutating only via `bash`
  still reports `completed_no_op`. Deliberate trade — counting `bash` would mark
  every read-only run a success.
- `APPROVALS_MODE` is unset (`manual`) and no UI can reach it.
- **#1322 — both blocklist-reachability gaps are now fixed; plan mode is not.**
  Gap (a), pipelines: the engine splits `curl … | sh` into per-command-node
  `patterns`, losing the pipe. Fixed by resolving the permission's
  `tool.{messageID, callID}` to the tool part's `state.input` (which holds the
  full line) via `findToolPartInput`, and unioning that with `patterns` —
  a missing part falls back to `patterns` rather than failing open.
  Gap (b), `bash {"*":"allow"}`: fixed as a projection invariant
  (`withHardlineBashEscalation`) rather than a DB migration, so profiles cannot
  drift and new ones inherit it. Escalates bare `sh`/`bash`/`zsh`, `mkfs*`,
  `dd *`. Relies on `permission/evaluate.ts` using `findLast` — pinned by test.
- **Plan mode is NOT read-only for bash, and never was — still open in #1322.**
  The engine's own native `plan` agent denies `edit`, not `bash` (only `explore`
  denies `*`), so Rhythm's plan-mode auto-deny only ever fired on tools the
  engine escalated. The #1322 escalation gives it partial teeth (bare `sh`,
  `mkfs*`, `dd *` are now auto-denied in plan mode) but `echo foo` still runs.
  Genuine read-only bash needs a per-session ruleset override — a design change,
  deliberately not half-built. Smoke item E4 was reworded to match reality.
- **#1305 is a live verification trap, reproduced 2026-08-05.** Two engine
  binaries coexist: `:4096` is served by `apps/opencode_bin/opencode`
  (`…202608050020`) while the launcher stages and verifies
  `apps/api_server/opencode_bin/opencode` (`…202608050151`). Same byte size,
  different sha1. They differ only by build timestamp, so "engine reports
  `0.0.0-mega/run-2026-08-04-*`" proves the right BRANCH, never the freshly
  staged build. Check the `txt` path from `lsof`, not the version string.
- Skill bodies for `daily-email-triage`, `daily-dev-summary`, `monthly-gc-report`,
  `AI Trend Research…` and `monday-worship-planning` were re-authored on
  2026-08-04 and still need the user's review.
- **`~/.config/opencode/skills-backup-2026-08-04-2320` is POISONED for those five
  — do NOT restore from it.** It was taken at 23:20, i.e. AFTER the destruction,
  so it holds the truncated stubs, not good content. Measured 2026-08-05: of 238
  skills in that backup, exactly those five are stubs
  (`monday-worship-planning` 7 lines vs 185 live; `daily-email-triage` 6 vs 66;
  `daily-dev-summary` 4 vs 64; `monthly-gc-report` 6 vs 63;
  `AI Trend Research…` 6 vs 56). The LIVE files are the good restored versions.
  Restoring that backup would reinstate the damage.
- **D1 is a differential, not a constant.** "The hash equals 328575ea…" is the
  wrong assertion — skills are living files the app and agents legitimately edit
  (`monday-worship-planning` changed at 08:26 on 2026-08-05 during normal session
  activity, body fully intact at 185 lines). D1's real contract is "unchanged
  ACROSS a suite run". Verify it by hashing before and after, or by checking that
  no `SKILL.md` mtime falls inside the run window. Confirmed 2026-08-05: zero
  skills modified during two full suite runs. Note that BSD `find -newermt`
  silently accepts and ignores a relative time like `"-3 hours"` — use an
  absolute timestamp and always run a control that should match.
- Pre-existing, out of scope: `apps/mobile` checks fail locally on a missing
  `eslint` and a wrong npm script; they pass in CI.

## Test status

- api_server: 474 files / 3964 tests pass, 0 fail, 85 skipped (`--fileParallelism=false`).
  Typecheck clean.
- mcp_server: 155/155. Typecheck, lint, build clean in both.
- opencode fork: typecheck clean; session suite 388 pass / 0 fail; tool 297; file 95.
- All four CI workflows green on `f8ece4f5` and on `447f564c`.
- #1312–#1318 were each green in CI on their own branch before integration.

## Smoke status (round 3, 2026-08-04)

Driven directly against the running app — see `docs/testing/mega-2026-08-04-smoke.md`.
Rounds 1–2 went through a Codex agent; round 2 returned 8/8 BLOCKED on its own
sandbox denying localhost while the app was healthy the whole time, so it produced
no signal about the code.

**PASS:** C3, A5, E5, E6, E1, D1, and E2 after a fix.
**Open:** E3 partial, E4 failing — both on #1322, which is pre-existing and not
introduced by this branch.

E2 exposed a real defect: the bridge read `perm.toolName ?? perm.type` and
`args.command`, but the engine's `permission.asked` carries neither — the id is in
`permission` and the command in `patterns`. `toolName` was therefore `''` for
every real permission, silently disabling both the #736 tool-allowlist backstop
and the #878 command gate. A hardline command reached the shell with no card.
Fixed in f8ece4f5 with three tests built from a payload captured off the engine's
`/event` stream, each mutation-verified. The pre-existing #878 tests all passed
throughout because they hand-build `metadata: { command }`, a shape no engine
event has — assert against captured payloads, not hand-written ones.

## Manual smoke complete (2026-08-06)

K2 was the last outstanding item and **passed** on the second attempt. Attempt 1 was
INVALID, not a fail: the server was restarted by hand without `DB_PATH`, so `env.ts`
defaulted it to `cwd/rhythm.db` (a 13-message scratch DB) and — because
`ApiServerService` reuses any healthy server on :4001 — the client reconnected there.
AJ caught it from the session list being unfamiliar. Never start a bare manual server
for smoke; kill the app-owned subtree and let the app respawn it, which supplies the
correct env by construction. Full procedure and evidence in
`docs/testing/mega-2026-08-04-smoke.md`.

**#1305 is now genuinely fixed**, not worked around. `opencode_client_service`
resolves `opencode_bin` three levels up because in the packaged bundle it is a
SIBLING of `api_server`; from source that same walk lands on `apps/opencode_bin`,
while the launcher staged only `apps/api_server/opencode_bin`. Result: a verified
fresh build coexisting with a stale binary actually serving :4096. `install_engine`
now writes both paths and `verify_running_engine` compares **sha256** against the
staged copy — two builds differing only by timestamp share a `--version` string, so
the hash is the only proof the fresh bytes are live (4eec569f).

**Still open, latent, in code this branch introduced:** `WebSocketChannel.connect()`
is lazy, so `_channel != null` ≠ connected and `sink.add` on a dead channel buffers
instead of throwing. A message typed while a reconnect attempt is in flight can be
swallowed, and `_flushPendingSends()` can drain into that doomed channel. Fix is
`channel.ready` (available in the pinned 3.0.3) plus an explicit `_connected` flag.
K2 does not cover it — it exercises the fully-torn-down path.

## Next step (updated 2026-08-05)

Relaunched and live-verified: message timestamps are zoned, transcript order matches
DB truth, and AJ confirmed the chat pane renders correctly. Remaining before merge is
AJ's own pass over sections G–M of `docs/testing/mega-2026-08-04-smoke.md` — none of
that has been exercised through the UI. Then `gh pr ready 1319` and merge; `main` has
no branch protection, so the draft flag is the only technical blocker (the red check
is a cancelled duplicate Mobile CI run).

Outstanding code, both follow-up-able: taint propagation to the parent on an async
wake, and `rhythm_delegation_transcript`. Open issues from this work: #1322 (plan-mode
read-only bash), #1323, #1324, #1325, #1326.

## Previous next step

User's call on merge. `mega/run-2026-08-04` (PR #1319) is the single open PR, still
draft; merge is a manual human action. #1322 tracks the remaining blocklist gaps
and can be a follow-up.
