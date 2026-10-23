---
date: 2026-10-22
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: null
issues: []
status: local-acceptance-passed-private-https-verified-on-host
tags: [run, rhythm, web, tailscale, parity]
---

# Final local browser acceptance

## Result and provenance

The local browser acceptance bar passed: **93 PASS, 25 EXCLUDED, 0 FAIL, 0 unrun required rows**. The signed candidate is running at **http://localhost:4001/#/tasks**, with real cloud access, reload, and an observed WebSocket 101 handshake. The dedicated real-account suite passed **4/4**; all three newly created, nonce-marked records were deleted and deletion readbacks verified. No existing account configuration was edited. The separately approved private HTTPS cutover is now active at **https://ajs-macbook-pro-3.tail3798ec.ts.net:4001/#/tasks**. Chromium render/reload, cloud access and secure WebSocket101 passed through that actual URL on the hosting Mac; a second device has not been tested.

Code/build revision: `89596fc186fa2662da66e0ba2f19413cbf6559c7`. This report is committed separately after the build; a later documentation-only HEAD does not change the candidate's code identity. Worktree: `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/eager-star`. Branch: `feat/tailscale-web-app-20261022`. All commits remain local; no push, PR, merge, install, deployment, LaunchAgent, or network configuration change.

Candidate: `apps/electron/dist/Rhythm.app`, version 0.18.83, Developer ID signed, deep/strict signature verification exit 0; **not notarized**. API PID 58946 owns loopback 4001; engine PID 58995 owns 4096 and reports `0.0.0-rhythm-89596fc186fa2662da66e0ba2f19413cbf6559c7`. Desktop PID 58940 at original acceptance; after approved restart the current PIDs are desktop64828/API64835/engine64887. Executables reside inside this candidate. Seven packaged source/build files and served browser asset hashes match the final build. Port 4002 has no listener: mobile gateway is disabled during this web-mode session, as disclosed before launch.

Durable public evidence: [final receipt](../../testing/results/2026-10-22-web-parity-final.json). Per-row evidence and all prior failed attempts remain in [the inventory](../contracts/web-parity-20261022.json). Scope approvals: [recorded decision](../decisions/2026-10-22-web-parity-resume-scope.md). Diagnosis, exact earlier checks, and repair history: [continuation](2026-10-22-web-parity-continued.md). No credential contents, private snapshots, raw real-account logs, or browser captures are included in these committed receipts.

## Changes

Added browser adapters for approvals, Coordinator/shared catalogs, tool pins, absent-task handling, and profile drafts. Approval checks retain owner, revision, hash, expiry, nonce, and audit receipt validation. Fixed shared automatic-title orchestration by finishing the ordinary answer/tool loop before naming while its runner remains active; guard admission protections remain intact. Fixed HTTP Coordinator command UUID generation using `getRandomValues`.

Qualification repairs cover the production model registry, canonical fixture profile path, browser cache/watchdog, response metadata and two sandbox path expectations. Copied read-only skills now become owner-writable only inside the sandbox without following links or changing source fixtures; the actual copier has a RED/GREEN regression. No existing live profiles/providers/settings/schedules/MCP configuration were patched.

## Commands and observed output

Commands below ran from the feature worktree unless a receipt records an explicit cwd. Builds used the unchanged shared 10 GiB guard. Sandboxes used canonical setup/down and isolated fixtures; no api_server was started manually. Public JSON includes exact underlying argv/env for both final partitions and real-account execution.

