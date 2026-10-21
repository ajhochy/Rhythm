# Packaged Playwright status ledger (2026-10-21)

This ledger reads the named run record, the source inventory, and report metadata only. It does not reproduce prompts, credentials, attachment bodies, or error dumps. A run-note association supplies the build ID where a Playwright JSON report does not embed one. Missing a newer report is recorded as pending, not as “never run.”


## Newest exact825c checkpoint

The sections below retain older b7d5 evidence. Their “still failed” or “pending” labels describe that checkpoint and are superseded only by the named newer scope here.

| Scope | Result | Boundary |
|---|---|---|
| Exact825c expanded packaged selection | 80 passed/6 failed, zero skipped/flaky, CLI1 | `/private/tmp/rhythm-updated-final-qualification-20261021/run-LnNDlX/report.json`; all six previousb7d5 failures now pass. Includes catalogs18. |
| Exact825c Coordinator checked | Failed early after a completed MCP describe tool step | Test confused completed tool step with terminal turn; corrected observer requires final stop plus stable engine idle. Fresh native confirmation pending. |
| Exact825c private background extraction | 1/1 passed, run0/scrub0, source hashes unchanged | Two UI/SDKLuna turns triggered one source-attributed system extractor; completedLuna/no tools; third turn produced no duplicate. `/private/tmp/rhythm-skill-extract-recon-20261021/output-0T2ZJA/observation.json`. Checked Codify/Confirm pending. |
| Exact825c canonical MCP private live Recon | 1/1 passed, 4.75s, sandboxdown0 | Real API/engine/stdio tool execution with scripted loopback provider; not natural/paid provider proof. `/private/tmp/rhythm-mcp-canonical-boot-barrier-20261021/live-recon.log`. |
| Exact825c Dayflow private readiness diagnostic | Failed1/1 | Native view attached/ready; standalone status ARTIFACT_INVALID in all three phases. Installed upstream2.7.3/137 passes exactsignature/Gatekeeper but current reviewedinstalledallowlist stops at2.7.2/136. Narrow repair underway. |
| Final-source paid router/conversation/Hermes/naming/Once/C1 | Pending next build | Historical b7d5 successes remain separate; no new pass inferred. |
| Full serial API gate | Running after canonical setup patch | Prior2b8 aggregate remains historical. |

Latest86 failures and dispositions:

| Case | Finding | Current disposition |
|---|---|---|
| Original signed Dayflow application ready | Installed version newer than reviewedallowlist; signature remainsvalid | Narrow allowlist extension underway; packaging pin/signaturefailclosed behavior preserved |
| Tasks direct navigation | Legitimately empty account has no completion filter | Test now checks real empty UI before selecting optional controls; native rerun pending |
| Task create/edit/complete/reload/delete | Intentional exactowned deletionGET404 failedglobalerroraudit | Narrow confirmedDELETE204+exactID/actor audit recognition; deletion404 assertion retained |
| Rapid task creation | Same intentionalcleanup404 audit | Same narrow correction; native rerun pending |
| Failed task save then retry | RetryPOST201 saved task but server-error surface hid it | Product now resetsready state on successfulcreate; fresh build/native confirmation pending |
| Cancel task deletion/long title/reload | Same intentionalcleanup404 audit | Same narrow correction; native rerun pending |

All78 active inventory markers remain incomplete. These results do not establish overall qualification or paid Claude account behavior.

## Historical b7d5 evidence at a glance

