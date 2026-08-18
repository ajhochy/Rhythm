# Merge Runway — smoke checklist for open PRs

What each open PR still needs before it's safe to merge, ordered by how close each is to
merge-ready. Pulled from each PR's own test plan / outstanding-work notes, not guessed.

## Update 2026-08-17 — #1399 and #1400 merged

Both merged to `main` this session (`#1399` at `e1012043`-ish tip, `#1400` immediately after,
retargeted from `codex/react-electron-live-suite` to `main` once that branch landed).

Real bugs found during the click-through and filed as follow-ups (all still open, not blocking):
- #1407 — advanced-session branch selector doesn't sync to a manually-edited custom cwd
- #1408 — Changes panel "This session" scope never renders a diff (missing `patch`/before-after)
- #1409 — Terminal panel gives no visual indication it's fixture-only
- #1410 — Files viewer Copy button fakes success, never touches the clipboard
- #1411 — Agent Settings tool never built out for Live mode (+ mobile-access-should-be-embedded-here addendum)
- #1413 — Skills tab is 100% fixture-only despite claiming to be live
- #1414 — Profiles panel renders real icon asset paths as inline text, breaking layout
- #1415 — Gallery never renders real thumbnails for any artifact type

Fixed and closed directly as part of getting CI green (not left as follow-ups):
- #1405 — verify-all.mjs re-run + parity matrix regen + SHA256SUMS/PROVENANCE reconciliation
- #1416 — POST /agent-configs dropped sortOrder (real CI-blocking regression, fixed)
- #1417 — hard-delete reported false success on failed engine worktree cleanup (real CI-blocking regression, fixed)

Also landed: `@ajhochy/rhythm-mcp-server@0.6.2` published to npm (was stuck on published `0.6.1`,
which predated `rhythm_create_live_artifact` — blocked all live-artifact testing everywhere, not
just this branch), and PR #1412 adds npm Trusted Publishing (OIDC) so future publishes don't need
a token or 2FA device.

## Merge order matters

- `#1400` is based on `#1399`'s branch (`codex/react-electron-live-suite`), not `main` — it
  cannot merge before or without #1399.
- `#1387` and `#1406` touch the same relay feature — reconcile which one is authoritative
  before merging either.
- `#1398` isn't in this round at all — its own PR body gates merge on finishing W4–W7.

---

## #1400 — Sign & notarize the packaged Electron app — MERGED
`codex/post-m1-phase-11-signing` → `main`

- [x] Launch the signed `dist/Rhythm.app` locally — confirm no Gatekeeper prompt (confirmed:
      launched with a quarantine flag set, no Gatekeeper block, `spctl` accepted)
- [x] `xcrun stapler validate` on a machine that has never seen this binary — confirmed on
      `videobroadcast@Videos-Mac-Studio.local` (100.93.163.127), a genuinely clean Mac
- [x] Notarization credentials were originally scoped to an App Store Connect API key
      (`APPLE_NOTARY_KEY_*`) that was never actually a configured repo secret; switched
      `sign-and-notarize-mac.mjs` + `electron_release.yml` to the same Apple ID +
      app-specific-password credentials the Flutter release already uses (both secrets already
      present). CI dispatch of `electron_release.yml` itself was not exercised (would publish a
      real GitHub Release) — left for AJ to trigger deliberately, same as the Flutter release.

---

## #1399 — React/Electron live parity, Phases 1–10 — MERGED
`codex/react-electron-live-suite` → `main`

