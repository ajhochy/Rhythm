---
date: 2026-08-18
repo: Rhythm
branch: numbat-opencode-observability
pr: TBD
issues: [1452]
status: ready-for-verification
tags: [run, Rhythm]
---

# Wire observe-only Numbat OpenCode monitoring into api_server startup (#1452)

## Files

New:
- `apps/api_server/src/services/numbat_observability_service.ts` — binary
  resolution (`RHYTHM_NUMBAT_BIN_PATH` → `/opt/homebrew/bin/numbat` →
  `/usr/local/bin/numbat` → bare `numbat` on PATH), `RHYTHM_NUMBAT_MONITORING_DISABLED=1`
  check first, spawns `numbat hook install --agent opencode --emit all
  --content preview` (fire-and-forget, `detached`+`unref`) when enabled and
  resolved. Never throws.
- `apps/api_server/src/__tests__/numbat_observability_service.test.ts` — 13
  unit tests: binary resolution fallback order, exact install argv, disable
  flag (AC5), absent-binary fail-open (AC6), no HTTP token/HMAC env vars set,
  never throws on spawn failure/child error event.
- `apps/api_server/src/__tests__/numbat_observability_live_e2e.test.ts` —
  `RHYTHM_LIVE_E2E=1`-gated. Checks numbat's real availability via
  `resolveNumbatBinary()` first and skips gracefully (not a failure) when
  absent. When present: asserts the generated plugin's `EXTRA_ARGS` (AC1),
  drives a real session + tool call over the WS gateway and asserts new
  bounded (<=200 code point) `content_preview` NDJSON records with no
  `record_type: "enforcement"`, and that the turn completes without
  `status: 'error'` (AC2/AC4).
- `docs/ai/contracts/issue-1452.json` — acceptance contract (AC1-AC8).

Modified:
- `apps/api_server/src/server.ts` — added a new, independent try/catch inside
  the existing `if (env.agentExecutionEnabled)` block (after the
  `opencode_plugin_config.ts` ensure/sync calls) invoking
  `ensureNumbatObservability()`. No change to any existing call.
- `apps/api_server/src/config/env.ts` — added a doc-comment (no new export;
  the flags are read directly by the new service, matching the
  `RHYTHM_TOOL_TELEMETRY_DISABLED` precedent) documenting
  `RHYTHM_NUMBAT_MONITORING_DISABLED` / `RHYTHM_NUMBAT_BIN_PATH`, placed near
  `GEMINI_CODE_ASSIST_PROJECT_ID` (~line 169 per the issue).
- `apps/api_server/.env.production.example` — documented both env vars.
- `docs/ai/testing-guide.md` — new "Numbat OpenCode observability hook
  (#1452, observe-only)" subsection (install command, disable flag, default
  `$HOME/.numbat/records.ndjson` path/format, no-rotation gap, exact
  validation commands).