| Scope | Result | Build | Evidence / boundary |
|---|---|---|---|
| Latest b7d5 broad no-model selection | 54 passed, 6 failed; 0 skipped/flaky; 404.994s; CLI 1 | `b7d5db0af9` | `/private/tmp/rhythm-b7d5-qualification-launch-20261020/broad-Phq2OM/report.json`; started `2026-10-21T06:25:05Z` |
| Latest router + MCP + main Auto paid selection | 19 passed; 0 skipped/flaky; 108.468s; CLI 0 | `b7d5db0af9` | `/private/tmp/rhythm-b7d5-qualification-launch-20261020/router19-AWpXpR/report.json`; started `2026-10-21T15:05:42Z`; log `/private/tmp/rhythm-private-b7d5-router19-confirm-20261021.log` |
| Latest completed Once natural-tick check | 1 passed; 133.186s; CLI 0 | `b7d5db0af9` | `/private/tmp/rhythm-b7d5-qualification-launch-20261020/natural-once-RdhfyY/report.json` |
| Focused navigation-helper rerun | 10 passed; 0 skipped/flaky; 42.060s; CLI 0 | `b7d5db0af9` | `/private/tmp/rhythm-b7d5-reload-focused-20261020/focused-gRGvB4/report.json`; supersedes three affected broad failures below |
| Checked Hermes one-turn | 1 passed; 0 skipped/flaky; 68.602s total; CLI 0 | `b7d5db0af9` | `/private/tmp/rhythm-hermes-one-turn-checked-BCRn0K/turn-report.json`; started `2026-10-21T16:29:59Z`; parent reports whole-fixture scrub/hash receipt passed and port 52530 free |
| Latest Coordinator C1 checked run | Failed 1/1; 0 skipped/flaky; 108.896s; CLI 1 | `b7d5db0af9` | `/private/tmp/rhythm-coordinator-two-goal-checked-20261020/output-qazWVl/report.json`; two jobs/commits and callbacks passed; background skill-extract attempted unavailable Anthropic Haiku and returned `ProviderModelNotFoundError`. One run; fixture `brGZYQ` scrub exit 0. Source repair/retest pending. |
| MCP readiness browser/source contract after patch | 5/5 passed; 8.5s; typecheck passed | Current source test record | Browser-intercepted/source-only evidence; exact signed app rebuild and packaged confirmation pending |
| Inventory completion | 78 active markers remain open across 83 behavior groups | — | Scoped passes do not close groups by percentage |
| Prepared final synthetic selection | Static discovery 86/86, no UNVERIFIED cases; tests not executed | Current source selection | `/private/tmp/rhythm-updated-final-qualification-20261021/discovery-MTRVIh/discovery.json`; broad60 + catalogs18 + navigation3 + tasks5. Latest signed app rebuild and native run remain pending |

## Older-only packaged coverage absent from the b7d5 60+19 selections

These are recorded confirmations on earlier product builds, not “never run.” The b7d5 broad and paid selections do not include catalogs or the four conversation cases, so the earlier evidence does not establish those on b7d5. The five ordinary session cases are already represented by the five current b7d5 `[P0] sessions` rows below; the older five-case receipt is overlapping historical evidence, not an additional open set.

| Scope | Earlier recorded result | Why not current b7d5 evidence |
|---|---|---|
| AI collection catalogs and recovery | 18/18 on signed `cf49da55af7b` | The documented run exercised real render, reload and 503 recovery; the b7d5 broad/paid selections omitted `packaged-ai-catalogs.spec.ts`. A test-only new-document response-identity correction is now staged in the catalog spec; its 18 cases were discovered but not executed on b7d5. |
| Real conversation cases | 4 passed in the 33-pass/4-fail focused selection on `cf49da55af7b`; also recorded passing in the 67-pass/92-fail full selection | These were older-suite results and are absent from the b7d5 selections. Two separately documented conversation gaps (reconnect/history cursor and child/ancestor pagination) remained failures in the earlier focused run. |
| Browser-only readiness before the repair | RED reproduced in a controlled browser contract | Separate later patched-source browser contract passed 5/5; exact signed packaged confirmation remains pending. |
| Earlier three-case Settings receipt | Earlier 3/3 is cited in `2026-10-20-ai-feature-playwright.md`; later targeted MCP inspector rerun timed out | This is older Settings evidence, not navigation coverage. `packaged-navigation.spec.ts` is a separate 3-case suite, statically discovered in the prepared selection but not run on the latest signed app. |

The catalog test’s initial and reload branches validate the live HTTP response and rendered row/empty state. `assertAiRows` deliberately accepts a legitimate empty collection, so an empty backend list is not evidence that a specific row rendered. The reload branch originally armed `waitForResponse` by endpoint/method before `page.reload()`, allowing an old-document in-flight response to satisfy it. The test-only correction now uses `reloadJsonFor(page, surface.endpoint)` and still asserts GET, endpoint, 200, array/schema, rendered row/empty state and `ObservedApi` readback. TypeScript and static 86-case discovery passed; the packaged tests remain unrun until the parent’s exact-build qualification.


## b7d5 broad report, case by case