| Command / receipt | Observed result |
| --- | --- |
| `python3 -I /private/tmp/rhythm-web-postpaid-partition-driver.py standard` | CLI 0; security 8/8; Playwright 95 passed, 10 cloud-gated skips, 0 unexpected/flaky; 364457.735 ms. Canonical teardown/port audit 0. |
| `python3 -I /private/tmp/rhythm-web-postpaid-partition-driver.py cloud` | CLI 0; fresh cloud fixture, Playwright 10/10, 0 skips/unexpected/flaky; canonical teardown/port audit 0. |
| Reconcile title+file against `/private/tmp/rhythm-web-postpaid-synthetic-matrix-20261022.json` | Exactly one passing result for every one of 85 nonpaid included rows. 105 aggregate Playwright passes include 20 supporting checks; this is not 105 matrix rows. |
| `bash /private/tmp/rhythm-web-89596fc186-final-build-sign.sh` | CLI 0; final API/engine/package and web build, sign-only; `codesign --verify --deep --strict apps/electron/dist/Rhythm.app` exit 0. Logs `/private/tmp/rhythm-web-89596fc186-final-{build,web-build,sign}.log`. |
| `python3 -I /private/tmp/rhythm-web-final-candidate-ready.py` | CLI 0; exact bundled API/engine identity and owning PIDs, owner 1/cloud ready, browser asset hashes match, mobile gateway absent. Rechecked after all real-account tests. |
| `python3 -I /private/tmp/rhythm-web-run-real-account.py` | CLI 0; 4 passed, 0 skipped/unexpected/flaky; one attempt each; 13218.503 ms. Underlying `./apps/web/node_modules/.bin/playwright test --config apps/web/tests/web-real-account/playwright.config.ts --reporter=json --output /private/tmp/rhythm-web-final-real-report-wx_78edn/output`. |
| Final owned-record ledger and deletion readbacks | Three creates / three verified deletions / zero leftovers / zero pending creates / zero blocked writes. Cookbook never executed; private task had no workspace/collaborators; private artifact used normal deletion/tombstone semantics, not physical purge. |
| `node /private/tmp/rhythm-web-localhost-readonly-proof.mjs` | CLI 0; Chromium Tasks render+reload at localhost:4001, cloud ready, native bridge absent, WebSocket handshake 101, 0 HTTP mutations, 0 page errors. |
| `npm run build:guard -- npm --prefix apps/api_server test -- --fileParallelism=false` | CLI 1: 9185 passed / 7 failed / 401 skipped, 9593 tests. All seven failures reproduced on clean starting 6081 source archive; comparison `/private/tmp/rhythm-web-api-head-baseline-4kcdz688/receipt/comparison.json`. |
| `python3 tools/build/guard.py --repo <worktree> --watch /private/tmp/rhythm-electron-final-20261022-syxbcd0y -- npm --prefix apps/electron test` | CLI 0: 591 passed / 0 failed / 5 skipped; 596 tests. Earlier working-source run recorded HEAD6081; this is not relabeled as an exact895 run. |
| Desktop gateway Playwright specs plus browser-approvals and invalid-live configs, exact argv in `/private/tmp/rhythm-final-gateway-20261022-1aq00rni/receipt.json` | 28+1+1 passed, no skip/flaky, CLI 0 each. Focused gateway/pins unit checks 18/18, CLI 0 after correcting invocation paths; initial invocation failure preserved. Earlier working-source HEAD6081 provenance retained. |

### Paid and policy evidence

All accepted paid/policy receipts have actual CLI 0, one attempt, unchanged working source, canonical down and secret scrubbing verified. The final public receipt retains each exact source revision **and working-source hash**; earlier checks are not falsely relabeled as runs at final HEAD. Later fixes were committed as recorded in the continuation. Final nonpaid partitions, policy #91, Grid #92, signed package, real-account 4, and localhost proof use exact895 source.