- `docs/testing/manual-smoke.md` — new "15. Numbat OpenCode observability
  hook (#1452)" checklist section.

## Checks

```bash
cd apps/api_server
npx vitest run src/__tests__/numbat_observability_service.test.ts
```
Result: **PASS** — 13/13 tests green.

```bash
node_modules/.bin/tsc --noEmit
```
Result: **PASS** — clean, no errors.

```bash
tools/dev/sandbox.sh up
```
Result: **PASS** — fork binary + api_server built, sandbox reached ready
(`http://127.0.0.1:4098`, engine `:4097`). Confirmed live in
`api_server.log`:
```
[INFO] [NumbatObservability] numbat binary not found (checked RHYTHM_NUMBAT_BIN_PATH, /opt/homebrew/bin, /usr/local/bin, and PATH) — observe-only monitoring stays inert. Install https://github.com/perplexityai/numbat to enable it.
```
This is real, live evidence of AC6 (absent binary → one informational log
line, no thrown error, api_server started normally) against the actual
running server — not a mock.

```bash
RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/numbat_observability_live_e2e.test.ts --no-file-parallelism
```
Result: **PASS** — 2/2 tests green, but **both gracefully SKIPPED their
assertion body** (not their execution — `beforeAll` health-checked the real
running API+engine first, so this is a genuine hit against the sandbox). The
test resolved `numbat` via the exact same `resolveNumbatBinary()` logic the
service uses and found it absent on this machine (confirmed independently:
`which numbat` → not found, exit 127), so AC1/AC2/AC4's assertions never ran
for real here. This machine cannot verify those three criteria end-to-end —
see contract file's `not_tested`/`UNVERIFIED` entries for the honest
breakdown. The live test IS correctly wired (it reached the sandbox, checked
binary presence, and self-skipped per the issue's explicit instruction to
"check first... whether it's actually installed here before assuming the
live test can run for real") — it is the numbat BINARY that is not installed
on this dev machine, not a gap in the test.

```bash
tools/dev/sandbox.sh down
```
Result: **PASS** — sandbox removed, ports 4098/4097/4099 confirmed free
afterward.

## GitNexus

- `impact({target_uid: "File:apps/api_server/src/config/env.ts", direction: "upstream"})`
  → **LOW risk, 0 impacted symbols** (the env.ts edit is a pure doc-comment
  addition between two existing statements — no exported symbol changed).
- `context({name: "main", file_path: "apps/api_server/src/server.ts"})` →
  not found as an indexed symbol (server.ts's top-level `async function
  main()` isn't graph-indexed as a named callable in this index snapshot).
  The new call site is a self-contained try/catch added after the existing
  `opencode_plugin_config.ts` block, touching no existing call.
- `detect_changes({scope: "all"})` (post-staging, so untracked new files were
  visible too) → **risk_level: low, affected_processes: []**. The tool
  attributed doc-section touches in `testing-guide.md`/`manual-smoke.md` but
  could not map the server.ts/env.ts hunks to specific indexed symbols
  (index-staleness limitation for a just-added file, and `main()` not being
  an indexed symbol per above) — consistent with a purely additive change:
  zero affected execution flows reported.

## Notes / deviations from the issue's assumptions

- **numbat is not installed on this dev machine.** `which numbat` → not
  found. This means AC1, AC2, and AC4's live/behavioral halves could not be
  verified end-to-end here, only their static-argv halves (AC3-equivalent
  unit test) and the structural "no code path connects numbat to
  tool-execution/approval" claim (verified via GitNexus + the fact this PR
  adds zero calls into any approval/execution route). This is flagged
  honestly in `docs/ai/contracts/issue-1452.json`'s `not_tested` list with
  per-criterion reasons — nothing was silently marked green.
- No deviation from the issue's scope: did not touch `opencode_plugin_config.ts`,
  `RHYTHM_MANAGED_PLUGIN_NAMES`, or create a vendored `opencode_plugins/` dir;
  did not add enforcement, forensic reconstruction, custom rotation, or
  `--content full`; did not bundle/auto-download the `numbat` binary.
- `docs/ai/project-state.md` was not touched (per explicit instruction —
  that's PR #1383's active focus).
- AC7 (no collision with #1069 `run_quality` telemetry) is a structural
  code-inspection claim, not independently automatable beyond a trivial
  path-string check — recorded as `manual`/`UNVERIFIED` with the concrete
  schema comparison in the contract file and stated here: `run_quality_service.ts`'s
  `tool_events` SQLite table (session/tool/duration/status columns) shares no
  file, table, or env var with numbat's separate `$HOME/.numbat/records.ndjson`.

## Next step

Human/CI verification on a machine with `numbat` actually installed (e.g.
`brew install perplexityai/tap/numbat` if that tap exists, or the release
binary from `github.com/perplexityai/numbat`) to run the live-e2e test for
real and close out AC1/AC2/AC4 with genuine evidence.