| Test case | Broad result | Latest scoped follow-up | Started (UTC) | Test duration |
|---|---|---|---|---|
| [P0] primary first use chooses a profile before creating one private canonical root | passed | No later contrary result recorded | 2026-10-21T06:25:06.042Z | 2.817s |
| [P0] private missing primary cwd fails visibly without changing the canonical journal or ordinary chat | passed | No later contrary result recorded | 2026-10-21T06:25:42.308Z | 5.255s |
| [AI CROSS] cold Hermes startup remains usable across immediate Colony inventory | passed | No later contrary result recorded | 2026-10-21T06:25:47.577Z | 21.031s |
| [AI Hermes] real Desktop opens saved history through its actual gateway | passed | No later contrary result recorded | 2026-10-21T06:26:08.614Z | 0.608s |
| [AI Hermes] an unsent draft survives tab switches without creating a backend session | passed | No later contrary result recorded | 2026-10-21T06:26:09.228Z | 0.397s |
| [AI Hermes] notification overlay preserves a usable native workspace and restores it | passed | No later contrary result recorded | 2026-10-21T06:26:09.630Z | 0.364s |
| [AI CROSS] Hermes remains responsive after Colony inventory while hidden beyond the backend timeout | passed | No later contrary result recorded | 2026-10-21T06:26:09.999Z | 16.818s |
| [AI Bot Crossing] actual pinned scene reads paged local inventory | passed | No later contrary result recorded | 2026-10-21T06:26:26.823Z | 0.048s |
| [AI Bot Crossing] tab switch preserves one scene and restores usable inventory | passed | No later contrary result recorded | 2026-10-21T06:26:26.877Z | 0.039s |
| [AI Bot Crossing] no-match search clears back to the retained populated scene and live inventory | passed | No later contrary result recorded | 2026-10-21T06:26:26.922Z | 0.112s |
| [AI Dayflow] advertised native workspace actually attaches | passed | No later contrary result recorded | 2026-10-21T06:26:27.039Z | 0.595s |
| [AI Dayflow] original signed application artifact is ready | passed | No later contrary result recorded | 2026-10-21T06:26:27.641Z | 1.215s |
| [AI cookbook] creates real inert recipe with ordered steps and persists after reload | passed | No later contrary result recorded | 2026-10-21T06:26:28.879Z | 0.291s |
| [AI cookbook] failed save retains the owned draft and retry persists exactly one inert recipe | passed | No later contrary result recorded | 2026-10-21T06:26:29.177Z | 0.320s |
| [AI cookbook] blank validation and cancelling a draft leave the backend unchanged | passed | No later contrary result recorded | 2026-10-21T06:26:29.505Z | 0.219s |
| [AI profiles] discarding a new smoke draft leaves the saved profile catalog unchanged | passed | No later contrary result recorded | 2026-10-21T06:26:29.735Z | 0.310s |
| [AI Gallery] missing media row remains inspectable and unavailable without changing its record | passed | No later contrary result recorded | 2026-10-21T06:26:30.050Z | 0.154s |
| [AI Hermes] private bundled native provider setup cards match backend fields | failed | Still failed; no exact-case passing rerun recorded | 2026-10-21T06:26:30.214Z | 15.877s |
| [AI MCP] private inspector advertises the bundled tools | failed | Still failed; no exact-case passing rerun recorded | 2026-10-21T06:26:48.128Z | 0.150s |
| [AI MCP] bundled stdio tools list and ping through the observed local API | failed | Still failed; no exact-case passing rerun recorded | 2026-10-21T06:27:21.271Z | 0.174s |
| [P0] owned session history keeps three real engine children across cursor pages, search, and the parent rail | passed | No later contrary result recorded | 2026-10-21T06:27:54.376Z | 2.875s |
| [P0] synthetic signed-in identity appears in the shell account and Agents rail | passed | No later contrary result recorded | 2026-10-21T06:28:28.248Z | 0.048s |
| [AI approvals] private native Reject clears an inert owned card without a continuation | passed | No later contrary result recorded | 2026-10-21T06:28:28.309Z | 0.188s |
| [AI approvals] controlled stale card denies Approve and leaves the owned decision unconsumed | passed | No later contrary result recorded | 2026-10-21T06:28:28.503Z | 0.217s |
| [AI schedules] private disabled once-only job keeps owner and disabled state through edit and reload | failed | Passed in focused 10-case rerun | 2026-10-21T06:28:28.730Z | 0.093s |
| [AI Gallery] private image preview decodes and missing media remains inspectable | passed | Passed in focused 10-case rerun | 2026-10-21T06:28:31.028Z | 0.436s |
| [AI Gallery] private folder move/rename persists and catalog error recovers | passed | Passed in focused 10-case rerun | 2026-10-21T06:29:02.307Z | 0.355s |
| [AI Research] private empty report inspector, archive, and catalog recovery persist | failed | Passed in focused 10-case rerun | 2026-10-21T06:29:02.667Z | 0.039s |
| [AI live artifacts] private HTML import, sandboxed render, revisioned edit and picker use one owned artifact | passed | No later contrary result recorded | 2026-10-21T06:29:04.723Z | 0.603s |
| [AI memory] private source and created/updated metadata agree in API, SQLite, vault, and selected Details | passed | No later contrary result recorded | 2026-10-21T06:29:36.198Z | 0.366s |
| [AI memory] 51 private vault notes page into the inspector and deleting the selected last-page note clears it | passed | No later contrary result recorded | 2026-10-21T06:29:36.575Z | 3.360s |
| [AI Playbooks] private managed command survives create, edit and reload in the real engine catalog | passed | No later contrary result recorded | 2026-10-21T06:29:39.944Z | 0.811s |
| [AI profiles] private existing-profile dirty switch keeps or discards without saving | passed | No later contrary result recorded | 2026-10-21T06:29:40.763Z | 0.380s |
| [AI schedules] private disabled schedule Cancel retains and Confirm deletes | passed | No later contrary result recorded | 2026-10-21T06:29:41.152Z | 0.471s |
| [AI schedules] private editor creates future due schedules and preserves timing through edit and reload | passed | No later contrary result recorded | 2026-10-21T06:29:41.634Z | 1.846s |
| [AI skills] private managed SKILL.md create, edit, reload, and delete reach both primed engine catalogs | passed | No later contrary result recorded | 2026-10-21T06:29:43.489Z | 1.148s |
| [AI profiles] owned draft survives a failed save, then revisioned retry persists across reload | passed | No later contrary result recorded | 2026-10-21T06:29:44.647Z | 0.739s |
| [AI profiles] stale UI save keeps its draft and preserves the newer API revision | passed | No later contrary result recorded | 2026-10-21T06:29:45.391Z | 0.800s |
| [AI settings] private retention On cancel writes nothing and Off persists until owned restore | passed | No later contrary result recorded | 2026-10-21T06:29:46.199Z | 0.158s |
| [AI settings] selected MCP inspector agrees with the real server status and tools | passed | No later contrary result recorded | 2026-10-21T06:29:46.365Z | 0.192s |
| [AI settings] model curation reflects real visibility and search clears back to catalog rows | passed | No later contrary result recorded | 2026-10-21T06:29:46.561Z | 0.353s |
| [AI profiles] live profile rail and selected editor agree with GET /agent-configs | passed | No later contrary result recorded | 2026-10-21T06:29:46.919Z | 0.143s |
| [AI tools] private owner pins Dayflow, reloads, and resets only its preference | passed | No later contrary result recorded | 2026-10-21T06:29:47.070Z | 0.108s |
| [AI memory] selected inspector contains authoritative content and kind filtering and reload stay truthful | passed | Passed in focused 10-case rerun | 2026-10-21T06:29:47.189Z | 0.280s |
| [AI memory] no-match search is empty and clearing it restores real rows | failed | Passed in focused 10-case rerun | 2026-10-21T06:29:47.473Z | 60.087s |
| [AI skills] engine content matches the selected skill; cancel and blank save make no write | passed | Passed in focused 10-case rerun | 2026-10-21T06:30:49.568Z | 0.860s |
| [AI quality] changing time window changes the API rollup and displayed evidence | passed | Passed in focused 10-case rerun | 2026-10-21T06:31:21.292Z | 0.054s |
| [AI quality] empty agent kind keeps its authoritative Unknown agent identity and exact counts | passed | Passed in focused 10-case rerun | 2026-10-21T06:31:21.352Z | 0.352s |
| [AI shared agents] canonical revision and runtime readiness match the real catalog | passed | Passed in focused 10-case rerun | 2026-10-21T06:31:21.709Z | 0.060s |
| [P0] approvals: signed pending snapshot matches real visible cards | passed | No later contrary result recorded | 2026-10-21T06:31:21.781Z | 4.915s |
| [P0] approvals: failed refresh is visible, retains cards and recovers | passed | No later contrary result recorded | 2026-10-21T06:31:26.700Z | 5.053s |
| [P0] primary: permanent entry reopens the server-designated root and canonical history | passed | No later contrary result recorded | 2026-10-21T06:31:31.762Z | 0.255s |
| [P0] primary: failed resolve preserves the ordinary session and visibly retries | passed | No later contrary result recorded | 2026-10-21T06:31:32.022Z | 2.609s |
| [P0] primary: rapid entry and reload keep one canonical root | passed | No later contrary result recorded | 2026-10-21T06:31:34.636Z | 0.276s |
| [P0] session project scope: owned project and session survive a collapsed-group reload | passed | No later contrary result recorded | 2026-10-21T06:31:34.920Z | 2.819s |
| [P0] sessions: named session persists correct cwd/profile and deletes from API, DB and engine | passed | No later contrary result recorded | 2026-10-21T06:31:37.753Z | 2.612s |
| [P0] sessions: blank names, cancel and reload cannot allocate an unnamed session | passed | No later contrary result recorded | 2026-10-21T06:31:40.371Z | 0.323s |
| [P0] sessions: failed creation keeps the name and permits recovery | passed | No later contrary result recorded | 2026-10-21T06:31:40.699Z | 2.578s |
| [P0] sessions: long Unicode name persists without truncating stored identity | passed | No later contrary result recorded | 2026-10-21T06:31:43.282Z | 2.525s |
| [P0] sessions: cancel permanent deletion leaves the owned session intact | passed | No later contrary result recorded | 2026-10-21T06:31:45.812Z | 2.572s |

