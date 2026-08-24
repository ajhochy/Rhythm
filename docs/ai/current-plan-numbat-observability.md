# Plan — Numbat observe-only OpenCode monitoring

**Date:** 2026-08-18
**Status:** Planning complete — ready for `issue-writer` / `gh issue create`.

> Deliberately **not** written into `docs/ai/current-plan.md` — that file
> currently holds the still-open, blocked Live Artifacts / Worship Calendar
> plan (dated 2026-08-10, explicit open questions, no newer plan has
> superseded it). Overwriting it would destroy an active unrelated design
> record, the same reason AJ asked not to touch `project-state.md` for this
> task. This file is the scoped record for the Numbat work instead.

## Goal

Wire perplexityai/numbat's real, observe-only OpenCode hook into Rhythm's
api_server startup so agent sessions get passive, local-only activity
visibility, with zero enforcement and zero telemetry egress.

## Constraints

- Observe-only. Numbat's OpenCode integration has no enforcement mode at all
  (confirmed against `internal/hook/install_opencode.go` / CLI validator) —
  nothing to accidentally turn on here.
- Local-only, no HTTP sink, standard 200-char redacted preview content —
  pinned by the exact flags on Rhythm's one install invocation (no numbat
  config file exists to drift later).
- Must never block or slow api_server startup, and must never break agent
  sessions on a machine without the `numbat` binary installed (10-15 users,
  most won't have it — feature degrades to inert/not-installed, logged once).
- Out of scope: forensic reconstruction (blocked upstream — `opencode.db` not
  parsed by numbat), any enforcement/pre-action blocking mode (not a
  substitute for `rhythm_request_approval`), custom log rotation (numbat has
  none; document the gap, don't build a replacement).
- Draft PR + human manual smoke only, per repo production posture.

## Design (single well-understood change — gate skipped)

See `docs/ai/decisions/2026-08-18-numbat-observability-integration.md` for the
full options analysis. Chosen: invoke the real `numbat hook install --agent
opencode --emit all --content preview` CLI as a subprocess at api_server
startup (own new service file, own try/catch, gated by
`RHYTHM_NUMBAT_MONITORING_DISABLED` + best-effort binary resolution). This does
**not** go through `opencode_plugin_config.ts`'s `plugin`-array pattern —
numbat's installer writes directly to OpenCode's separate auto-loaded
`~/.config/opencode/plugins/` directory, a mechanism `ensureRequiredPlugins()`
doesn't touch.

## File structure map

| File | Responsibility |
|---|---|
| `apps/api_server/src/services/numbat_observability_service.ts` (new) | Resolve `numbat` binary (env override → common Homebrew paths → PATH), check `RHYTHM_NUMBAT_MONITORING_DISABLED`, spawn `numbat hook install --agent opencode --emit all --content preview`. Never throws. |
| `apps/api_server/src/server.ts` (~line 495-550) | Call the new ensure function inside the existing `env.agentExecutionEnabled` block, alongside `ensureRequiredPlugins`/`ensureOrgSkillIndex`/etc. Own try/catch. |
| `apps/api_server/src/config/env.ts` (near ~line 169's plugin-flag doc-comments) | Doc-comment for `RHYTHM_NUMBAT_MONITORING_DISABLED` / `RHYTHM_NUMBAT_BIN_PATH`, matching existing convention. |
| `apps/api_server/src/__tests__/numbat_observability_service.test.ts` (new) | Unit: disabled-flag skip, binary-not-found skip, exact argv assembled (no `--enforce`/`--output http`/`--content full`), idempotent re-invocation doesn't throw. |
| `apps/api_server/src/__tests__/numbat_observability_live_e2e.test.ts` (new) | `RHYTHM_LIVE_E2E=1`-gated: real sandbox api_server startup + a real OpenCode session/tool-call, then assert the generated `~/.config/opencode/plugins/numbat.ts` exists with the expected `EXTRA_ARGS`, and the configured NDJSON output file gained bounded-preview records. Skips (not fails) when no `numbat` binary is resolvable on the runner. |
| `docs/testing/manual-smoke.md` | Add the manual verification step (below). |
| `docs/ai/testing-guide.md` | Document the disable flag, install command, default log location for local dev. |
| `apps/api_server/.env.production.example` | Document `RHYTHM_NUMBAT_MONITORING_DISABLED` (default unset/off) and `RHYTHM_NUMBAT_BIN_PATH` (optional override). |

No changes to `opencode_plugin_config.ts`, `opencode_plugin_identity.ts`,
`RHYTHM_MANAGED_PLUGIN_NAMES`, or any vendored `opencode_plugins/` directory —
confirmed unnecessary by the wiring-mechanism finding in the decision doc.

## Issue table

| Issue | Likely files | Acceptance criteria | Dependencies | Required validation |
|---|---|---|---|---|
| Wire observe-only Numbat OpenCode monitoring into api_server startup | `numbat_observability_service.ts` (new), `server.ts`, `env.ts`, `numbat_observability_service.test.ts` (new), `numbat_observability_live_e2e.test.ts` (new), `manual-smoke.md`, `testing-guide.md`, `.env.production.example` | See full acceptance criteria in the issue draft returned to AJ (installation verified live; local-only/no-telemetry config confirmed; enforcement confirmed absent; sample-session capture verified; no collision with #1069 confirmed). | None — additive, no schema/migration, no other in-flight issue touches these files. | `cd apps/api_server && npx vitest run src/__tests__/numbat_observability_service.test.ts && node_modules/.bin/tsc --noEmit`; live: `tools/dev/sandbox.sh up` → `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/numbat_observability_live_e2e.test.ts` → `tools/dev/sandbox.sh down`; manual smoke per `manual-smoke.md`. |

Single disjoint-ownership issue — no parallel slicing needed (one new
service file + one startup call site + tests + docs, nothing another
in-flight branch touches).

## Dependencies

None blocking. Purely additive; no migration, no schema change, no shared
file touched by PR #1383 or the Live Artifacts work.

## Open questions

- Should Rhythm auto-download the `numbat` binary in a later iteration if the
  manual-install fallback proves to rot in practice? Deferred — not this
  issue (see decision doc, Alternative 3).
- Exact `--emit` mode (`all` vs `events`) is a judgment call favoring richer
  visibility over the CLI's own `findings`-only default; flag for AJ's sign-off
  in issue review if a narrower mode is preferred.