| Row | Receipt directory under /private/tmp | Duration | Evidence |
| --- | --- | ---: | --- |
| 91 | rhythm-web-paid-case-91-UtAhnR | 1482 ms | Saved Grid/Luna/consent policy; no inference. |
| 92 | rhythm-web-paid-case-92-IIeQtB | 8188 ms | Actual eligible cheap route/account/effort, exact answer, reload/reuse. |
| 93 | rhythm-web-paid-case-93-XaiJTB | 5826 ms | Original Grid router assertion, real paid turn. |
| 94 | rhythm-web-paid-case-94-9Qsf3u | 5735 ms | Original Grid router assertion, real paid turn. |
| 108 | rhythm-web-paid-case-108-KRHg7v | 5605 ms | Real Coordinator behavior through browser/HTTP. |
| 109 | rhythm-web-paid-case-109-R6j410 | 28963 ms | Four actual fixed-Luna turns: inherited/selected allow, selected/empty deny, canonical mcp_dispatch tool provenance, strict owned cleanup. |
| 110 | rhythm-web-paid-case-110-PZun4F | 54402 ms | Two real Coordinator goal children overlap; separate one-commit worktrees, 15 verification checks each, known usage and one marked report each; cleanup verified. |
| 118 | rhythm-web-paid-case-118-nuHFSi | 63866 ms | Pinned private owner snapshot, selected secretary semantics/history/skills, code-owned Reviewer control, bounded actual closed-known-usage scan and candidate/proposal boundary. No improvement claim. |

The eight scripted loopback-provider rows prove UI/transport only. They do not prove paid-model quality. Full matrix proof counts are recorded in JSON (77 no-model, eight scripted, seven paid isolated, one saved-policy/no-turn).

## Limits and preserved state

This is a scoped browser acceptance pass, **not a universally green repository**. Seven aggregate API failures match the starting revision: two Reviewer budget/prompt expectations, three seed permission expectations, one SQL text expectation, and one inherited projection-boundary architectural defect. The projection issue is not dismissed as merely a stale assertion. Electron typecheck retains known TS7053 at `hermes-backend-artifact.mjs:58` (exit 2). These are outside the requested repairs and remain documented. Five optional Electron skips and four optional engine-artifact skips are not counted as executed behavior. MCP's canonical build uses `--noCheck`, so its successful build does not prove full strict typecheck. API lint is a placeholder. Generic `ai-workflow checks issue/pr` was not executed: the scoped required commands ran; unrelated Flutter/mobile checks and the older desktop-page bootstrap suite are not claimed passing. New sandbox copier regression passed locally but is not claimed CI-enforced.

The source/build/package are separate evidence from installation/notarization and external access. The current app is launched manually; persistence after reboot is not configured. No user-facing login/pairing/enrollment layer was added. The real exported cloud credential was inspected only for file metadata (regular/single link, owned UID, 0600; parent0700); contents were never read/logged/copied. The application itself used the credential normally.

Preserved fallback: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app`, source `53a2c94b8ec4fb9d10d43df9fc57c9c6d9b5e0d3`, with its worktree. Real SQLite backup remains under the existing app-data `backups/tailscale-web-20261022T215323Z/rhythm.db` (0600, parent0700, immutable quick_check OK before candidate launch). No destructive cleanup or manual live-DB edits.

## Separate cutover proposal — pre-approval checkpoint (subsequently completed)

Read-only Tailscale status showed Running, DNS `ajs-macbook-pro-3.tail3798ec.ts.net`, existing raw TCP4001 forwarding to loopback4001, and separate existing services443/8443. Proposed private URL: **https://ajs-macbook-pro-3.tail3798ec.ts.net:4001**. Replace only the raw TCP4001 mapping with private HTTPS4001 to `http://127.0.0.1:4001`; preserve443/8443. Add that exact origin to candidate allowed origins and restart only this candidate. Keep mobile4002 disabled for this session. No Funnel or LaunchAgent change is proposed here. Any later LaunchAgent must include `RHYTHM_WORKSTREAMS_ENABLED=true`.

AJ's pasted handoff explicitly says “No merge, deploy, force-push, LaunchAgent, Tailscale Serve/Funnel change, or networking change without AJ's explicit yes in this session,” and labels cutover “separate, after the bar is met; propose, don't do.” Approval is therefore required before this separate action. Local health is not proof of MagicDNS/peer access; test actual private HTTPS/browser reachability after approval and record the result before claiming remote success.

## Every matrix row

Exclusions use AJ's recorded scope decision linked above; they remain unrun and do not enter the 93-row denominator. Original titles and historical results are preserved in the inventory.

