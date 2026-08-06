# Project State

## Current focus

Post-merge follow-ups to the mega branch. **PR #1319 merged to `main` on 2026-08-06
as `f1520c99`** — scheduled-agent autonomy, engine timeouts, org-optimizer accuracy,
skill data-loss, and the transcript/delegation fixes. All ten of its `Closes #N`
issues auto-closed (#1302, #1304, #1305, #1312–#1318).

Current work is CI-signal correctness and removing the engine's unused `plan` agent
from Rhythm's surface — see `docs/ai/runs/2026-08-06-ci-gates-and-plan-agent.md`.

## Active branch / PR

- Branch: `workflow/run-2026-08-06-ci-gates-and-plan-agent` (off `main`), commit
  `126e866c`. PR not yet opened.
- Closes **#1328** (Desktop CI gate ordering) and **#1329** (Mobile CI
  self-cancellation), plus the `plan`-agent exclusion (no issue — direct request).
- Merge is a manual human action.

## In progress

- Open the PR for `126e866c`. Opening it also exercises the #1328 fix, since the
  diff touches `desktop_ci.yml` itself.
- Two code items owed from the #1319 work, both follow-up-able: **taint propagation
  to the parent on an async wake** (needs a synthesized `TrustedSecurityContext`
  passing `requireKnownSession`), and **`rhythm_delegation_transcript`** (fenced +
  classified as `externalReads`).
- AJ's review of the re-authored `AI Trend Research…` skill body (no recoverable
  original).

## Risks / known issues

- **GitHub Actions was unstable on 2026-08-06.** `Set up job` failed five times
  with `Failed to resolve action download info. Error: Service Unavailable` —
  before checkout, before any repo code. Three further runs were cancelled while
  still queued, all at the same second, never assigned a runner. Before treating a
  red check as a code failure, confirm the job actually started.
- **#1322 — plan mode is still NOT read-only for `bash`.** The engine's native
  `plan` agent denies `edit`, not `bash` (only `explore` denies `*`), so Rhythm's
  plan-mode auto-deny only ever fired on tools the engine escalated. The #1322
  escalation gives it partial teeth (bare `sh`, `mkfs*`, `dd *` auto-deny) but
  `echo foo` still runs. Genuine read-only bash needs a per-session ruleset
  override — a design change, deliberately not half-built. Note this is separate
  from the `plan` **agent** now being unlisted.
- **`apps/api_server` has no lint gate** — `npm run lint` is
  `echo 'TODO: add eslint'`. `tsc` is the only static check.
- **Never start a bare manual `api_server` for smoke.** `env.ts` defaults `dbPath`
  to `process.cwd()/rhythm.db`, and `ApiServerService` **reuses any healthy server
  on :4001** — so a hand-started server silently binds a scratch DB and the app
  reconnects to it, looking exactly like data loss. Kill the app-owned subtree and
  let **Retry** respawn it; the app supplies the correct env by construction. Cost
  one invalid smoke result on 2026-08-06.
- **A green pass count is not coverage.** 64 desktop test files failed to *compile*
  for two days; the suite reported a healthy `+636` while 413 tests never ran. #1328
  fixes the CI blind spot that hid it.
- `~/.config/opencode/skills-backup-2026-08-04-2320` is **POISONED** for
  `daily-email-triage`, `daily-dev-summary`, `monthly-gc-report`,
  `AI Trend Research…` and `monday-worship-planning` — taken AFTER the destruction,
  so it holds truncated stubs. The LIVE files are the good restored versions;
  restoring that backup would reinstate the damage.
- **D1 is a differential, not a constant.** Skills are living files the app and
  agents legitimately edit, so "the hash equals X" is the wrong assertion. D1's
  contract is "unchanged ACROSS a suite run" — hash before and after. BSD `find
  -newermt` silently accepts and ignores a relative time like `"-3 hours"`; use an
  absolute timestamp and always run a control that should match.
- **The engine binary must be rebuilt from the working branch before smoke.** The
  fork carries `glob`, `ripgrep`, the `llm` watchdog, and `image_generation`.
  `tools/dev/launch_desktop_current.sh` now stages both resolution paths and
  verifies by **sha256** (#1305) — two builds differing only by timestamp report an
  identical `--version`, so the hash is the only proof the fresh bytes are live.
- `secretary` deliberately has NO `auto_approve_actions`: `email.send` is a
  protected action and unattended sending needs an explicit human decision.
- The run classifier cannot see through `bash`, so a task mutating only via `bash`
  still reports `completed_no_op`. Deliberate trade.
- `APPROVALS_MODE` is unset (`manual`) and no UI can reach it.
- Pre-existing, out of scope: `apps/mobile` checks fail locally on a missing
  `eslint` and a wrong npm script; they pass in CI.

## Test status

- **api_server: 480 files pass, 0 fail, 85 skipped** (`npm test --
  --fileParallelism=false`), `tsc` clean, on `126e866c`.
- **desktop_flutter: 1049 tests pass, 0 fail**, 0 analyze errors, format clean —
  up from 636 runnable before the 65 test fakes were repaired.
- mcp_server: 155/155; typecheck, lint, build clean.
- opencode fork: typecheck clean; session suite 388 pass, tool 297, file 95.
- `agents_capabilities_routes.test.ts` flaked once with `UND_ERR_SOCKET` under full
  -suite load; passes 20/20 in isolation and did not recur.

## Next step

Open the PR for `126e866c` with `Closes #1328` and `Closes #1329`, watch CI (the
Desktop CI run on that PR is itself the verification of the #1328 fix), then hand
off for manual merge. Do not merge automatically.
