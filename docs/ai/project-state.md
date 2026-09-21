# Rhythm — Project State

Updated 2026-09-21. Focus: mega-branch desktop/mobile runtime repairs and qualification, now consolidated onto a single branch and a single PR.

- Branch `mega/2026-09-18-mobile-electron-hermes`, draft [PR1544](https://github.com/ajhochy/Rhythm/pull/1544); Hermes fork draft [PR17](https://github.com/ajhochy/hermes-rhythm-plugin/pull/17), pinned `8ea642dbb6a8b8d65868c3e7a468c471914f037b`. No merge/deployment/release publication.
- Developer ID candidate open at `/Users/ajhochhalter/Applications/Rhythm Mega Desktop Candidate.app` (PID95306), preserving the existing login/approval identity. It starts/reuses API and engine; owned-child relay configuration now restores the saved session to its validated production origin. No OAuth/account changes or auth-transition service restart.
- Public relay is online and matches the local gateway identity/fingerprint; live correlation test1/1. Actual phone, driven through iPhone Mirroring, loads current branch JavaScript, connects through Rhythm Cloud Gateway, creates a synthetic chat, receives a reply and survives background/reopen. Exact synthetic chat deleted. Tools safe-area and overflow controls visibly exercised.
- Phone uses an existing signed development client. Xcode26.5 compiler probes stall before compilation; fresh native build and TestFlight remain blocked. Mirroring intermittently disconnects during scrolling. Working-sound off persistence was observed; audible behavior and final restored-toggle read-back remain incomplete.
- Local suites: engine396pass/5skip/1todo; mobile71pass/1skip; Electron168/168; borrowed Hermes1/1; current signed Desktop read checks2/2; final web parser/layout fixtures17/17. Relevant typechecks passed. Final `ai-workflow checks --level pr` passed all 16 stages, zero failures.
- Hosted native suite remains incomplete: last full run7pass/3skip/2fail; final focused run Automationspassed/Facilitiesfailed. Facilities POST creates the marked room but its row can remain absent; cleanup succeeds. Messages write-cycle needs the deployed DELETE route. [Facilities UI follow-up1545](https://github.com/ajhochy/Rhythm/issues/1545) filed at AJ's request.
- Final six-collection hosted audit found zero campaign markers at2026-09-20T02:33:21Z. This is not database-global absence. Nine-step native visual acceptance, matched comfort, separate plugin M3/ACP, physical audio, current notarization/icon matrix, NAS/off-LAN and complete signed-device release acceptance remain open.
- Evidence and exact commands: [device/relay run](runs/2026-09-19-connected-phone-relay.md), [plan](plans/2026-09-19-device-and-remaining-repairs.md), [engine readiness](runs/2026-09-19-engine-cancellation-readiness.md). Previous incomplete C5/mobile/engine findings are superseded only by their explicit new receipts.

- 2026-09-21 branch consolidation: every outstanding work branch was folded into
  `mega/2026-09-18-mobile-electron-hermes`, leaving `main` plus that one branch and
  draft [PR1544](https://github.com/ajhochy/Rhythm/pull/1544) as the only open PR.
  PRs #1508, #1548 and #1539 were closed into it. `fix/agent-server-health-flap`
  and `fix/agent-schedule-infra-preflight` had already been cherry-picked onto mega
  (`481f5549`, `052b2520`), and `mega/fix-web-round7` was fully superseded by later
  mega web commits — those three contributed no product code. The net addition is
  Colony planning docs, the shared-UI plan, the AGENTS.md sandbox-fixture section
  (in its later rescued revision) and the PR-#1508 records. Details:
  [run log](runs/2026-09-21-branch-consolidation.md).
