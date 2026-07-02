# Project State

## Current focus

One integration branch (`codex/mega-2026-07-02`, PR #848) carries the 2026-07-02
build-out — Org Self-Optimizer epic (#816, all 15 sub-issues), token-efficiency
(#841/#842/#844/#845), life-layer (#846 recipes, #847 research→vault entries),
#834 obsidian writes, Ollama provider, taskless-trigger fix — PLUS the live
fork-in-dev enablement + four bugs found by running the agent eval against the
real fork (#854/#855/#856/gmail) and one critical safety gap the first live
optimizer run exposed (#857). Memory-vault epic #801 shipped earlier (in #812).

## Active branch / PR

- **PR #848** (draft) — `codex/mega-2026-07-02`. Everything below is folded here.
- **PR #849** (draft) — `issue-843-fork-deferred-tool-loading` (fork; signed-release
  smoke required before merge).

## How to run the FORK in dev (critical — was silently running STOCK opencode)

Dev (`flutter run`) does NOT use the fork by default: `augmentPathForOpencode`
only prepends the bundled fork when `<Resources>/opencode_bin/opencode` exists
(release only), else falls back to stock `~/.opencode/bin/opencode` (v1.14.40)
with a WARN — and stock has NONE of the scoping patches. To run the fork in dev:
1. Build it (arm64, ~36s, avoids the dual-build OOM):
   `cd apps/opencode_fork/packages/opencode && bun install && bun run build --single`
   → `dist/opencode-darwin-arm64/bin/opencode` (version `0.0.0-codex/...`).
2. Place at the dev discovery path: `cp` it to `apps/opencode_bin/opencode`
   (= candidateBinDirs[0] relative to the api_server src) and `chmod +x`.
3. Ad-hoc sign with the library-validation entitlement (unsigned local binary):
   `codesign --force --sign - --entitlements <plist w/ disable-library-validation> --options runtime apps/opencode_bin/opencode`
4. Restart the app. Startup log now states which engine: `engine: <path> (bundled
   fork build — fork patches expected active)` vs `(stock PATH — scoping inactive)`.
   `RHYTHM_OPENCODE_BIN` / `RHYTHM_OPENCODE_BIN_DIR` env overrides also work (#855).
`apps/opencode_bin/` is gitignored/untracked — rebuild per machine.

## Verified LIVE against the fork (2026-07-02)

- **MCP scoping trims the surface** once fork runs + allowlist pushed correctly:
  secretary session carried its 44 scoped tools (not the ~150K full catalog).
  Confirmed via the fork session's `mcpAllowlist={servers,tools}`.
- **Self-optimizer loop runs end-to-end**: `rhythm_run_org_optimizer` → audit →
  scope-hygiene generator → classify → auto-apply. Wrote 16 real low-risk proposals.
- **Delegation guardrails**: depth-cap (400), self-delegation (400), non-allowed
  target (403), direct grant — all enforced live.
- **Agent completion**: secretary drafts + correctly refuses out-of-scope probe.

## Bugs found by the live eval + FIXED (all folded to mega)

- **#854** — per-turn model resolver ignored `agent_configs` model → custom agents
  stalled ("no route in catalog"). Now resolves configured model before static fallback.
- **#855** — (a) dev ran stock opencode (fork-in-dev wiring above); (b) ws_gateway
  pushed the allowlist as a lying `string[]` cast of a tools-map object → fork
  rejected it → mcpAllowlist unset → full surface. Now expands via `expandMcpAllowlist`.
- **#846 binding** — ministry recipe tasks bound to dangling role-file UUIDs;
  now resolve to real slug-keyed rows + idempotent boot repair.
- **org-optimizer model** — seeded optimizer configs had NULL model → stalled;
  now default `anthropic/claude-sonnet-4-6` + unconditional boot backfill.
- **gmail Node bug** — `~/.config/opencode/opencode.json` gmail-work/gmail-personal
  got `PATH: /usr/local/bin:/usr/bin:/bin` (pins node 22.18.0 vs broken 22.23.0
  `ERR_STREAM_PREMATURE_CLOSE` on OAuth refresh). Backup `.bak-20260702-145214`.
  Not Rhythm-managed → live-config only, no repo change.

## Risks / known issues

- **#857 (CRITICAL — optimizer NOT safe unsupervised yet):** first live optimizer
  run auto-applied 16 tighten/prune proposals on THIN history, stripping tools
  agents actively use (secretary → `[]`, workflow-orchestrator → `[]`). Reverted
  manually (scopes restored from snapshots; proposals set `reverted`). The
  tighten-scope generator must require a minimum observation window before
  proposing; "no data yet" ≠ "unused". **Do NOT enable the seeded optimizer cron
  (#830) until #857 lands.**
- **No revert from `active`:** #817 state machine only allows `measuring→reverted`,
  so an auto-applied proposal can't be undone through the system (had to use direct
  SQL). Review queue needs an undo action (tracked in #857).
- **#856** — engine caches provider creds; switching Claude accounts needs an app
  restart (OAuth write alone doesn't reload). Quality-of-life.
- **Disabled/agent-less agents** (research, email-assistant rows disabled) can't
  resolve a model → their eval sessions FAIL; enable + set a model to test.
- **UI freeze under load:** app beach-balled (main thread 99% CPU, NOT memory —
  47% free) during the 360s optimizer run with ~20 eval sessions in the sidebar.
  Transcript/session-list render perf needs a pass. Force-quit is safe.
- Fork binary in dev is per-machine (unsigned ad-hoc); release path unchanged.

## Test status

- api_server: `tsc` clean; full `vitest` 213 files / ~1839 pass / 1 skip.
- `smoke_org_optimizer.sh`: safety invariants pass.
- Live fork run: scoping/loop/delegation verified (above).
- Filed this run: #854 (fixed), #855 (fixed), #856 (open), #857 (open, blocks cron).

## Next step

1. **#857 first** — data-sufficiency guard on tighten/prune + a review-queue undo;
   until then keep the optimizer cron OFF.
2. Review/merge PR #848 (+ #849 after a signed-release fork smoke). On merge,
   resolve `project-state.md` in favor of this file.
3. Optional: re-run the full eval on the fork with gmail + model fixes live to get
   a clean full-roster scorecard (secretary/worship-planning/etc. earlier ran on
   stock; only the scope dimension needs re-checking). Budget-permitting.
4. Enable research/email-assistant rows + models if they should be testable.