| ID | Original behavior | Final disposition | Proof / exclusion |
| --- | --- | --- | --- |
| 1 | [P0] sessions: named session persists correct cwd/profile and deletes from API, DB and engine | PASS | no_model |
| 2 | [P0] sessions: blank names, cancel and reload cannot allocate an unnamed session | PASS | no_model |
| 3 | [P0] sessions: failed creation keeps the name and permits recovery | PASS | no_model |
| 4 | [P0] sessions: long Unicode name persists without truncating stored identity | PASS | no_model |
| 5 | [P0] sessions: cancel permanent deletion leaves the owned session intact | PASS | no_model |
| 6 | [P0] session project scope: owned project and session survive a collapsed-group reload | PASS | no_model |
| 7 | [P0] owned session history keeps three real engine children across cursor pages, search, and the parent rail | PASS | no_model |
| 8 | [P0] conversation: blank send and discarded draft leave the backend transcript unchanged | PASS | no_model |
| 9 | [AI catalog:brain] real collection renders and survives reload | PASS | no_model |
| 10 | [AI catalog:skills] real collection renders and survives reload | PASS | no_model |
| 11 | [AI catalog:playbooks] real collection renders and survives reload | PASS | no_model |
| 12 | [AI catalog:tasks] real collection renders and survives reload | PASS | no_model |
| 13 | [AI catalog:cookbook] real collection renders and survives reload | PASS | no_model |
| 14 | [AI catalog:review] real collection renders and survives reload | PASS | no_model |
| 15 | [AI catalog:report-card] real collection renders and survives reload | PASS | no_model |
| 16 | [AI catalog:gallery] real collection renders and survives reload | PASS | no_model |
| 17 | [AI catalog:deep-research] real collection renders and survives reload | PASS | no_model |
| 18 | [AI catalog:brain] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 19 | [AI catalog:skills] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 20 | [AI catalog:playbooks] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 21 | [AI catalog:tasks] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 22 | [AI catalog:cookbook] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 23 | [AI catalog:review] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 24 | [AI catalog:report-card] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 25 | [AI catalog:gallery] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 26 | [AI catalog:deep-research] unavailable backend is visible and a real reload recovers | PASS | no_model |
| 27 | [AI cookbook] creates real inert recipe with ordered steps and persists after reload | PASS | no_model |
| 28 | [AI cookbook] failed save retains the owned draft and retry persists exactly one inert recipe | PASS | no_model |
| 29 | [AI cookbook] blank validation and cancelling a draft leave the backend unchanged | PASS | no_model |
| 30 | [AI Gallery] missing media row remains inspectable and unavailable without changing its record | PASS | no_model |
| 31 | [AI Gallery] private image preview decodes and missing media remains inspectable | PASS | no_model |
| 32 | [AI Gallery] private folder move/rename persists and catalog error recovers | PASS | no_model |
| 33 | [AI Research] private empty report inspector, archive, and catalog recovery persist | PASS | no_model |
| 34 | [AI Playbooks] private managed command survives create, edit and reload in the real engine catalog | PASS | no_model |
| 35 | [AI skills] private managed SKILL.md create, edit, reload, and delete reach both primed engine catalogs | PASS | no_model |
| 36 | [AI skills] engine content matches the selected skill; cancel and blank save make no write | PASS | no_model |
| 37 | [AI memory] selected inspector contains authoritative content and kind filtering and reload stay truthful | PASS | no_model |
| 38 | [AI memory] no-match search is empty and clearing it restores real rows | PASS | no_model |
| 39 | [AI memory] private source and created/updated metadata agree in API, SQLite, vault, and selected Details | PASS | no_model |
| 40 | [AI memory] 51 private vault notes page into the inspector and deleting the selected last-page note clears it | PASS | no_model |
| 41 | [AI profiles] discarding a new smoke draft leaves the saved profile catalog unchanged | PASS | no_model |
| 42 | [AI profiles] private existing-profile dirty switch keeps or discards without saving | PASS | no_model |
| 43 | [AI profiles] owned draft survives a failed save, then revisioned retry persists across reload | PASS | no_model |
| 44 | [AI profiles] stale UI save keeps its draft and preserves the newer API revision | PASS | no_model |
| 45 | [AI profiles] live profile rail and selected editor agree with GET /agent-configs | PASS | no_model |
| 46 | [AI settings] selected MCP inspector agrees with the real server status and tools | PASS | no_model |
| 47 | [AI settings] model curation reflects real visibility and search clears back to catalog rows | PASS | no_model |
| 48 | [AI MCP] private inspector advertises the bundled tools | PASS | no_model |
| 49 | [AI quality] changing time window changes the API rollup and displayed evidence | PASS | no_model |
| 50 | [AI quality] empty agent kind keeps its authoritative Unknown agent identity and exact counts | PASS | no_model |
| 51 | [AI settings] private retention On cancel writes nothing and Off persists until owned restore | PASS | no_model |
| 52 | [AI schedules] private disabled once-only job keeps owner and disabled state through edit and reload | PASS | no_model |
| 53 | [AI schedules] private disabled schedule Cancel retains and Confirm deletes | PASS | no_model |
| 54 | [AI schedules] private editor creates future due schedules and preserves timing through edit and reload | PASS | no_model |
| 55 | [AI tools] private owner pins Dayflow, reloads, and resets only its preference | PASS | no_model |
| 56 | [P0] synthetic signed-in identity appears in the shell account and Agents rail | PASS | no_model |
| 57 | [P0] primary: permanent entry reopens the server-designated root and canonical history | PASS | no_model |
| 58 | [P0] primary: failed resolve preserves the ordinary session and visibly retries | PASS | no_model |
| 59 | [P0] primary: rapid entry and reload keep one canonical root | PASS | no_model |
| 60 | [P0] primary first use chooses a profile before creating one private canonical root | PASS | no_model |
| 61 | [P0] private missing primary cwd fails visibly without changing the canonical journal or ordinary chat | PASS | no_model |
| 62 | [AI shared agents] canonical revision and runtime readiness match the real catalog | PASS | no_model |
| 63 | [P0] tasks: create, edit, complete, reload and permanently delete | PASS | no_model |
| 64 | [P0] tasks: blank/whitespace and cancel/reload never create a record | PASS | no_model |
| 65 | [P0] tasks: rapid repeat submit persists exactly one task | PASS | no_model |
| 66 | [P0] tasks: failed create retains the draft and can be retried | PASS | no_model |
| 67 | [P0] tasks: delete cancellation preserves a long title after reload | PASS | no_model |
| 68 | [P0] navigation: Tasks route shows real collection content after direct navigation and reload | PASS | no_model |
| 69 | [P0] navigation: narrow More menu reaches a real data page and Agents remains usable | PASS | no_model |
| 70 | [P0] navigation: failed collection read is visible and recovers after retry | PASS | no_model |
| 71 | [AI live artifacts] private HTML import, sandboxed render, revisioned edit and picker use one owned artifact | PASS | no_model |
| 72 | [P0] approvals: signed pending snapshot matches real visible cards | PASS | no_model |
| 73 | [P0] approvals: failed refresh is visible, retains cards and recovers | PASS | no_model |
| 74 | [AI approvals] private native Reject clears an inert owned card without a continuation | PASS | no_model |
| 75 | [AI approvals] controlled stale card denies Approve and leaves the owned decision unconsumed | PASS | no_model |
| 76 | [AI CROSS] cold Hermes startup remains usable across immediate Colony inventory | EXCLUDED | AJ-approved native exclusion for this phase |
| 77 | [AI Hermes] real Desktop opens saved history through its actual gateway | EXCLUDED | AJ-approved native exclusion for this phase |
| 78 | [AI Hermes] an unsent draft survives tab switches without creating a backend session | EXCLUDED | AJ-approved native exclusion for this phase |
| 79 | [AI Hermes] notification overlay preserves a usable native workspace and restores it | EXCLUDED | AJ-approved native exclusion for this phase |
| 80 | [AI CROSS] Hermes remains responsive after Colony inventory while hidden beyond the backend timeout | EXCLUDED | AJ-approved native exclusion for this phase |
| 81 | [AI Bot Crossing] actual pinned scene reads paged local inventory | EXCLUDED | AJ-approved native exclusion for this phase |
| 82 | [AI Bot Crossing] tab switch preserves one scene and restores usable inventory | EXCLUDED | AJ-approved native exclusion for this phase |
| 83 | [AI Bot Crossing] no-match search clears back to the retained populated scene and live inventory | EXCLUDED | AJ-approved native exclusion for this phase |
| 84 | [AI Dayflow] advertised native workspace actually attaches | EXCLUDED | AJ-approved native exclusion for this phase |
| 85 | [AI Dayflow] original signed application artifact is ready | EXCLUDED | AJ-approved native exclusion for this phase |
| 86 | [AI Hermes] private bundled native provider setup cards match backend fields | EXCLUDED | AJ-approved native exclusion for this phase |
| 87 | [AI MCP] bundled stdio tools list and ping through the observed local API | EXCLUDED | AJ-approved native exclusion for this phase |
| 88 | [P0] conversation: real answer, canonical transcript and reload agree without duplicate user messages | PASS | scripted_ui_transport_only |
| 89 | [P0] conversation: two owned sessions retain independent answers across switching and reload | PASS | scripted_ui_transport_only |
| 90 | [P0] conversation: cancel stops an observed real engine turn and restores sending | PASS | scripted_ui_transport_only |
| 91 | [P0] model router: saved Grid/Luna/consent settings agree with the rendered controls | PASS | existing_decisions_policy_no_turn |
| 92 | [P0] model router: trivial Auto work stays cheap, applies the actual route, and reuses it after reload | PASS | paid_isolated |
| 93 | [P0] model router qualification: routine arithmetic retains an eligible tier 3 or 4 route | PASS | paid_isolated |
| 94 | [P0] model router: a one-literal edit is served by a routine-tier model | PASS | paid_isolated |
| 95 | [P0] model router: explicit session model pin serves Luna without a Grid attempt | PASS | scripted_ui_transport_only |
| 96 | [P0] model router classifier: formatting is tier 4 | EXCLUDED | AJ-approved classifier case with no UI |
| 97 | [P0] model router classifier: extraction is tier 4 | EXCLUDED | AJ-approved classifier case with no UI |
| 98 | [P0] model router classifier: one literal edit does not become tier 2 | EXCLUDED | AJ-approved classifier case with no UI |
| 99 | [P0] model router classifier: hard architecture reaches tier 1 | EXCLUDED | AJ-approved classifier case with no UI |
| 100 | [P0] model router classifier: one parameter rename stays routine | EXCLUDED | AJ-approved classifier case with no UI |
| 101 | [P0] model router classifier: one documentation typo stays routine | EXCLUDED | AJ-approved classifier case with no UI |
| 102 | [P0] model router classifier: one CSS spacing edit stays routine | EXCLUDED | AJ-approved classifier case with no UI |
| 103 | [P0] model router classifier: one obvious bounds fix stays routine | EXCLUDED | AJ-approved classifier case with no UI |
| 104 | [P0] model router classifier: a routine email stays routine | EXCLUDED | AJ-approved classifier case with no UI |
| 105 | [P0] model router classifier: a multi-file feature retains a capable tier | EXCLUDED | AJ-approved classifier case with no UI |
| 106 | [P0] model router classifier: moderate research retains a capable tier | EXCLUDED | AJ-approved classifier case with no UI |
| 107 | [P0] model router classifier: hard debugging retains a capable tier | EXCLUDED | AJ-approved classifier case with no UI |
| 108 | [AI primary] private main Auto serves a routine same-tier Grid model and retains it after reload | PASS | paid_isolated |
| 109 | [AI MCP] private profile scopes allow owned task calls and deny forbidden canonical calls | PASS | paid_isolated |
| 110 | [P0] Coordinator two owned goals finish with overlapping SDK work and one marked report each | PASS | paid_isolated |
| 111 | [P0] private chat sources one real Luna skill extraction and no duplicate after a third turn | PASS | scripted_ui_transport_only |
| 112 | [AI sessions] one private untitled real turn generates a durable visible session name | PASS | scripted_ui_transport_only |
| 113 | [AI schedules] private UI-created Once job fires on a natural local tick; disabled twin does not | PASS | scripted_ui_transport_only |
| 114 | [AI Org Reviewer] private canonical entry shows exact review policy and an available manual trigger | PASS | no_model |
| 115 | [AI profile policy] saved model, permissions, skills and tools survive reload and bind a new session | PASS | scripted_ui_transport_only |
| 116 | [AI Org Reviewer] private evaluation settings persist and empty activity is honest | PASS | no_model |
| 117 | [private Hermes actual turn] one authorized static OpenAI API Luna turn persists under the exact provider | EXCLUDED | AJ-approved native exclusion for this phase |
| 118 | [AI Org Reviewer] packaged owner snapshot preserves error history without claiming an improvement | PASS | paid_isolated |

