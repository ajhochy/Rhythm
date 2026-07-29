# Project State

## Current focus

2026-07-29: iOS Rhythm Agents app icon corrected and a TestFlight-ready IPA built locally from Xcode (EAS bypassed). Stacked on top of the 2026-07-28 MEGA PR run (16 issues), which remains awaiting human review + manual smoke. Details: [runs/2026-07-29-mobile-icon-and-local-testflight-build.md](runs/2026-07-29-mobile-icon-and-local-testflight-build.md), [runs/2026-07-28-mega-pr-run.md](runs/2026-07-28-mega-pr-run.md).

## Active branch / PR

- Branch: `mega/run-2026-07-28` @ `3acd057eb` (adds `bd18fa5ec` icon + `3acd057eb` appleTeamId on top of the MEGA merge `6fe8edda9`; per-group worktrees under `.worktrees/`, git-excluded)
- PR: [#1241](https://github.com/ajhochy/Rhythm/pull/1241) (draft). **Do not merge — manual human review + smoke required.**
- PR [#1242](https://github.com/ajhochy/Rhythm/pull/1242) is stacked on #1241 and **needs a rebase** onto `3acd057eb`.

## In progress

- Nothing in flight. iOS TestFlight upload is blocked on the human steps below. All 11 MEGA implementation groups landed: scheduler (#1213 #1222 #1214), mcp-status (#1216 #1217), mcp-catalog (#1220 #1221), proposals (#1223), memory (#1218 #1215), gallery (#1208), profile-editor (#1236), mobile-access (#1239), mobile agents/model-picker/tools (#1232 #1233 #1234).

## Risks / known issues

- **No App Store Connect app record for `org.visaliacrc.rhythm.agents`** — must be created in the web UI; `POST /v1/apps` is forbidden by Apple (`apps` does not allow `CREATE`). Blocks the TestFlight upload. Both App IDs are registered (`FQ2JM72XM7`, `K98TW5Y7JG`).
- **Mobile OAuth server code is unmerged.** `GOOGLE_MOBILE_CLIENT_ID` / `googleMobileClientId` exist on `mega/run-2026-07-28` but on **0 files** on `main` and on the deployed commit `80d1552`. Mobile sign-in cannot work in production until #1241 merges and a new `:main` image deploys.
- Production `.env.production` has the mobile OAuth vars staged, but the container was **not** restarted — and a restart alone would not help (see above). Backup: `.env.production.bak.premobileoauth.1785341726`.
- `apps/mobile` `buildNumber` is hardcoded `1`; local archives do not auto-increment, so a second upload of 1.0.8 is rejected as a duplicate.
- Google sign-in cannot be smoked on the iOS simulator (SpringBoard refuses `SafariViewService` for `ASWebAuthenticationSession`); physical-device leg #1199 is load-bearing. See [decisions/2026-07-29-local-xcode-ios-release-path.md](decisions/2026-07-29-local-xcode-ios-release-path.md).
- `issue_1186_sandbox_foreground` is load-flaky on unmodified main — filed #1240.
- Desktop visual click-through deferred to human manual smoke (orchestrator cannot launch a second desktop instance while the live app owns port 4001 / real DB).
- #1214 quarantine stops future prod scheduler ticking; existing legacy prod rows need the manual operator procedure in docs/release/hosted_deployment_synology_cloudflare.md.
- iOS epics #1170–#1173/#1231 deferred (overlap with this run's corrective issues); #1209 (fork rebuild) and #1219 (design-first, post-MEM-OKF re-scope) deferred; release gates #1197–#1200 need human/hardware.

## Test status

`3acd057eb`: CI 4/4 green (Desktop, MCP Server, Mobile, Server) · `test:app-config` ✓ · `verify:production-bundle` ✓ · iOS archive + App Store export ✓, IPA verified distribution-signed with `beta-reports-active` and the production OAuth client inlined. MEGA baseline at `6fe8edda9` unchanged: api_server 3631✓/1 known-flake, build ✓ · mcp_server 108✓ + tsc ✓ · flutter 1006✓ + macos debug build ✓ · mobile static ✓ + Playwright e2e 55✓ · checks --level issue exit 0 · live e2e suites 5/5.

## Next step

Human, in order: (1) create the App Store Connect app record — iOS, bundle `org.visaliacrc.rhythm.agents`, SKU `org.visaliacrc.rhythm.agents`, globally unique name; (2) upload `/tmp/RhythmExport/RhythmAgents.ipa` via Organizer or Transporter; (3) review the draft MEGA PR + run manual desktop smoke (Settings→Mobile Access, Gallery MP4 posters, Agent Profile capability editor), merge #1241, then pull a fresh `:main` image on the NAS so the staged mobile OAuth env becomes meaningful; (4) rebase #1242; (5) run the manual operator procedure for legacy prod scheduler rows.