### Broad failures and their current interpretation

- The broad Hermes provider-setup test observed the normal provider cards successfully; the case was marked failed by an unrelated unexpected `MCP_CATALOG_UNAVAILABLE` error log. This is not a provider-fields defect. The separate Hermes actual-turn checked test later passed 1/1.
- The MCP inspector readiness case failed its first settled status assertion because `configured` remained where the test expected connected; the later MCP scope pass is a different case.
- The MCP stdio list/ping case failed its first readiness assertion; the later 19/19 run covered MCP profile scoping, not this stdio case.
- Disabled once-only schedule persistence failed in the broad run, then passed in the focused 10-case rerun.
- Research catalog recovery failed in the broad run at an old-document response-body boundary, then passed in the focused rerun.
- Memory no-match search failed in the broad run before the collection waiter observed the expected catalog request, then passed in the focused rerun.
- The broad aggregate remains 54/6 even though three specific failed cases later passed focused reruns; the aggregate report is preserved and is not retroactively green.

## Latest b7d5 router/MCP/main-Auto result

All 19 lines below are passing cases from the 2026-10-21 text log; individual timestamps are not present in that log. This 19-case paid scope is separate from the broad no-model selection.

| Passing case | Duration |
|---|---|
| [AI primary] private main Auto serves a routine same-tier Grid model and retains it after reload | 6.3s |
| [AI MCP] private profile scopes allow owned task calls and deny forbidden canonical calls | 34.0s |
| [P0] model router: saved Grid/Luna/consent settings agree with the rendered controls | 476ms |
| [P0] model router: trivial Auto work stays cheap, applies the actual route, and reuses it after reload | 6.7s |
| [P0] model router qualification: routine arithmetic retains an eligible tier 3 or 4 route | 5.0s |
| [P0] model router: a one-literal edit is served by a routine-tier model | 9.0s |
| [P0] model router: explicit session model pin serves Luna without a Grid attempt | 8.1s |
| [P0] model router classifier: formatting is tier 4 | 543ms |
| [P0] model router classifier: extraction is tier 4 | 240ms |
| [P0] model router classifier: one literal edit does not become tier 2 | 228ms |
| [P0] model router classifier: hard architecture reaches tier 1 | 264ms |
| [P0] model router classifier: one parameter rename stays routine | 250ms |
| [P0] model router classifier: one documentation typo stays routine | 199ms |
| [P0] model router classifier: one CSS spacing edit stays routine | 156ms |
| [P0] model router classifier: one obvious bounds fix stays routine | 194ms |
| [P0] model router classifier: a routine email stays routine | 213ms |
| [P0] model router classifier: a multi-file feature retains a capable tier | 263ms |
| [P0] model router classifier: moderate research retains a capable tier | 174ms |
| [P0] model router classifier: hard debugging retains a capable tier | 201ms |

