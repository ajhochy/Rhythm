# Wire observe-only Numbat OpenCode monitoring into api_server startup

## Context

A prior eval verdicted **adopt** perplexityai/numbat's observe-only OpenCode hook for passive, local agent-activity visibility (real zero-custom-work installer, local-only by default, 200-char redacted content preview by default), and **skip** forensic reconstruction and any enforcement mode. This issue wires that adopt-path installer into Rhythm's api_server startup, the same place `ensureRequiredPlugins()`/`ensureOrgSkillIndex()`/etc. already provision the OpenCode engine's config before the SDK subprocess spawns. Full design rationale + all verified upstream facts: `docs/ai/decisions/2026-08-18-numbat-observability-integration.md`.

**Key wiring fact:** numbat's OpenCode installer does NOT go through Rhythm's `opencode.json` `plugin`-array pattern (`opencode_plugin_config.ts`/`RHYTHM_MANAGED_PLUGIN_NAMES`) — it writes an auto-loaded global plugin file straight to `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/numbat.ts`, a separate OpenCode plugin-loading mechanism. So integration = invoke the real `numbat` CLI as a subprocess at startup, not vendor a copy into `apps/api_server/opencode_plugins/`.

## Scope

1. **`apps/api_server/src/services/numbat_observability_service.ts` (new):** resolve the `numbat` binary (`RHYTHM_NUMBAT_BIN_PATH` override → `/opt/homebrew/bin/numbat` / `/usr/local/bin/numbat` → bare `numbat` on inherited `PATH`), check `RHYTHM_NUMBAT_MONITORING_DISABLED=1` first, and if enabled+found, spawn `numbat hook install --agent opencode --emit all --content preview` (leaving `--output file` implicit — numbat's own default). Never throws; logs one line and no-ops when disabled or binary absent.

2. **`apps/api_server/src/server.ts` (~line 495-550):** call it from inside the existing `if (env.agentExecutionEnabled)` block, its own try/catch, independent of the other `ensure*`/`sync*` calls there.

3. **`apps/api_server/src/config/env.ts` (~line 169):** document `RHYTHM_NUMBAT_MONITORING_DISABLED` and `RHYTHM_NUMBAT_BIN_PATH` in doc-comments (matching the existing plugin-flag comments).

4. **`apps/api_server/.env.production.example`:** document both env vars and their defaults.

5. **`docs/ai/testing-guide.md`:** document the default capture location, format, and absence of rotation: `$HOME/.numbat/records.ndjson` (NDJSON, one JSON object per line, `schema_version`/`record_type` fields per numbat's wire format). Note that numbat does not rotate this file itself; operator-managed gap only, not something this issue builds a replacement for.

6. **`docs/testing/manual-smoke.md`:** add a manual verification step: run a real agent session, confirm `~/.config/opencode/plugins/numbat.ts` exists and its `EXTRA_ARGS` contains no `--enforce`/`--output`/`http`/`--content full`, confirm `~/.numbat/records.ndjson` gained bounded-preview records for that session, confirm no `NUMBAT_HTTP_TOKEN`/`NUMBAT_HTTP_HMAC_KEY` env vars are set anywhere in Rhythm's process env.

## Out of scope (explicit blockers on scope creep)

- **Forensic/at-rest reconstruction** — blocked upstream, numbat's parser covers only OpenCode's old JSON session-store format, not Rhythm's current `opencode.db`.
- **Enforcement/pre-action blocking mode** — not implemented for OpenCode upstream (numbat's CLI rejects `--enforce` for `--agent opencode`); even where numbat supports it, it is not a substitute for `rhythm_request_approval`.
- **Custom log rotation/retention** for numbat's output file — document the gap only.
- **`--content full` (full, unredacted content capture)** — never pass this flag.
- **Any change to `opencode_plugin_config.ts`, `RHYTHM_MANAGED_PLUGIN_NAMES`, or a new vendored `opencode_plugins/` directory** — confirmed unnecessary; numbat uses a different OpenCode plugin-loading mechanism entirely.
- **Auto-downloading/bundling the `numbat` binary in the build** — machine must already have it installed; feature stays inert (not broken) when absent.

## Acceptance criteria

- [ ] **AC1:** On a machine with `numbat` installed and `RHYTHM_NUMBAT_MONITORING_DISABLED` unset, starting api_server (via `tools/dev/sandbox.sh up`, never by hand) results in `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/numbat.ts` existing, with an `EXTRA_ARGS` array containing no `--enforce`, no `--output`/`http`, no `--content full`.

- [ ] **AC2:** A real OpenCode session driven through the sandbox (tool call + prompt) produces new lines in the configured NDJSON output file, each with `content_preview` bounded to ≤200 code points (never full prompt/response text) and no record with `record_type: "enforcement"`.

- [ ] **AC3:** Confirmed local-only/no-telemetry: no `--http-url`/`--output http` ever passed; `NUMBAT_HTTP_TOKEN`/`NUMBAT_HTTP_HMAC_KEY` not set by Rhythm anywhere; asserted by both a unit test (exact argv) and the manual smoke step.

- [ ] **AC4:** Confirmed enforcement is NOT enabled: generated plugin's `EXTRA_ARGS` has no `--enforce`; a hostile/attempted tool call is never blocked, delayed, or altered by the numbat hook (only `rhythm_request_approval` gates actions).

- [ ] **AC5:** Setting `RHYTHM_NUMBAT_MONITORING_DISABLED=1` results in zero subprocess spawn attempt and no plugin file changes — verified by a unit test.

- [ ] **AC6:** On a machine/CI runner where `numbat` cannot be resolved, api_server starts normally with one informational log line and no thrown error — verified by a unit test that stubs binary resolution to fail.

- [ ] **AC7:** No collision with #1069's `run_quality` telemetry: both hooks (numbat's global plugin, `rhythm-telemetry`'s array-registered plugin) fire independently on the same session with no shared file/table/env var — confirmed by inspecting `run_quality_service.ts`'s schema (tool name/duration/status only, SQLite-backed) against numbat's NDJSON output (separate file, separate format), and stated explicitly in the PR description.

- [ ] **AC8:** `docs/ai/testing-guide.md` and `docs/testing/manual-smoke.md` document the exact install command, disable flag, default output path/format, and the no-rotation gap.

## Likely files

- `apps/api_server/src/services/numbat_observability_service.ts` (new)
- `apps/api_server/src/server.ts` (~line 495-550)
- `apps/api_server/src/config/env.ts` (~line 169)
- `apps/api_server/src/__tests__/numbat_observability_service.test.ts` (new)
- `apps/api_server/src/__tests__/numbat_observability_live_e2e.test.ts` (new, `RHYTHM_LIVE_E2E=1`-gated, skips gracefully with no `numbat` binary)
- `apps/api_server/.env.production.example`
- `docs/testing/manual-smoke.md`
- `docs/ai/testing-guide.md`

## Dependencies

None — additive only, no schema/migration, no file overlap with the currently-open PR #1383 (mobile smart-client rebuild, awaiting manual smoke) or the open Live Artifacts plan.

## Required validation commands

```bash
cd apps/api_server
npx vitest run src/__tests__/numbat_observability_service.test.ts
node_modules/.bin/tsc --noEmit
tools/dev/sandbox.sh up
RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/numbat_observability_live_e2e.test.ts --no-file-parallelism
tools/dev/sandbox.sh down
```

Plus manual smoke per `docs/testing/manual-smoke.md`'s new step.

---

## Notes

- **Branch name:** `numbat-opencode-observability`
- **PR posture:** draft only — no merge, per repo production posture (10-15 daily users).
