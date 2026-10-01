---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-electron-attribution-smoke-20261001
pr: 1598
issues: []
status: BLOCKED
tags: [run, rhythm]
---

# D — installed attribution authoring only

## Files / provenance

Owned clean isolated worktree:
`/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/delivery-electron-attribution-smoke-20261001`.
Initial `git status --short` empty; HEAD exactly
`c1b7e023fbd85774fe447078cfe410f228dee539`. Existing worktree was already newly
allocated; no additional worktree creation/reuse was necessary.

Read the supplied installed-attribution handoff and regression context pack, repo
instructions/current-plan/testing-guide and existing Electron test tooling.
Loaded smoke-test-writer. No workflow-orchestrator tool/skill or GitNexus tool is
available in this session; no peer dispatch was authorized. **No existing test or
production function/class/method was modified**, so no pre-existing symbol impact
analysis is being represented as performed. New code only.

Added:
- `apps/electron/test/installed-attribution.mjs`: external-artifact, attach-only
  packaged diagnostic with explicit red qualification gate.
- `apps/electron/test/installed-attribution.test.mjs`: pure helper self-checks;
  not installed/runtime qualification.
- `apps/electron/test/installed-attribution.md`: exact commands, fixture schema,
  runtime prerequisites, safety and unsupported native production seam.
- `docs/ai/contracts/task-electron-installed-attribution-20261001.json`: focused
  BLOCKED contract; no whole-run state or shared testing guide changes.
- This authoring receipt.

## Checks actually executed

All terminal commands used this owned worktree as explicit working directory.

1. `git status --short && git rev-parse HEAD` — exit0; clean, expected Mega SHA.
2. `git rev-parse --show-toplevel && git branch --show-current && git worktree list`
   — exit0; expected root/branch/baseline, sibling worktrees listed only.
3. Pinned GitHub source read (`gh api .../apps/desktop/src/api/cron.ts?ref=d747cbd9e81870704347738cb702d3f229818557`, raw Accept header)
   — source returned; confirms `createCronJob` POST `/api/cron/jobs` and native
   trigger24h timeout/profile/connection routing. Subsequent speculative
   `electron/preload.cjs` lookup returned404; combined command exit1. Do not
   infer a bridge contract from that missing path.
4. Pinned `src/api/client.ts` source request returned429; combined inventory
   command short-circuited, exit1. No current-head substitution or retry scraping.
   Native main-fetch mapping instead uses the established supplied handoff.
5. `node --check apps/electron/test/installed-attribution.mjs && node --check apps/electron/test/installed-attribution.test.mjs && git diff --check && git status --short`
   — exit0; syntax valid, only four then-added owned paths untracked.
6. `git diff --no-index --check /dev/null <new-path>` for each of those four
   paths — no whitespace diagnostics. `--no-index` implies diff exit1 for new
   files; this is not a whitespace failure. Unlike plain tracked diff, this
   checks untracked authored files too.

Pure `node --test` self-checks **NOT RUN**: manager has not provided an approved
isolated HOME/TMPDIR unit context. No dependencies installed or symlinked, no
runtime check/preflight/attach/launch/API/trigger/approval/signer operation run.
Parsing does not import/execute the harness. Final whitespace/status/numstat
commands are recorded in the completion report. Final tracked `git diff --check`
and both parsing commands pass; the new-file whitespace check then returns the
expected diff exit1, so the chained status command short-circuited. A separate
`git status --short` confirms only the five owned additions. New-file numstat
uses `git diff --no-index --numstat /dev/null <path>` (expected diff exit1).

## Existing-test triage / reuse

- **KEEP** `packaged-interactive-smoke.mjs`: real packaged CDP navigation and
  window/process-preservation assertions can catch a broken launch/lifecycle.
  Its sandbox up/down/hardcoded fixture ownership is wrong for this slice;
  retained unchanged and **not executed**. Reuse its packaged CDP approach only.