## Approved private HTTPS cutover — completed after the local report

AJ answered **“Yes, enable private HTTPS on port 4001.”** The earlier “not performed” sections above describe the pre-approval checkpoint and remain historical. Current state: **https://ajs-macbook-pro-3.tail3798ec.ts.net:4001/#/tasks** is active within the tailnet. [Durable cutover receipt](../../testing/results/2026-10-22-web-https-cutover.json). No source/package changes or rebuild were needed; code remains89596fc186fa2662da66e0ba2f19413cbf6559c7.

Exact sequence and observed results:

1. Saved pre-change Serve configuration privately. Before cutover, HTTPS4001 failed TLS (curl35/HTTP000), while raw TCP4001 was configured.
2. `/usr/local/bin/tailscale serve --tcp=4001 off` — exit0.
3. `python3 -I /private/tmp/rhythm-web-https-cutover-20261022/restart-candidate.py` — exit0; verified original PID/executable/build identity, graceful exact-candidate shutdown and free4001/4002/4096, relaunched the same signed binary with the added exact HTTPS origin and existing workstreams flags. Credential path passed without opening contents. Desktop64828/API64835/engine64887 now own this runtime.
4. `/usr/local/bin/tailscale serve --bg --https=4001 --yes http://127.0.0.1:4001` — exit0, private tailnet URL announced. No Funnel.
5. Parsed post-change Serve configuration and compared both443/8443 TCP and Web handlers to pre-change JSON: exact equality, raw4001 absent, HTTPS4001 correct.
6. `/usr/bin/curl --noproxy '*' --connect-timeout 4 --max-time 10 -sS -o /dev/null -w 'HTTPS status=%{http_code} cert_verify=%{ssl_verify_result}\n' https://ajs-macbook-pro-3.tail3798ec.ts.net:4001/` — exit0, HTTP200, certificate verification0. No certificate-error bypass.
7. `python3 -I /private/tmp/rhythm-web-final-candidate-ready.py` — exit0, same exact code/engine, bundled executables, owner/cloud ready, served asset hashes match, mobile4002 absent.
8. `node /private/tmp/rhythm-web-https-cutover-20261022/browser-proof.mjs` — exit0; actual MagicDNS HTTPS Tasks render and reload, owner/cloud true, native bridge absent, secure WebSocket101, zero HTTP mutations/page errors.

Browser and curl checks originated on the hosting Mac and used the actual MagicDNS URL/TLS path. **A second physical tailnet device was not tested.** No claim of such evidence is made. No LaunchAgent or reboot persistence was configured; the candidate must stay running. Existing443 may point at the intentionally disabled4002 mobile gateway; its configuration was preserved as authorized. The earlier93/93 and real-account4 evidence remains valid and was not rerun merely for this config-only change.
