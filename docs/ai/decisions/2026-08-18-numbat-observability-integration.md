---
tags: [decision, Rhythm]
---

# Numbat observability integration shape

## Context

AJ ran a prior eval (Obsidian: `Resources/Tech-AI-Research/Topics/numbat-agent-endpoint-monitoring-eval.md`,
not reachable from this session) that verdicted **adopt** perplexityai/numbat's
observe-only OpenCode hook for passive local agent-activity visibility, and
**skip** forensic reconstruction (numbat's at-rest parser only covers
OpenCode's old JSON session-store format, not Rhythm's current `opencode.db`)
and **skip** any enforcement/blocking mode (not a substitute for
`rhythm_request_approval`).

This planning pass had to answer two things the eval didn't cover: the exact
mechanics of numbat's OpenCode integration (confirmed against numbat's real
source below), and how that mechanism fits Rhythm's existing plugin-wiring
pattern in `apps/api_server/src/services/opencode_plugin_config.ts`.

### Verified facts (primary source: `github.com/perplexityai/numbat`, fetched directly — README.md, docs/cli.md, docs/agent-coverage.md, `internal/hook/install_opencode.go`)

- **Install command:** `numbat hook install --agent opencode [flags]`. No
  `--enforce` flag is accepted for `--agent opencode` — the CLI's own
  `--enforce` agent list (`docs/cli.md`) omits `opencode` entirely, and
  `install_opencode.go`'s doc comment states it plainly: *"It takes no enforce
  flag: OpenCode is observe-only (enforce refused at the Install gate)."*
  `docs/agent-coverage.md`'s matrix confirms: `OpenCode | ... | Enforcement:
  no`. This is a hard upstream constraint, not a config choice we could get
  wrong.
- **Generated plugin file — confirmed observe-only by reading the actual
  template** (`openCodePluginSourceWithArgs` in `install_opencode.go`): the
  emitted TypeScript's `forward()` helper does `spawn(NUMBAT_BIN, ["hook",
  lifecycle, ...], { stdio: [...], detached: true }); child.unref()` — fire
  and forget, no return value read, nothing can block or alter a tool call.
- **No numbat config file exists anywhere** (no `~/.numbat/config.yaml` or
  equivalent) — every behavior is pinned by the flags on the one-time
  `hook install` invocation, which get baked as a literal `EXTRA_ARGS` array
  into the generated `numbat.ts`. There is no separate switch a user or a rule
  update could later flip to enable an HTTP sink or full-content capture —
  reading `EXTRA_ARGS` in the generated file is a complete, static audit of
  what the hook will ever do.
- **HTTP sink is off unless explicitly requested**: `hook install` defaults to
  `--output file`; HTTP requires `--output http --http-url URL` explicitly,
  and HTTP auth secrets are read only from env vars, never baked into the
  hook command.
- **Content capture default is `preview`** (≤200 Unicode code points,
  redacted); `--content full` is opt-in and still bounded/redacted to 1 MiB —
  we are explicitly not using it.
- **Default output location:** `hook install` with `--emit findings` (the
  default) writes `$HOME/.numbat/findings.ndjson`; selecting `--emit
  events|indicators|all` changes the default to `$HOME/.numbat/records.ndjson`.
  **No rotation** — `docs/live-capture.md`/`docs/cli.md` both state numbat
  never rotates its own output files; that's the operator's job (log
  forwarder or OS retention policy).
- **Distribution: single Go binary only** (macOS/Linux/Windows release
  binaries, or `go install github.com/perplexityai/numbat/cmd/numbat@latest`
  with Go 1.26.6+). Not an npm package — nothing to `npm install` here.
- **Critical wiring-mechanism finding** (from OpenCode's own plugin docs,
  `https://opencode.ai/docs/plugins/`): OpenCode loads plugins two ways —
  (a) an npm-name/absolute-path entry in opencode.json's `plugin` array (the
  mechanism Rhythm's `ensureRequiredPlugins()` already manages for
  `rhythm-anthropic-accounts` / `rhythm-telemetry` / `rhythm-session-context`),
  or (b) **auto-loaded `.ts`/`.js` files dropped in `~/.config/opencode/plugins/`
  ("global plugins"), no config-array entry needed.** Numbat's installer uses
  mechanism (b) — it writes straight to
  `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/numbat.ts` (or
  `$OPENCODE_CONFIG_DIR/plugins/numbat.ts` if that env var is set). **This is
  a different wiring point than `ensureRequiredPlugins()`'s `plugin` array —
  it does not go through that function or `RHYTHM_MANAGED_PLUGIN_NAMES` at
  all.** Both mechanisms coexist and all hooks run in sequence per OpenCode's
  own docs, so a numbat-owned global plugin and Rhythm's array-registered
  `rhythm-telemetry` plugin both fire independently on the same
  `tool.execute.before/after` events with zero collision risk.
