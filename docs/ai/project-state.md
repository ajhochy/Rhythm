# Project State

## Current focus

Shipping the 2026-08-06/07 fix batch to `main` and cutting a desktop release.
Task-search Tier 1+2 is locally complete and fully verified on its feature branch.

Recently merged to `main`:
- **#1319** as `f1520c99` — scheduled-agent autonomy, engine timeouts, org-optimizer
  accuracy, skill data-loss, transcript/delegation fixes. All ten `Closes #N` issues
  auto-closed (#1302, #1304, #1305, #1312–#1318).
- **#1327** as `b30406df` — mobile gateway authorization. (a) Session-scoped requests
  listed the project's engine sessions to authorize a single id; an explicit ownership
  row now short-circuits that to one indexed local read with no engine traffic.
  (b) Subagent approvals never reached the phone: a subagent runs in a child session,
  `PermissionRequest.sessionID` names that child, and children spawned inside the
  engine never pass through the proxy so they never get an ownership row — their
  approvals were filtered out and replying 404'd. Authorization now walks `parentID`
  ancestry.

## Active branch / PR

- Branch: `workflow/run-2026-08-06-ci-gates-and-plan-agent`, PR
  [#1330](https://github.com/ajhochy/Rhythm/pull/1330) (draft), head `b57d9c05`
  plus a merge of `origin/main`.
- Task-search: `feat/task-search-tier12` (base `617d9045`), draft PR
  [#1336](https://github.com/ajhochy/Rhythm/pull/1336), head `9bf3efe5`.
- Closes **#1328** (Desktop CI gate ordering), **#1329** (Mobile CI
  self-cancellation), **#1331** (skill extractor could execute what it read),
  **#1332** (engine session store was branch-scoped).
- Merge is a manual human action; AJ authorized this one explicitly.

## In progress

- Merge #1330 → `main`, then dispatch `desktop_release.yml` with version
  **`0.18.55`** (latest release tag is `v0.18.54`; the workflow builds
  `RELEASE_TAG: v${{ inputs.version }}`, so the input carries no `v`). Note some
  historical tags have a doubled `vv` prefix from passing the prefix into that input.
- **On-device confirmation still owed for #1327:** a real subagent approval
  surfacing on the phone and being replied to.
- Two code items owed from #1319: **taint propagation to the parent on an async
  wake** (needs a synthesized `TrustedSecurityContext` passing `requireKnownSession`)
  and **`rhythm_delegation_transcript`** (fenced, classified as `externalReads`).
- Remaining half of #1331: **fence the extractor's transcript** in
  `untrustedContext()` so the model is also told the material is data. The tool
  lockdown makes replay harmless; fencing would stop it being attempted.
- AJ's review of the re-authored `AI Trend Research…` skill body (no recoverable
  original).
- Task-search Tier 1+2 implementation is complete and verified locally: indexed
  title+notes search on Postgres and SQLite, shared BM25 ordering, and bounded MCP
  projection with compatibility behavior preserved. Run and contract records are
  under `docs/ai/`.

## Risks / known issues

- **GitHub Actions was in a `major_outage` on 2026-08-06/07 and its queue is still
  unreliable.** Symptoms seen: `Set up job` failing with `Failed to resolve action
  download info: Service Unavailable` (5×, before checkout), jobs cancelled after
  exactly 15m04s having never started (0 steps, 0 log lines), and — after the status
  page returned to `operational` — **pushes producing no runs at all**. Before
  treating a red check as a code failure, confirm the job actually started; before
  treating a green PR as verified, confirm runs exist for the current head SHA.
- **#1322 — plan mode is still NOT read-only for `bash`.** The engine's native
  `plan` agent denies `edit`, not `bash` (only `explore` denies `*`), so Rhythm's
  plan-mode auto-deny only ever fired on tools the engine escalated. The #1322
  escalation gives it partial teeth (bare `sh`, `mkfs*`, `dd *`) but `echo foo` still
  runs. Genuine read-only bash needs a per-session ruleset override — deliberately
  not half-built. Separate from the `plan` **agent** now being unlisted (#1332 work).
- **`apps/api_server` has no lint gate** — `npm run lint` is `echo 'TODO: add eslint'`.
  `tsc` is the only static check.
- **Never start a bare manual `api_server` for smoke.** `env.ts` defaults `dbPath` to
  `process.cwd()/rhythm.db`, and `ApiServerService` **reuses any healthy server on
  :4001** — so a hand-started server silently binds a scratch DB and the app
  reconnects to it, looking exactly like data loss. Kill the app-owned subtree and let
  **Retry** respawn it. Cost one invalid smoke result on 2026-08-06.
- **A green pass count is not coverage.** 64 desktop test files failed to *compile* for
  two days; the suite reported a healthy `+636` while 413 tests never ran. #1328 fixes
  the CI blind spot that hid it.
- **Stateless health endpoints do not prove sessions work.** `/opencode/health` and
  `/agent-sessions/agents` both answered normally while every session was unusable.
  Anything claiming to verify session health must exercise a session.
- `~/.config/opencode/skills-backup-2026-08-04-2320` is **POISONED** for
  `daily-email-triage`, `daily-dev-summary`, `monthly-gc-report`,
  `AI Trend Research…` and `monday-worship-planning` — taken AFTER the destruction,
  so it holds truncated stubs. The LIVE files are the good restored versions.
- **D1 is a differential, not a constant.** Skills are living files the app and agents
  legitimately edit, so "the hash equals X" is the wrong assertion; the contract is
  "unchanged ACROSS a suite run". BSD `find -newermt` silently accepts and ignores a
  relative time like `"-3 hours"` — use an absolute timestamp plus a control.
- **The engine binary must be rebuilt from the working branch before smoke.** The fork
  carries `glob`, `ripgrep`, the `llm` watchdog, and `image_generation`.
  `launch_desktop_current.sh` stages both resolution paths and verifies by **sha256**
  (#1305) — two builds differing only by timestamp report an identical `--version`.
- **Local debug builds need a live Apple Development certificate**, which expires
  annually. Renewed 2026-08-06; valid to 2027-08-06. The failure reads as a Flutter
  build error (`No signing certificate "Mac Development" found`), and an expired cert
  drops out of `security find-identity` while still existing in the keychain — so
  check `openssl x509 -checkend 0` first.
- `secretary` deliberately has NO `auto_approve_actions`: `email.send` is a protected
  action and unattended sending needs an explicit human decision.
- The run classifier cannot see through `bash`, so a task mutating only via `bash`
  still reports `completed_no_op`. Deliberate trade.
- `APPROVALS_MODE` is unset (`manual`) and no UI can reach it.
- Pre-existing, out of scope: `apps/mobile` checks fail locally on a missing `eslint`
  and a wrong npm script; they pass in CI.
- Task-search migrations are additive and non-destructive. Production GIN creation
  may briefly lock or load the 397-row `tasks` table. Postgres English stemming and
  SQLite tokenization can differ in candidate membership; shared BM25 aligns ordering
  for common candidates.

## Corrections on record

**#1327.** The two-account isolation guard is **not** in
`issue_1175_mobile_gateway_security.test.ts` — that file has no two-account
assertions. It lives in `issue_1285_mobile_chat_discovery.test.ts` (ownerA/ownerB);
the 2026-07-30 session-visibility decision mis-attributed it to #1175. AJ has declared
the two-account concern void for this deployment. The owner-dimension short-circuit
was still not built: the confirmed defect was child-session ancestry, not owner
matching, so relaxing owner checks would not have fixed it.

**#1332.** Sessions going "hung and inaccessible" was diagnosed twice as engine
restarts stranding SDK sessions, and "start fresh" was advised. Both were wrong. The
cause was the engine's **branch-scoped session database** — the build stamps the
channel with the git branch, so checking out a branch silently repointed the engine at
an empty store. The context was reachable the whole time in another file. A branch
switch and an engine restart present identically (engine reports 0 sessions).

## Test status

- **api_server: 482 files pass, 0 fail, 85 skipped** (`npm test --
  --fileParallelism=false`), `tsc` clean, on `b57d9c05`.
- **desktop_flutter: 1049 tests pass, 0 fail**, 0 analyze errors, format clean — up
  from 636 runnable before the 65 test fakes were repaired.
- mcp_server: 155/155; typecheck, lint, build clean.
- opencode fork: typecheck clean; session suite 388 pass, tool 297, file 95.
- **CI coverage gap on this branch:** Server CI is green on `e47af9d5`, but the two
  newest api_server commits (`4f9879a3`, `b57d9c05`) have **no CI run** — GitHub
  created none for them. Local suite is green on `b57d9c05`.
- `agents_capabilities_routes.test.ts` flaked once with `UND_ERR_SOCKET` under
  full-suite load; passes 20/20 in isolation and did not recur.
- **Task-search Tier 1+2 verification PASS:** api_server 4055 pass/131 skip;
  mcp_server 161 pass/2 skip; live real API+engine+MCP 3/3; typechecks, builds, and
  security checks pass. All 75 contract criteria pass or are reasoned `not_tested`,
  with no unresolved statuses. The 397-task fixture shrank from 234,425 to 20,059
  characters (91.4%) in three repeated runs.

## Next step

Merge #1330 → `main`, dispatch `desktop_release.yml` with `0.18.55`, then watch the
release build (it does its own full build + sign + notarize, which is the real
verification of the desktop side). After that, the on-device #1327 subagent-approval
confirmation and the two owed #1319 code items. For task-search, hand off low-traffic
deployment and manual smoke review to a human; do not merge.
