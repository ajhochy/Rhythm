# Project State

## Current focus

2026-08-03: Config Doctor remediation (PR #1303) now covers TWO separate
Config Doctor audits on the same branch: the original 72h scheduled-task
audit (auto-approve/run-history/glob-timeout, 4 of 5 tracks) plus a second,
independent live-agent Config Doctor pass that found 4 more app-source bugs
(MCP secret-wiping, a test suite that corrupts the real dev config, a
scheduled-run hang gap that turned out already-fixed, and the #1302
trust-classification follow-up). All new fixes are CI-green; nothing has
had a full Rhythm quit+reopen + live smoke yet. Also consolidated the
open-PR backlog: the 2026-07-30/31 mobile smoke night left several stacked
branches open whose commits had all already landed in
`codex/mobile-fixes-rollup` (#1284); those are now closed.

## Second Config Doctor pass (2026-08-03, same PR #1303 branch)

Four findings from a live-agent Config Doctor run, triaged against what
PR #1303 already shipped earlier today (Bug 4 overlapped — see below):

- **Fixed — MCP env-merge (opencode_client_service.ts `ensureCuratedMcps`):**
  it replaced the whole persisted MCP entry on every launch instead of
  merging, silently wiping any user-supplied `environment` keys (e.g.
  `OBSIDIAN_API_KEY`, `STRIPE_SECRET_KEY`, `MAILCHIMP_API_KEY`) that the
  static curated-server template doesn't declare. Now merges
  `existingEnv → template env → bridged token env`, template still wins on
  conflict. Regression test `opc_curated_mcp_ensure.test.ts` c6 (scoped to
  a single server via `opts.servers` to avoid a machine-local
  `curated_mcp_servers.local.json` sidecar file that makes the full-catalog
  idempotency tests flaky on this dev box — pre-existing, unrelated to this
  fix, confirmed by running the same 3 tests against unmodified HEAD).
- **Fixed — test suite corrupting the real dev config
  (`issue_723_mcp_remove_reconcile.test.ts`):** `OpencodeClientService`
  resolves `~/.config/...` paths via a runtime `require('fs')` +
  `os.homedir()` inside each method, which is NOT intercepted by this
  test's top-level `vi.mock('fs', ...)` (that only patches the static
  `import` graph). Every write escaped straight to the real
  `~/.config/opencode/opencode.json` and `~/.config/rhythm/mcp-deletions.json`
  — verified live by reproducing the leak (added a real `foo` MCP entry to
  the developer's actual config just by running this one test file) before
  fixing it. Fix: `vi.stubEnv('HOME', <mkdtempSync tmp dir>)` in
  `beforeEach`/`afterEach`, since `os.homedir()` reads `$HOME` on POSIX —
  sandboxes every homedir()-derived path regardless of the fs-mock gap.
  `opc_m4_3_mcp_routes.test.ts` (the other file named in the original
  report) was checked and is safe — it mocks `addMcp`/`removeMcp` at the
  service-method level, so the real `fs`/`homedir()` code never runs there.
- **No fix needed — scheduled-run hang gap:** investigated whether a run
  producing zero progress (empty assistant outputs, then silence) can still
  get stuck `running` forever. It cannot, in current code: `agent_runner.ts`
  arms a hard ~1hr ceiling (`AGENT_RUN_HARD_TIMEOUT_MS`) independent of the
  inactivity-progress timer, and `agentSchedulerService.ts` persists a real
  `error` status on either timeout path. The 2.5+ hour `ffb-podcast-vibes`
  hang that motivated this finding was almost certainly observed against
  the live app instance running on a different branch/worktree
  (`codex/mobile-fixes-rollup`), predating this fix — not a live gap in
  current code.
- **Fixed (scoped) — issue #1302, Bug 4 Option B:** `agent-session.list`
  (the `rhythm_list_sessions` MCP tool, in `apps/mcp_server`, NOT
  `apps/api_server`) was tainting the calling session identically to
  genuinely external sources (gmail, web, PCO), arming the outbound-write
  approval gate just for reading Rhythm's own session transcripts — the
  same root cause the existing scoped `librarian` bypass
  (`decisions/2026-08-03-auto-approve-scoped-bypass.md`) works around for
  one profile only. Considered and rejected a fuller "transitive taint"
  design (flag sessions that were ever exposed to real external content, so
  a later first-party read couldn't launder injected content forward) —
  unnecessary because the content scanner already runs and fences at
  first ingestion, before anything is ever persisted to a transcript; a
  second read doesn't re-expose anything the first read didn't already
  vet. Shipped instead: `SOURCES_EXEMPT_FROM_APPROVAL_GATE` in
  `apps/mcp_server/src/security/external_content_boundary.ts` — skips
  `recordExternalContentTaint` for `agent-session.list` only (still scans,
  still fences with the same "treat as data" directive; every other source
  keeps arming the gate unchanged). This fixes it for every profile, not
  just `librarian` — the existing PR #1303 bypass can stay as-is or be
  removed once this is live-verified; not touched in this pass.

## Open PRs

- **#1284** — `codex/mobile-fixes-rollup`, "Mobile Agents reliability,
  parity, and profile scoping (#1277–#1286)". Superset rollup — verified via
  `git merge-base --is-ancestor` to already contain every commit from
  #1259/#1266/#1268 (all closed as redundant, 2026-08-03). CI green
  (Server + Mobile CI). Its own PR body notes #1280 (composer growth
  regression) stays open until a signed multiline-composer smoke passes —
  that caveat now lives here, not on a separate PR. Not merged; awaiting
  human review/smoke.
- **#1303** — `workflow/run-2026-08-03-config-doctor`, Config Doctor
  remediation. CI green (Server + Desktop). See
  [decisions/2026-08-03-auto-approve-scoped-bypass.md](decisions/2026-08-03-auto-approve-scoped-bypass.md)
  for the `librarian` auto-approve decision. Draft; not merged.
  Still needed before merge: full Rhythm quit+reopen (opencode.json/profile
  changes don't hot-reload), then confirm Memory Consolidation actually
  captures > 0 and `GET /agent-schedules/:id/runs` returns real history.

## Closed as redundant (2026-08-03)

#1259 (MSP-005 native composer), #1266 (MSP-002 three-dot config), #1268
(R1–R6+P0 combined smoke-vehicle branch) — all fully contained in #1284,
confirmed by commit ancestry, not just title inspection.

## Config Doctor audit — Track A (done outside this repo, no PR)

`~/.config/opencode/opencode.json`: removed dead `foo` entry; `scrapling`
disabled after tracing 3 stacked upstream breaks (mcp 2.0 relocation →
hardcoded Chrome 149 fingerprint gap in browserforge's dataset → missing
camoufox binary) — `theological-research-daily` needs a different fetch
backend if re-enabled. `Org External Discovery` schedule disabled via API —
confirmed `mcp-registry` was never a real server (checked the official MCP
registry, GitHub's client SDK, and two dead hobby packages; none fit).
Both opencode.json edits need the pending full-app relaunch to take effect.

## Config Doctor audit — Track E (done, no diff)

`npm run doctor` was broken by `node_modules` drift in `apps/api_server`
(not a missing dependency declaration) — fixed with a root `npm install`,
zero manifest changes. Also surfaced a Python 3.9.6 (needs ≥3.10) gap not in
the original audit.

## Risks

- Nothing in PR #1303 is verified against the live app yet — nothing has
  actually captured a memory, written a run-history row, or hit the
  glob-watchdog/partial-result-recovery paths for real. CI green is not
  behavioral proof (this is the exact lesson #1259/#1280 already taught this
  repo: don't merge on CI alone when the fix depends on live agent runtime
  behavior).
- The running api_server on :4001 is on a different worktree/branch
  (`codex/mobile-fixes-rollup`) than `workflow/run-2026-08-03-config-doctor`
  — it will not reflect PR #1303's code until the app is rebuilt from that
  branch (or merged) and relaunched.

## Next step

1. Full Rhythm quit + reopen.
2. `curl -X PATCH http://localhost:4001/agent-configs/librarian -d '{"autoApproveActions": true}'`
   (or confirm the PR's own migration/default already set it once merged).
3. Trigger Memory Consolidation, confirm `Captured: N` with N > 0.
4. Check `GET /agent-schedules/:id/runs` returns real history for a couple
   of tasks.
5. Set an Obsidian/Stripe/Mailchimp API key via Settings, fully relaunch,
   confirm the key survives (second Config Doctor pass, Bug 1).
6. Human review/merge of #1284 and #1303 (both currently draft, neither
   merged).