## Other named outcomes and pending cases

| Case | Status | Build / evidence | Plain-language result |
|---|---|---|---|
| Latest checked auto-name Confirm | Passed 1/1; 42.239s total; 0 skipped/flaky; CLI 0 | b7d5; `/private/tmp/rhythm-session-autoname-checked-confirm-20261020/confirm-cSX6mw/report.json` | Main answer used Luna; title was durably generated; `managedSmallModel` was null. An earlier intermittent checked failure remains unresolved and is not dismissed by this pass. |
| Earlier checked auto-name attempt | Failed 1/1; 110.484s; CLI 1 | b7d5; `/private/tmp/rhythm-session-autoname-checked-confirm-20261020/confirm-s1lI6B/report.json` | Luna answer succeeded but title remained a placeholder for the bounded wait; keep this as unresolved intermittent behavior alongside the later pass. |
| Auto-name private Recon | Passed 1/1 | b7d5; `/private/tmp/rhythm-session-autoname-recon-20261020/output-j1yAGu/observation.json` | One real Luna answer and durable title agreement were observed; this is Recon, not checked Confirm. |
| Latest Coordinator C1 checked run | Failed 1/1; 108.896s; CLI 1 | b7d5; `/private/tmp/rhythm-coordinator-two-goal-checked-20261020/output-qazWVl/report.json` | Both jobs, distinct commits and callbacks passed. The only failure was background skill extraction using unavailable Anthropic Haiku (`ProviderModelNotFoundError`); source repair/retest is pending. |
| Hermes actual one-turn Recon | Passed 1/1; 29.4s test / about 1.1m total; CLI 0 | b7d5; `/private/tmp/rhythm-hermes-one-turn-b7d5-RsvjAb/turn-observation.json` | UI, API history and SQLite agreed on one `openai-api/gpt-6-luna` answer, zero tools, one call; exact fixture was scrubbed. |
| Hermes checked one-turn test | Passed 1/1; 68.602s total; CLI 0 | b7d5; `/private/tmp/rhythm-hermes-one-turn-checked-BCRn0K/turn-report.json` | UI/API/SQLite answer agreement, zero tools, and one official OpenAI/Luna call passed; fixture scrub and unchanged source hashes passed, port 52530 free. |
| Checked natural Once warning behavior | Run note reports 1/1 pass; inventory still says native GREEN pending | b7d5 | Assertion-to-report mapping needs reconciliation before treating the specific completed-Once warning repair as closed. |
| New scripted-provider API/engine/MCP live contract | Pending / not run | b7d5 source contract staged outside checkout per run note | No live API/engine result is recorded. |
| Provider/account exhaustion and fallback | Gap marker / unqualified | Inventory `router-first-prompt` | Explicit pinned-account negative, eligible second-account exhaustion fallback and retry/recovery remain separate from ordinary routing cases. |

