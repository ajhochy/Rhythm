# Project State

## Current focus

Finish PR #1165 after the local desktop/mobile smoke and pairing compatibility
repair. Every local gate for the repair is green; the remaining work is the
explicit human release chain.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Verified repair commit: `40843e308`

## In progress

- The repair and smoke evidence are pushed. Mobile CI passed against exact
  head `40843e308`.
- #1197 remains the independent exact-head review gate.
- #1198 remains the signed EAS development build gate.
- #1199 remains the authenticated physical-device and isolated-Mac matrix.
- #1200 remains the production EAS/TestFlight provenance and install smoke.
- Dependency order remains #1197 → #1198 → #1199 → #1200; #1175 owns the
  umbrella checklist.

## Risks / known issues

- The compatibility repair changes product contract data, so any prior
  exact-head release evidence must be rerun against the new commit.
- The physical-device run must use an isolated branch-built API/engine and
  private Tailscale Serve gateway. It must not fall back to production staff
  data or expose the OpenCode engine directly.
- Credentials, signing assets, build artifacts, pairing/device tokens, private
  hostnames, and iPhone UDIDs must never be committed or printed.
- The development Google iOS client is stored outside the repository with
  owner-only access and must be supplied through secure build and isolated-API
  configuration. The production bundle still needs its own client at #1200.
- Local Xcode/simulator evidence does not replace #1198 or #1200 EAS/TestFlight
  provenance.
- #1186 tracks a non-blocking automation improvement for a foreground sandbox
  lifecycle; the corrected final source smoke passed without a product change.
- #1135's additive SQLite/Postgres change requires normal migration review.
- GitNexus compare-to-main is CRITICAL (677 files, 3,540 symbols, 21 flows)
  because this cumulative branch intentionally includes the roadmap and linked
  issues. The current working diff is LOW (8 indexed files, 5 symbols, 0
  affected flows).
- Do not merge before the human gates above are complete.

## Test status

- Desktop live-local visual smoke passed Dashboard, Tasks, Projects, Agents,
  transcript, Settings, Agent Server, and pre-code Mobile Access surfaces.
- Native iOS simulator smoke passed launch, the Agents/Tools/Settings shell,
  signed-out pairing guidance, light/dark appearance, and
  accessibility-large text.
- The cross-package pairing contract failed before the repair and passed 1/1
  afterward; pairing service tests passed 10/10.
- `ai-workflow checks --level issue` and `ai-workflow checks --level pr`
  passed after the repair.
- A fresh isolated API `4598` / engine `4597` / gateway `4599` run passed the
  live shipping-fingerprint assertion 1/1 and all health probes; the sandbox
  was removed.
- Changed-file credential/private-host scan and `git diff --check` passed.
- GitHub Mobile CI run `30320059544` passed against exact head `40843e308`.
- Full commands and repair-loop details are recorded in
  `docs/ai/runs/2026-07-27-live-desktop-mobile-smoke-handoff.md`.

## Next step

Keep PR #1165 draft. Rerun #1197 against exact head `40843e308`, then hand
#1198–#1200 to AJ for the required secure EAS, physical-device, and TestFlight
actions.
