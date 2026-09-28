---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1373, 1509, 1510, 1520, 1541, 1542, 1543]
status: partial
tags: [run, rhythm]
---

# Final source qualification

## Files and source

Implementation source: `70bcf2c96a9a74521d4b61f009bf47aa89557436`. Later documentation-only commits record these results without changing the signed implementation. Fork source: `a285b3651c0123d1b93eb522ca29fa109bc660f6`, with evidence-only commits through `9c8dcf4230`.

The detailed [acceptance follow-up](2026-09-19-mega-acceptance-followup.md) records the OAuth incident and restoration, sandbox checks, hosted cleanup and all earlier failures. [Contract synchronization](2026-09-19-mobile-ci-contract-sync.md) records the final CI repair.

## Checks

| Exact-source check | Result |
|---|---|
| OpenCode Fork CI35454145318 | PASS: frozen install, typecheck, session tests, generated SDK currency |
| Mobile CI35454145315 | PASS overall: Playwright70 passed,1 skipped,1 flaky; known issue1174 chat-maintenance first attempt timed out, retry passed. No assertion or timeout changed. |
| Server CI35454145321 | PASS:6,185 passed/253 skipped/0 failed;660 passed/133 skipped files. Live Postgres bootstrap, supply-chain15/15, API build/smoke and optimizer safety smoke passed. |
| Qualification-only Electron35454150623 | PASS on ARM and Intel: sign/notarize, verify, signed smoke and artifact upload; publication SKIPPED in both jobs. Source70bcf2c9, version0.18.65. |
| Installed signed ARM candidate | PASS: codesign, Gatekeeper Notarized Developer ID, stapled ticket; embedded engine identifies exact source; all10 normal/Retina icon inputs match. Native Finder/Get Info PASS; Dock and Command-Tab unverified. |
| Downloaded signed Intel candidate | PASS local static checks: codesign, Gatekeeper, stapled ticket, x86_64 executable/engine, embedded source version and all10 icon inputs. Native signed smoke passed in Intel CI; no local Intel app launch or installation was performed. |

Earlier qualification35452996081 failed before signing on the floating Ghostty dependency; its pin preserves the existing locked bytes. Provisional35453307976 completed signing/notarization/signed smoke/upload for both architectures; its source predates the generated SDK/Mobile contract sync. Superseded35453685869 was cancelled after the final source was dispatched. Those outcomes do not qualify the final source.

## Remaining acceptance

- Native brief: Finder/Get Info passed on the signed installed candidate; nine authenticated steps remain blocked. The exact signed client rejects the old server before opening Google (screenshot35). The prior authenticated attempt separately blocked at protected Keychain persistence.
- Hosted browser:7 passed/22 failed/5 skipped. Disallowed browser Origin was not spoofed or proxied. Paused Automation API create/read/delete passed; Messages skipped before creating a row because the deployed cleanup endpoint is absent. New write coverage passed the isolated real API/engine sandbox.
- Global campaign-prefix absence: all six authenticated collections returned HTTP200 and zero matches at15:42:33Z. Google Calendar/Gmail were connected with needsReauth false after recovery. No hosted writes occurred after that audit.
- Hermes: mount and running disposal passed in the isolated rebuilt native host. Actual credentialed M3, hosted Dashboard/Tasks UI, ACP deny/allow/read-back, unsent draft and nonempty zero-write trace remain blocked by the undeployed login-only API. Installed older Hermes was preserved.
- Matched light/dark subjective acceptance, physical audio, signed iOS device/TestFlight matrix, NAS image digests and off-LAN phone checks remain open. EAS could not schedule a development build because internal-distribution credentials were unavailable; no buildID. The paired iPhone was locked. Public relay reports Mac online, but this does not qualify the phone path.

## Decisions

1. Pin qualification to the final implementation SHA and record artifact hashes. Keep later receipt-only commits distinct; never substitute an older successful artifact.
2. Sign and upload qualification artifacts only. Keep both PRs draft; no merge, release/tag publication, production image publication or deployment.
3. Verify the signed bundle locally before opening it. Use a separate candidate install and scratch profile with non-owning interactive smoke; preserve installed Flutter/Hermes and their API4001/engine4096 services.
4. Preserve the original Finder/Dock/Command-Tab/Get Info and normal/Retina criteria. Record unsupported native inspection as unverified rather than inferring it from icon resources.
5. Keep the safe OAuth boundary and existing protected credential storage. No browser/renderer token injection, protected Keychain bypass or legacy hosted exchange retry.
6. Keep CI flakes, baseline fork failures, browser CORS failures and deployment/device gates explicit. Do not weaken behavior assertions to make the record green.
7. Do not guess NAS connection details: the runbook has a placeholder and this environment has no configured SSH alias or NAS inspection connector. Public health is a readiness observation only.

## Cleanup and publication

Signed ARM artifactID10587539461, archive SHA256`d2a303e834745cd099391ef5d3d8e4872bb3d0fd7a49dd8bdc4af41967998f93`,206,017,176 bytes. The Actions outer-artifact digest is separately recorded in `.proof/mega-2026-09-18/signed-arm64-verification.json`; it is not the nested signed archive hash.

Signed Intel artifactID10587743120, archive SHA256`336c9f80444918d5372e3d65967dec94f2df58b8728aef8959a10e37d43f8d5e`,215,918,582 bytes. Local static trust/source/icon checks passed; the owned extraction/download was removed without installing or launching it. Receipt:`.proof/mega-2026-09-18/signed-x64-verification.json`. Both final CI jobs succeeded and both release steps skipped, captured in `final-signing-ci.json`.

Candidate installed at `/Users/ajhochhalter/Applications/Rhythm Electron Qualification.app`, leaving the shipping Flutter path untouched. Launched with a fresh scratch profile, `--interactive-smoke --allow-test-runtime-ports`, existing4001/4096 URLs and Hermes disabled for this icon-only replay. No second API or Hermes process was started. Native safe-login rejection passed; candidate quit through its own window. Signature remained valid after launch. No auth-session file was created. Protected4001/4096 returned HTTP200, installed Hermes/backend stayed alive, and9121/4198/4197/4299 were free. The signed candidate is retained, stopped, for review; only owned download/extraction/profile copies are removed. Screenshots33–35 and `signed-candidate-launch.json` record these checks.

The four unrelated fork dashboard-dist deletions remain untouched. Both PRs remain open drafts. The manual-smoke postmortem includes signed package success and the two unverified icon surfaces; earlier failures are retained.

Final staged GitNexus change detection reported13 text files/11 documentation symbols/zero affected processes/LOW risk. Git listed16 files including the three new screenshots; all changes are evidence/documentation. `git diff --cached --check` passed. No implementation changed after the signed source commit.

Dev Dashboard publication through the required script succeeded: `RUN reactElectronLiveSuite OK: rev4398 ->4399,10 runs`. Status remains `pending` because acceptance gates are still open. Data-only note:`1/0/9;7/22/5;2/0/5;6185/253/0;460/47/0;176/0;133/0;296/0;2/0/2;2/0` (native; hosted; Hermes repair/remaining groups; API; web; Electron; Mobile unit; fork scoped; icon surfaces; signed architecture jobs). This is a manual tracker receipt, not automatic lifecycle-hook proof.
