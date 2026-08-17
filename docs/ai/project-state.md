# Rhythm — Project State

## Current focus

React/Electron parity program: bringing `apps/web` + `apps/electron` up to the shipping Flutter
desktop app's real, live capabilities (not just a fixture-mode prototype). Milestone 1 (9/9 slices)
shipped earlier. The post-M1, 11-phase capability build (PRs #1399, #1400) is now merged to `main`.
Remaining work is a punch list of real, non-blocking gaps found during manual click-through smoke
testing, tracked as individual follow-up issues below.

## Active branch / PR

- `main` — no PR currently open for this program. #1399 (Phases 1-10) and #1400 (Phase 11
  signing/notarization) both merged 2026-08-17.
- `@ajhochy/rhythm-mcp-server@0.6.2` published to npm (was stuck on published `0.6.1`, which
  predated `rhythm_create_live_artifact` and silently blocked all live-artifact testing).
- PR #1412 (`ci/mcp-server-trusted-publish` → `main`) open: adds npm Trusted Publishing (OIDC) for
  `rhythm-mcp-server` so future publishes don't need a stored token or a 2FA device on hand.
  Needs the npmjs.com Trusted Publisher link configured (org `ajhochy`, repo `Rhythm`, workflow
  `publish-mcp-server.yml`) before it's usable — not yet done.

## In progress / recently landed

- All 11 phases (1-10 live parity + 11 signing) are merged. `apps/electron` spawns and owns its
  own local `api_server`, signed and notarized, confirmed via a real Gatekeeper launch test and an
  offline `stapler validate` on a genuinely clean second Mac.
- Two real CI-blocking regressions found and fixed during the merge (not left as follow-ups):
  `POST /agent-configs` dropping `sortOrder` on create, and hard-delete reporting false success
  when engine worktree cleanup actually failed. Full `apps/api_server` suite (552 files / 4474
  tests) green after both fixes.

## Known follow-up issues (all open, none blocking)

- #1401 — native Electron notification presentation not implemented (pre-existing, unrelated)
- #1402 — `apps/electron` doesn't bundle `api_server` into a packaged `.app` yet (dev-spawn only)
- #1403 — dispatch `.github/workflows/electron_release.yml` for real, verify end-to-end
- #1404 — confirm the Developer ID signing identity PR #1400 picked (of 3 candidates in the keychain)
- #1407 — advanced-session branch selector doesn't sync to a manually-edited custom cwd
- #1408 — Changes panel "This session" scope never renders a diff (`sessionDiff` has no `patch`
  field to render; needs a before/after or client-computed-diff path instead)
- #1409 — Terminal panel gives no visual indication it's fixture-only (Terminal/PTY itself is a
  documented, deliberate waiver — this is just about the missing "fixture" cue)
- #1410 — Files viewer Copy button fakes success, never touches the clipboard
- #1411 — Agent Settings tool never built out for Live mode; also the intended home for a Mobile
  Access section (currently an orphaned, unlinked `/mobile-access` page — AJ wants it folded in,
  not standalone)
- #1413 — Skills tab is 100% fixture-only despite claiming "Search live engine skills" in its own
  UI copy
- #1414 — Profiles panel renders real `icon` asset paths (`assets/agents/opencode.png`) as inline
  text, breaking the layout — the UI was built assuming a short 2-3 char label
- #1415 — Gallery never renders real thumbnails for any artifact type (icon placeholder only)

## Structural notes (not gaps — how the system is meant to work)

- `gateway/sessions.ts`'s `dispatchMcp()` is an honest, real-but-rejecting method: the opencode
  engine has no primitive to execute one MCP tool for a session outside a model-originated MCP App
  interactive binding.
- Mobile pairing, Review Queue, and (in a bare dev-server test session) Research Projects all sit
  behind real, working gates that a plain browser session can never satisfy: `requireDesktopHumanCapability`
  (a Keychain-backed capability header only the signed desktop app can present) and the
  `RHYTHM_RESEARCH_PROJECTS_ENABLED` feature flag. 503s/"not found" from these in a bare-browser
  smoke test are expected, not bugs — they only really validate inside the packaged, signed app.
- Playbooks intentionally mixes skill-sourced and true command entries in one list (documented in
  `opencode_commands_routes.ts`'s own header comment) — this is not the same bug as #1413's fixture
  Skills tab, even though it looks similar at a glance.

## Test status

- `apps/web` full suite (`verify-all.mjs`): all components green except `web:live-lifecycle`, which
  fails only when run from a git worktree whose `main`-equivalent branch is already checked out
  elsewhere on the same machine (a real git constraint, not a code bug — see #1407's root cause
  writeup). Passes on a normal single-checkout machine / CI.
- `apps/api_server` full suite: 552 test files / 4474 tests passing, 0 failures (after the
  sortOrder + hard-delete fixes above).
- `apps/electron`: `slice-7-c1`-`c6` (packaged, signed+notarized bundle) all green.
- Desktop parity matrix regenerated against current `origin/main` Flutter tip, validator 0 errors.
- `apps/web/SHA256SUMS`/`PROVENANCE.md` reconciled, 144/144 verify.

## Next step

1. Configure the npm Trusted Publisher link (see PR #1412) so future `rhythm-mcp-server` publishes
   don't need manual token/2FA handling.
2. Pick off the follow-up issues above as separate, ordinary bugfix work — none are blocking, and
   there's no single "next" one; they're independent UI/gateway gaps in different tools.
3. AJ: confirm the Developer ID signing identity (#1404) and dispatch `electron_release.yml` for a
   real end-to-end CI proof (#1403) when ready to cut an actual Electron release.
