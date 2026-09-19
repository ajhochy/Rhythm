---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1373, 1496, 1509, 1510, 1511, 1512, 1513, 1520, 1522, 1523, 1524, 1541, 1542, 1543]
status: partial
tags: [run, rhythm]
---

# Acceptance follow-up

## Files

- API creator-scoped thread cleanup and guarded hosted writes: `2026-09-19-hosted-write-gaps.md`.
- Packaging, signing, physical-device and deployed relay evidence: `2026-09-19-device-release-preflight.md`.
- Native evidence: `.proof/mega-2026-09-18/20-*` onward.

## Checks

- Existing installed Flutter was opened normally; its own services report HTTP 200 on API 4001 and engine 4096. No second API was started by hand.
- Existing authorized Rhythm MCP bearer, loaded only into process memory, succeeds with Node fetch and installed-host HTTPX against hosted `/auth/me`. An earlier Python urllib 403 was specific to that request path and did not establish an invalid credential.
- Global campaign-marker preflight: authenticated HTTP 200 and zero matching rows in `/tasks?status=all` (1541), `/facilities` (18), `/facilities/reservations` (310), `/project-templates` (1), `/automation-rules` (3), `/message-threads` (7). Sanitized receipt: `.proof/mega-2026-09-18/hosted-preflight-2026-09-19.json`.
- Current ad hoc package built successfully with the public desktop Google client ID from installed Flutter. Packaged API hashes match the reviewed compiled files; this is separate from Developer ID/notarization qualification.
- Native Finder and Get Info show the Rhythm waveform icon on that package: `22-electron-current-package-info.png`, `23-electron-current-package-finder.png`.
- Native candidate startup initially stalled in `SecKeychainFindGenericPassword`. Computer-control access to SecurityAgent was explicitly denied for safety. No credential was entered and no Keychain item was changed. The fresh-profile startup probe is repaired and tested. A later authenticated session still blocked at protected encrypted Keychain persistence; only the owned candidate and its owned sidecar were terminated after TERM could not interrupt the system call.
- Closing/reopening native Hermes Settings did not remove the cached Rhythm tools row after on-disk removal. Screenshots `20-hermes-cached-tools-before.png` and `21-hermes-tools-after-reopen.png` falsify the claim that UI reopening alone proves disposal.

## Decisions

1. The follow-up explicitly authorizes solving configuration and test prerequisites. Use the existing configured Rhythm MCP credential only in test process memory; never copy it into a plugin/app auth file or a UI field.
2. The unique Google desktop client ID compiled into installed Flutter is public configuration. Pass it through the candidate build environment and the documented Hermes profile key; do not invent a new OAuth client or request broader scopes.
3. Restore requested 4001/4096 services through their installed Flutter owner. Leave Flutter, Hermes and those services running. Additional backend verification uses only the canonical isolated sandbox launcher.
4. Record collection-scoped marker absence precisely. Recheck after writes and delete only rows created by this run, never unrelated campaign rows.
5. Disable credentialed Playwright traces, screenshots, video and retained output. Scan test cache/output filenames for accidental bearer persistence without printing the bearer.
6. Production lacks the new thread DELETE route. Probe cleanup capability before creation and skip that hosted write if unavailable, so no undeletable thread is created.
7. Qualification-only CI may sign/notarize and upload Actions artifacts from the branch. It must not create a release or tag, merge either draft PR, or deploy production.
8. Treat native running-host qualification separately from source tests or a profile-switch workaround. M3, ACP, unsent-draft and zero-write evidence require the real mounted workspace.
9. Do not interact with protected SecurityAgent after computer-control rejection. Investigate the unnecessary fresh-profile Keychain access in source; preserve encrypted storage and normal OS security.
10. A locked physical iPhone prevents device installation/inventory and audible validation. EAS account/project access and a public relay health response do not establish TestFlight, off-LAN, or physical audio qualification.

## Notes

Earlier evidence remains historical. Current limitations below replace the missing-client/token/services explanation; no native, hosted, signed-package or physical-device gate is promoted by inference.

## Follow-up checks and recovery

- Web required full run: typecheck/build passed; **460 passed / 47 skipped / 0 failed**. Electron slice manifest: **155 passed / 4 skipped / 0 failed**. Latest web typecheck passed. A follow-up ownership command initially named a nonexistent config path and ran no tests; corrected `npx playwright test tests/mega-smoke-ownership.spec.ts` passed **3/3**.
- Mobile typecheck/lint/contract passed; **32 suites / 133 tests** passed. Three existing lint warnings remain.
- Hosted browser smoke executed with the existing authorized bearer only in process memory: **7 passed / 22 failed / 5 skipped**, 34 total. Local `http://127.0.0.1:4175` Origin was rejected (local 403 / hosted 500, no CORS allow-origin); `rhythm://app` Origin received HTTP 200 with matching allow-origin. Do not turn these failures into passes by spoofing Origin, disabling security or proxying the requests. A guarded attach-only native harness now selects 12 applicable tests, but was not run because the native app did not complete encrypted credential storage.
- Hosted paused Automation create/read-back/delete succeeded through the API; its UI criterion failed at the same origin boundary. Messages creation skipped before any write because the deployed API lacks the cleanup route. New creator-scoped DELETE and atomic-paused rule coverage passed the real canonical sandbox **1/1**, plus focused API **14/14**. No unowned write was allowed by the browser guard.
- Credentialed traces, screenshots, videos and retained Playwright output were disabled. Scan of Vite cache, dist and test-results found **zero bearer matches**.
- Final authenticated audit at **2026-09-19T15:42:33Z** returned HTTP 200 for six collections, with **zero `MEGA-SMOKE-2026-09-18-*` markers** in each: tasks 1541, facilities 18, reservations 310, project templates 1, automations 3, threads 7. This is collection-scoped global-prefix absence, not a claim about every table or account. Receipt: `.proof/mega-2026-09-18/hosted-final-audit-2026-09-19.json`.
- The isolated Hermes candidate mounted the workspace, displayed Connect Rhythm and then safely rejected the old deployed API with `503 oauth_login_only_unavailable` **before opening a browser**. After toggling its renderer off, removing only its two scratch plugin roots and pressing Rescan, Agent plugins changed **1 → 0**, no plugin row remained, and the Rhythm sidebar disappeared in the same running candidate. Screenshots 24–28. The installed release was never quit and still needs the rebuilt host; do not transfer this proof to that older process.
- Current API health is the older `b804842a2be70b6d7b8c5fffa2ed1dabcd99bcd4`. Final relay health reports `macOnline:true`, superseding the earlier false preflight value. Neither health proves deployed image digests or a cellular/off-LAN path.