- Numbat's install is **idempotent** (`hook install` "each action is
  idempotent... a re-install rewrites the same stable file", backs up a
  pristine pre-existing numbat-owned file once) — safe to invoke on every
  api_server startup without extra diffing logic on Rhythm's side.

## Decision

**Invoke the real `numbat` CLI as a subprocess during api_server startup** to
run `numbat hook install --agent opencode --emit all --content preview`
(`--output file`, i.e. numbat's own default, is left implicit), gated by:

1. A disable flag, **`RHYTHM_NUMBAT_MONITORING_DISABLED=1`**, matching the
   `RHYTHM_TOOL_TELEMETRY_DISABLED` naming precedent — checked before
   attempting anything.
2. Best-effort binary resolution (env override
   `RHYTHM_NUMBAT_BIN_PATH`, then common Homebrew install paths
   `/opt/homebrew/bin/numbat` / `/usr/local/bin/numbat`, then bare `numbat`
   via inherited `PATH`) — **if none resolve, log one line and return**. This
   is not optional: Rhythm's api_server is spawned by the Flutter desktop app,
   which does not reliably inherit a Homebrew-augmented shell `PATH` the way a
   Terminal-launched process would.
3. The install call itself never throws into the startup path — same
   fail-open contract as `ensureManagedDefaults`/`syncOrgInstructions` in
   `opencode_plugin_config.ts`.

New file `apps/api_server/src/services/numbat_observability_service.ts` owns
this (binary resolution + disable check + subprocess spawn), called from
`server.ts` inside the existing `if (env.agentExecutionEnabled)` block next to
the other `ensure*`/`sync*` calls — its own try/catch, independent of theirs.
**No change to `opencode_plugin_config.ts` or `RHYTHM_MANAGED_PLUGIN_NAMES`** —
numbat's plugin does not go through the `plugin` array at all (see finding
above), so that pattern doesn't apply here and shouldn't be forced onto it.

## Alternatives considered

1. **Vendor a static copy of numbat's generated plugin template** under
   `apps/api_server/opencode_plugins/numbat-observer/` and register it via
   `ensureRequiredPlugins()`, matching the `rhythm-*` pattern exactly.
   Rejected: the vendored shim still has to `spawn(NUMBAT_BIN, ...)` for the
   actual capture/redaction logic, so it doesn't remove the external-binary
   dependency — it only relocates where a hand-copied fork of numbat's
   generator output lives, with real drift risk (a wrong marker string or
   stale lifecycle wiring breaks silently, and `numbat hook status --agent
   opencode` / `numbat hook uninstall` — the operator's own verification and
   removal tools — would never recognize a plugin installed this way, since
   they only look at `~/.config/opencode/plugins/numbat.ts`).
2. **Zero code — document a manual `numbat hook install --agent opencode`
   step** in `docs/testing/manual-smoke.md` only. Rejected as under-delivering
   on "wire it into Rhythm's OpenCode-based agent sessions": a manual step
   silently rots across 10-15 users' machines and doesn't match the
   established disable-flaggable-plugin precedent (`rhythm-telemetry`,
   #1069). Kept as the automatic **fallback behavior** for any machine
   without the `numbat` binary present — the feature degrades to "documented,
   not yet installed" rather than blocking startup.
3. **Bundle/auto-download the `numbat` binary during api_server or Flutter
   build.** Rejected for V1: adds real release-pipeline surface (per-OS/arch
   binary fetch + checksum verification) for a 10-15-user internal tool where
   the eval already scoped this as an opt-in, best-effort capability, not a
   hard requirement. Revisit only if this issue's manual-install fallback
   proves too easy to skip in practice.

## Consequences

- Rhythm never carries a maintained copy of numbat's plugin-generation logic
  — upgrading the `numbat` binary on a machine picks up any upstream template
  or redaction fix for free on the next api_server restart (idempotent
  re-install).
- The feature is entirely inert (no plugin file, no data captured) on any
  machine without the `numbat` binary present — this must be called out
  clearly in the PR/manual-smoke as "opt-in, not yet installed" rather than
  "broken," and is the reason this issue's acceptance criteria require testing
  both the present-binary and absent-binary paths.
- Verification that "no telemetry, standard redaction" is what actually
  shipped is a **static read** of the generated
  `~/.config/opencode/plugins/numbat.ts`'s `EXTRA_ARGS` array (must contain
  no `--enforce`, no `--output`/`http`, no `--content full`) plus confirming
  the exact argv Rhythm's install call passes — not a numbat config file,
  because none exists.
- Captured data lands in numbat's own NDJSON files under `$HOME/.numbat/`,
  wholly separate from Rhythm's `run_quality` SQLite tables (#1069) — both
  hook the same `tool.execute.before/after` OpenCode events independently
  (different plugin, different loading mechanism, different storage), so
  there is no schema or write-path collision to reconcile.
- No rotation exists on numbat's side; this issue documents that gap (default
  path, format, growth-without-bound) rather than building custom rotation —
  a real but explicitly out-of-scope operational follow-up if the file grows
  large in practice.