- **KEEP** `colony-installed/run.mjs` SHA-256 helpers: reject archive mismatch;
  reused directly. Its externally supplied pass-map reporter is not used to
  qualify this slice (cannot independently prove native behavior).
- **KEEP** `session-opening/live.mjs` for its own source-session deep-link scope;
  it cannot qualify installed Hermes/native approvals. No API creation or
  source-Electron/mock-keychain behavior copied into this installed gate.
- No network-mock assertion is promoted to installed/native acceptance.

## Result / manager handoff

**BLOCKED, not READY_FOR_RUNTIME.** Runtime owner A `childf64a2052` currently owns
4098/4097/4099. Installed Mega's known invalid seal is left completely untouched.
Final rebuilt signed/notarized/stapled candidate, approved synthetic native auth
profile, isolated Hermes backend/profile/connection/job and production native
HTTP/backend-version receipt are absent. No installed or development fixture is
qualified. Both reported pending approval IDs remain unqueried/pending.

`preflight`, `observe`, `qualify` are documented runnable **red gates**, exit1.
Observe may record actual outer reload403/503/transport/non-array failure, but
does not infer reload-resistant root cause from a successful one-shot GET. All
global/session/focus/new-creation/error/native pending/terminal/dedupe/reopen and
legitimate human-signing journeys remain `not-run`. CDP frame/target identifiers
are not mislabeled as WebContents identifiers; active update/dev renderer is
explicitly unsupported rather than mistaken for the factory package.

Pinned cron **does support creation**; the missing item is a safely assigned
real synthetic fixture, not proof no injection API exists. Main-process
`handleHermesApiRequest` traffic cannot be observed as renderer CDP requests.
Smallest conditional production recommendation: first use an existing supported
native/backend receipt; only if none exists, companion owner adds a narrow
opt-in external metadata-only production-proxy receipt and supported actual
backend-version provenance. Exact seam/prerequisites/commands are in the owned
test README. No production implementation, auth weakening, repin, signing,
commit/push/PR/merge/deploy, shared state edit or runtime action was performed.

## Continuation: isolated native Hermes proof authored, not run

Read-only operational metadata found one matching local Rhythm schedule name,
`Org Self-Optimizer` (disabled); bounded local Hermes job-title inventory had
no matching current job. This makes the Rhythm route plausible, but AJ's exact
installed click is still un-attributed. No schedule/job was triggered or changed.

Pinned companion source at `d747cbd9e81870704347738cb702d3f229818557`
confirms a `no_agent` script job executes without an LLM, the installed Cron
detail's `Trigger now` runs through production `hermes:api`, and `/api/health`
reports the running backend version. Added a reviewed five-second local-only
script fixture, strict fresh profile/job/backend identity validation, a read-only
bridge health nonce corroborated by the isolated loopback proxy's actual
upstream-status receipt, and a
separately environment-gated native UI click path. The latter requires exactly
one backend HTTP 200 POST, a disabled pending control, a terminal durable run,
one rendered run-history entry and reopen through the real Cron UI. An altered
script hash, wrong synthetic proxy connection, wrong profile, live/shared port,
missing receipt,
or duplicate POST fails closed. `qualify` remains red for other unrun cases,
including approval signing and exact reported-click attribution.

`gitnexus impact` on the previously untracked harness symbols returned UNKNOWN
because they were absent from the index; it reported no HIGH/CRITICAL finding.
Pinned Hermes suppresses ordinary INFO access logs, so a separate standard-
library loopback proxy supplies the receipt. It forwards allowlisted metadata
and the exact synthetic trigger, plus bounded WebSocket traffic, to the real
backend. It records only route category, synthetic job ID/health marker and
actual upstream status, never auth/body. The harness checks both owned listener
PIDs/ports and the installed native registry descriptor's proxy origin.
`node --test apps/electron/test/installed-attribution.test.mjs` passed 6/6;
`node --check` for both `.mjs` files and `git diff --check` passed. No installed
app/backend launch, native click, live API, human approval or signer operation
occurred. The manager must run the documented isolated installed proof after
the final signed package and pinned Hermes payload are ready.