### OAuth side effect and restoration

The first minimal-scope Hermes M3 login reached the legacy deployed desktop-exchange endpoint. Although the callback failed locally on the transport's unsupported Brotli encoding, the server had already overwritten the existing Google Calendar and Gmail integration access-token/scope fields. A read-only status check showed both `needs_reauth:true`. This was a real side effect of the attempted login, not a smoke fixture result.

The attempt was stopped and disclosed. The original Electron Google flow, using the existing account/session and previously granted scope union, restored both integrations without typing credentials. At **15:35:16Z**, both were `connected` with `needsReauth:false`; the final 15:42 audit confirms that state. The sanitized `.proof/mega-2026-09-18/google-integration-recovery.json` records provider/scopes/status only. No email was sent and no calendar item was modified.

New API regressions protect existing provider rows, reject creating integration rows from identity-only tokens, and prove a separate login-only endpoint never persists integrations even if Google returns broad scopes. Both Hermes and Electron now require the additive capability before starting OAuth and exchange only through the login-only route. Electron's new flow asks only for identity scopes and does not request offline access, forced consent or previous grants. This source is not deployed; no further provider OAuth is permitted against the old endpoint for this smoke.

## Additional decisions

11. Recover the observed integration downgrade through the original already-granted consent flow; never store or paste the MCP bearer in either app. Record the incident and restored status explicitly.
12. Separate login identity from integration authorization. Preserve existing integrations in the legacy endpoint and fail closed before browser launch when the safe endpoint is unavailable. The temporary narrow-scope-only Electron edit was reverted before recovery, then correctly reintroduced together with the new capability/exchange contract.
13. Explicitly negotiate gzip/deflate in Hermes to match its bounded decoder; retain rejection of unexpected Brotli. Adapt actual hosted numeric identity fields, task-array shape and bounded dashboard projection without printing user bodies.
14. Keep credentialed browser smoke red at CORS. Native tests attach only to the owned same-worktree package/PID/userData on approved `rhythm://app`, with bearer confined to APIRequest context; no renderer injection or header impersonation.
15. Preserve full-suite failures even after isolated reruns pass. Do not loosen timing thresholds or assertions to call a flake repaired.
16. Stop only owned smoke processes and scratch sandboxes. Preserve installed Flutter/Hermes, their services, user profiles, encrypted auth and plugin backups. Remove only the scratch candidate plugin roots for disposal qualification.

### Final native rejection and disposal replay

Final Electron package: native Continue with Google reports that the server needs the safe sign-in update, before opening Google (`30-electron-login-server-update.png`). This establishes fail-closed behavior, not successful sign-in. The final Hermes host/package removes the stale disk-copy listing as well as backend registrations on Rescan: bundled Rhythm remains OFF, Agent plugins is0, sidebar absent, no restart for removal (`31-hermes-final-running-disposal.png`). The first final message replay showed a generic retry; the IPC bridge envelope regression then failed red and passed after correction. Final native Hermes replay shows the exact server-update message (`32-hermes-final-actionable-login.png`).

GitNexus follow-up change detection reported LOW for integration source (20 files/38 indexed symbols/0 flows); whole-branch comparison is MEDIUM. New unindexed fixture guards were reviewed and exercised directly. Actionlint on the qualification workflow passed. GitHub lists all required signing/client-ID secret names; no values were fetched.

### Publication and qualification preparation

Repairs were committed/pushed to Rhythm `aa07b4916709ffc1bd72502211dc0c98ef18efe1` and fork `a285b3651c0123d1b93eb522ca29fa109bc660f6`, with the requested coauthor. Both PRs remain draft. Qualification-only workflow35452996081 used numeric candidate version0.18.65 and that exact Rhythm SHA; both architectures failed before signing because `ghostty-web#main` no longer matched the frozen lock. Pinning the manifest to the already-locked immutable commit preserves dependency bytes; clean Bun1.3.13 frozen installs passed. The repair does not bypass frozen installs or publish a release.

Final cleanup verifies no listeners on9121/4198/4197/4299 and HTTP200 from protected4001/4096. Installed Hermes PID14462/backend14586 remain alive. Owned native candidates were quit; scratch plugin roots removed, backups/config retained. No smoke OAuth browser tabs remain. Source-only sign-in copy now describes workspace access without claiming calendar authorization; the qualification build includes this copy.

Dev Dashboard data-only receipt: `RUN reactElectronLiveSuite OK: rev4397 ->4398,10 runs`, status pending; counts `460/47;155/4;176/0;133/0;6185/251/1;7/22/5;6/0;296/0`. Subsequent signing CI and generated-SDK repair remain independent gates. Both draft PR bodies were updated; fork remote head05a8132fea includes the independent baseline audit.