## Earlier builds and browser-only evidence

| Build | Scoped result | Interpretation |
|---|---|---|
| Signed `5dfffb5d99` (product `0b3b180393`) | No-model 60/60; paid router/MCP/main-Auto 19/19; fresh router prerequisite 1/1; natural Once checked 1/1 | Historical independent scopes; none transfers to b7d5. |
| Signed `4fda312118` | Broad 59/59; ordinary router 17/17 and separate main-Auto semantic 1/1 | Historical and narrower than current b7d5 evidence. |
| Pre-repair browser MCP readiness interleaving | RED reproduced | Historical source/browser controlled-interleaving result; the later patched source contract passed 5/5, but packaged app confirmation remains pending. |

## Inventory state and discrepancies

- The inventory JSON still identifies its main source/product snapshot as `5dfffb5d99` / `0b3b180393`; its `latestB7d5Checkpoint` does not include the later b7d5 broad 54/6 report or the 2026-10-21 router19 pass. Use the later run record/log for those current results.
- The inventory aggregate fields (`passed: 60`, `latestRunFailed: 0`) describe the prior 5dff selection, while the latest b7d5 broad report is 54/6; these are different builds/scopes, not contradictory results for one run.
- The run note reports a b7d5 natural Once warning contract pass, while the inventory still marks the completed-Once warning GREEN as pending after a 5dff RED. The exact test/assertion coverage needs a source/report mapping before the ledger closes that gap.
- The earlier failed auto-name report has aggregate stats `expected: 0, unexpected: 1`; this was a failed result, not a pass count. A later checked Confirm passed, but the earlier intermittent failure remains open.
- The latest Coordinator report is now available at `output-qazWVl/report.json`: one unexpected case in 108.896 seconds. Its failure was the background Anthropic Haiku skill-extract attempt; the two goal callbacks and commits passed.
- `docs/testing/results/` is ignored by `.gitignore`; this ledger is a local artifact unless deliberately moved into a tracked documentation location.