- [x] Re-run `node tools/validation/verify-all.mjs` — green except the pre-existing
      `web:live-lifecycle` env flake (#1407)
- [x] Reconcile `apps/web/SHA256SUMS` and `PROVENANCE.md` — 144/144 verify
- [x] Regenerate the parity matrix against current `main` Flutter
- [x] Click through Phase 5 — permission & question cards
- [x] Click through Phase 6 — MCP / skill / command catalogs (found Skills is fixture-only, #1413;
      Profiles icon rendering broken, #1414)
- [x] Click through Phase 7 — live files, diffs, worktrees (found Changes-panel diff gap #1408,
      fake Copy button #1410; approval decision card review deferred — gated behind the same
      Keychain capability as Review Queue, untestable from a bare browser session)
- [x] Click through Phase 8 — live artifacts sharing + HTML import (blocked initially on a stale
      published `rhythm-mcp-server@0.6.1`; published `0.6.2` to unblock, see update note above)
- [x] Click through Phase 9 — mobile pairing (real live page, but zero nav links to it anywhere —
      folded into #1411 per AJ's direction: should be a section of Agent Settings, not its own page)
- [x] Click through Phase 10 — research, cookbook, playbooks, gallery, report-card (found Gallery
      thumbnails missing, #1415; Research Projects/Review Queue 503s were environment flags/gates,
      not bugs)
- [x] Confirm the Electron-spawned local agent server starts and stops cleanly across app
      launch/quit — covered by the #1400 Gatekeeper-launch test

**Expected during this smoke:** only the local agent server is wired up. Real
tasks/rhythms/projects/messages/facilities won't populate from production yet — that's a
separate, not-yet-started fix. Empty data here isn't a new bug.

---

## #1383 — Mobile smart-client rebuild: RN transport
`mobile/smart-client-rebuild` → `main`

- [ ] Rebase onto current `main` and resolve conflicts (5 ahead / 7 behind at last check)
- [ ] Re-run the automated suite post-rebase — jest 61/61, playwright 71/71, `contract:check`,
      paired-host (23), msp-002 (9/9), api_server `mobile_gateway_surface` +
      `issue_1169_mobile_opencode_proxy` + `session_binding_cleanup`
- [ ] Device smoke: create a *new* chat on a physical phone and confirm it reaches "Start a new
      task" — not a missing-session flash (the #1364 regression this PR restores)

---

## #1387 — Synology relay for mobile
`mobile/synology-relay` → `main`

### Before smoke
- [ ] Rebase onto current `main` (29 commits behind at last check), resolve conflicts, re-run
      the full suite
- [ ] Deploy: `docker compose up -d rhythm-relay` on the NAS; add the Cloudflare Zero Trust
      `/relay*` routing rule above the catch-all
- [ ] Set on the Mac desktop: `RHYTHM_RELAY_URLS`, `RHYTHM_RELAY_BEARER`,
      `RHYTHM_RELAY_PUBLIC_URL`

### Device smoke — LTE, Tailscale off on the phone
- [ ] `/relay/mobile-gateway/health` green on the phone; pairing fingerprint stays compatible
- [ ] Existing pairing adopts the relay URL from health — no re-pair
- [ ] Browse session list + full transcripts with the Mac asleep
- [ ] Live stream during a real turn arrives continuously, under 2s lag through Cloudflare
- [ ] Send a prompt and approve a permission through the relay (Mac awake)
- [ ] Sleep the Mac mid-session — calm offline banner, composer disabled, reads keep working
- [ ] Generate an image, sleep the Mac, open the artifact from the relay
- [ ] Terminal falls back to the direct `.ts.net` path (relay returns 501 for PTY on purpose)

**Check against #1406 before calling this done** — it may be continuation work on this same
relay feature, not a separate concern.

---

## #1406 — Terminal-relay / PTY-uplink continuation (draft)
`codex/terminal-relay-pty-uplink-continuation` → `main`

Recovered work, not newly verified. Its own smoke log already recorded two real failures —
treat every item below as investigation, not confirmation.

- [ ] Decide this branch's relationship to #1387 first — continuation, or already superseded?
- [ ] Root-cause the Pairing FAIL: Agents unusable right after relay adoption — 0 chats, New
      Chat disabled
- [ ] Root-cause the Offline-reads FAIL: session list failed even with the Mac awake
- [ ] Re-run the remaining checks left Pending in the recovered log: live-stream latency,
      write/permission tunnel, offline-UX banner, artifact-while-asleep, Terminal PTY 501
      fallback

---

## #1398 — Self-improvement engine foundation (draft, not a candidate this round)
`self-improvement-engine-foundation` → `main`

W1–W3 landed and passed seven independent review rounds. The PR's own body gates push/merge
on W7 — there's nothing to smoke-test until that's true. When W4–W7 land:

- [ ] W4 — immutable outcome + append-only feedback ledger lands
- [ ] W5 — shadow-by-default policy + read-only lifecycle reconciler lands
- [ ] W6 — evidence bundles + controlled experiments land
- [ ] W7 — live sandbox gate, security scan, docs (the PR's own explicit merge gate)
- [ ] Re-run full verification (api_server 5005+, desktop_flutter 1210+) and one live-sandbox
      smoke pass
