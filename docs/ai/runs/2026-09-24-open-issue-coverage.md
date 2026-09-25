---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: in_progress
tags: [run, rhythm]
---

# Rhythm mega PR: all open issue coverage

Snapshot: 2026-09-24; 91 open issues from the GitHub inventory taken during this run. PR #1544 remote head `dcbc9e43`; local branch includes the Colony artifact resolver `b4b24d56`, Hermes grant broker foundation `98550b60`, and memory CI compatibility repair `3584d7dc`. Remote server CI failed three memory tests; all three pass in the latest integrated API run, which has one separate Engraph identity failure (6325 passed, 264 skipped). Its repair is now integrated in `4893d12b`; the subsequent full API suite passed 6329 tests with 264 skipped. The prior combined gate remains 15/16, with the failed engine stage passing on replay; this is not full-gate acceptance.

**This PR does not yet complete all 91 issues.** The labels below distinguish included source from full acceptance. All work is now requested for the mega PR, but authorization is not implementation. “Not mapped” means no accepted implementation or active task was identified; it does not claim the repository has no related code.

| State | Issues |
|---|---:|
| Implemented in PR and marked to close | 12 |
| Implementation exists; partial acceptance or completion not yet established | 28 |
| Active repair, not yet integrated | 1 |
| Concrete plan or queued repair; not implemented in PR | 13 |
| Not currently mapped to an accepted implementation or active slice | 37 |

The 12 formal closing references describe the PR author’s completion intent, not a fresh installed-app qualification. The PR remains draft. Shared named agents/settings and two-way Hermes/Rhythm delegation are newly requested scope outside these 91 existing issue titles; the native Hermes execution plan is recorded in `docs/ai/plans/2026-09-24-native-hermes-shared-agents.md`.

## Implemented in PR and marked to close

| Issue | Title | Current evidence / remaining work |
|---|---|---|
| [#1524](https://github.com/ajhochy/Rhythm/issues/1524) | Electron app-wide: make every view pane and column resizable by dragging | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1523](https://github.com/ajhochy/Rhythm/issues/1523) | Electron agent profiles: redesign settings and actions while preserving the existing page structure | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1522](https://github.com/ajhochy/Rhythm/issues/1522) | Electron Agents: add a project directly from the Agents tab | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1521](https://github.com/ajhochy/Rhythm/issues/1521) | Electron main Settings: adopt the Agents Tasks list-and-inspector design | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1519](https://github.com/ajhochy/Rhythm/issues/1519) | Electron Integrations: adopt the Agents Tasks list-and-inspector design | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1518](https://github.com/ajhochy/Rhythm/issues/1518) | Electron Automations: adopt the Agents Tasks list-and-inspector design | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1517](https://github.com/ajhochy/Rhythm/issues/1517) | Electron Projects: adopt the Agents Tasks list-and-inspector design | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1514](https://github.com/ajhochy/Rhythm/issues/1514) | Electron Agent Settings: expose the missing agent configuration controls in a list-and-inspector layout | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1513](https://github.com/ajhochy/Rhythm/issues/1513) | Electron Agent Tools: unify every tool around the Agents Tasks list-and-inspector pattern | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1512](https://github.com/ajhochy/Rhythm/issues/1512) | Electron Agents: replace oversized child-loading buttons with compact tree controls | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1511](https://github.com/ajhochy/Rhythm/issues/1511) | Electron Agents: replace confusing archive/density checkbox rows with clear view options | Code included and formal closing reference present; combined installed smoke still applies. |
| [#1496](https://github.com/ajhochy/Rhythm/issues/1496) | Electron: native directory picker for agent project selection (Browse) | Code included and formal closing reference present; combined installed smoke still applies. |

## Implementation exists; partial acceptance or completion not yet established

| Issue | Title | Current evidence / remaining work |
|---|---|---|
| [#1582](https://github.com/ajhochy/Rhythm/issues/1582) | Electron session window: adopt OpenCode Desktop chat streaming, including live thinking and readable timestamps | Transcript reducer integrated; real-engine and history scenarios remain. |
| [#1581](https://github.com/ajhochy/Rhythm/issues/1581) | Electron top bar: More destinations dropdown is broken | More menu fix integrated; installed smoke remains. |
| [#1579](https://github.com/ajhochy/Rhythm/issues/1579) | Electron macOS: native agent notifications do not appear; match Flutter behavior | Notification bridge integrated; physical banner/sound/click remains. |
| [#1576](https://github.com/ajhochy/Rhythm/issues/1576) | Routed model aliases break provenance: only openrouter/free is recorded, never the model that actually ran | B1 ledger only; B2 outcome wiring remains. |
| [#1575](https://github.com/ajhochy/Rhythm/issues/1575) | Async delegation: child sessions inherit the manager cwd; worktree is prose-only, so correctness depends on model judgment | Child worktree isolation integrated; provider-backed child cwd proof remains. |
| [#1571](https://github.com/ajhochy/Rhythm/issues/1571) | memory: api_server default vault still points at the stale ~/Documents/Memory-Vault — Electron spawn path never got #885's env wiring | Vault default changed in 788e7ccc; existing implementation. |
| [#1568](https://github.com/ajhochy/Rhythm/issues/1568) | OpenAI usage budget is reachable: Codex plan windows come from GET /backend-api/wham/usage, not the platform API | Usage backend integrated; real account/UI qualification remains. |
| [#1565](https://github.com/ajhochy/Rhythm/issues/1565) | Timestamps render as raw UTC ISO strings across the Electron renderer; no shared formatter | Local formatter integrated; local-API browser proxy committed in 13cbacf3 and passes 2/2; other surfaces/native remain. |
| [#1559](https://github.com/ajhochy/Rhythm/issues/1559) | Electron Agent Settings: one failed request hides all seven sections, including the offline-capable ones | Per-section failures isolated; keyboard/screen-reader follow-up remains. |
| [#1558](https://github.com/ajhochy/Rhythm/issues/1558) | Electron Agents: project groups should load collapsed and remember their state | Project expand/persistence fix integrated; installed smoke remains. |
| [#1552](https://github.com/ajhochy/Rhythm/issues/1552) | Transcript: delegated-task card wraps its title one word per line (child-chip grid has 3 columns, markup has 2) | Child-card grid fixed; installed smoke remains. |
| [#1547](https://github.com/ajhochy/Rhythm/issues/1547) | Desktop Google exchange downgrades shared Calendar/Gmail scopes and can null the refresh token | Credential-preservation fix integrated; real Google OAuth qualification remains. |
| [#1543](https://github.com/ajhochy/Rhythm/issues/1543) | Hermes B4: Theme the Hermes dashboard to match Rhythm in both hosts | Theme/embed work exists; complete both-host parity not qualified. |
| [#1542](https://github.com/ajhochy/Rhythm/issues/1542) | Hermes B3: Embed a supervised Hermes dashboard tab in Rhythm Electron | Actual Hermes Desktop already embedded; not a new feature being rebuilt. |
| [#1541](https://github.com/ajhochy/Rhythm/issues/1541) | Hermes B2: Supervise the Hermes sidecar and gate a bundled Mac payload | Supervisor/payload implementation exists; final packaging/runtime matrix remains. |
| [#1540](https://github.com/ajhochy/Rhythm/issues/1540) | Hermes B1: Finish and prove the unified Rhythm plugin for Hermes | Shared non-agent workspace package exists; unified plugin and host verification remain. |
| [#1520](https://github.com/ajhochy/Rhythm/issues/1520) | Electron packaging: replace the generic Electron app icon with the Rhythm icon | Icon/package work exists; full installed/signing surfaces remain. |
| [#1516](https://github.com/ajhochy/Rhythm/issues/1516) | Electron Messages: adopt the Agents Tasks list-and-inspector design | List/inspector migration exists; hosted write/delete cycle remains. |
| [#1515](https://github.com/ajhochy/Rhythm/issues/1515) | Electron Facilities: adopt the Agents Tasks list-and-inspector design | List/inspector migration exists; known Facilities native row-render failure remains. |
| [#1510](https://github.com/ajhochy/Rhythm/issues/1510) | Mobile and Electron: unwanted low-frequency bell during agent turns | Audio preference/lifecycle work exists; physical audible proof remains. |
| [#1509](https://github.com/ajhochy/Rhythm/issues/1509) | Electron: improve reading comfort in Tasks and Agents chat | Reading-comfort changes exist; full visual/native matrix remains. |
| [#1491](https://github.com/ajhochy/Rhythm/issues/1491) | Webhook triggers lose payload and only offer Start Secretary | Draft-preserving webhook handoff integrated; installed Flutter smoke remains. Current CI Postgres bootstrap passed. |
| [#1468](https://github.com/ajhochy/Rhythm/issues/1468) | Gemini requests rejected: >512 function declarations sent (19 dead sessions since 2026-07-02) | Existing Gemini deferred-tool fix supported by synthetic 605-tool capture; no new change or Google-account proof. |
| [#1373](https://github.com/ajhochy/Rhythm/issues/1373) | OCU-35B/use-case-1: Cloudflare relay for Tailscale-free mobile session connectivity | Relay implemented with earlier connected-phone evidence; current build/off-LAN qualification remains. |
| [#1574](https://github.com/ajhochy/Rhythm/issues/1574) | Engraph backend leaks processes: 21 stray 'engraph serve' instances accumulated over a week | Ownership cleanup efe77109 plus startup proof repair 4893d12b: 62 focused tests, API build and full API suite (6329 passed/264 skipped) passed; real Engraph/native qualification remains. |
| [#1500](https://github.com/ajhochy/Rhythm/issues/1500) | Flaky: workflow_failure_signal_extractor stale-redo test fails on same-tick createdAt (issue-933-c7) | Local integrated commit b9c6150b: deterministic same-timestamp ordering; 66 focused tests pass. Backend gate passed; new-head CI pending. |
| [#1569](https://github.com/ajhochy/Rhythm/issues/1569) | Hermes + Rhythm: share credentials and memory behind one AI settings screen | S1 reader, S2 broker, S5 memory safety, real Accounts main/preload/view wiring and Accounts UI are integrated through a4e7b506. Parent UI24 focused/8 rendered pass. Native owned-spawn lifecycle source db0cba2d3c is in companion fork PR17 (parent39 focused pass), not yet pinned. Helper-probe sanitation, shared-memory access, artifact pin and final live qualification remain unfinished. |
| [#1527](https://github.com/ajhochy/Rhythm/issues/1527) | [COL-02] Verify the Colony artifact and add the isolated embedded bridge | Resolver foundation is integrated in b4b24d56 (37 focused cases). Companion PR5 now has protected shared state, private protocol, scene transport, worker and preload through569cf72 (parent45 latest focused pass). Exact native frame authorization, actual tab and final verified artifact pin remain unfinished. |

## Active repair, not yet integrated

| Issue | Title | Current evidence / remaining work |
|---|---|---|
| [#1526](https://github.com/ajhochy/Rhythm/issues/1526) | [COL-01] Pin upstream Colony source and emit a sealed embedded artifact | Upstream foundation857c8b0 is in companion draft Bot Crossing PR5; full213 tests/build pass. Clean41-file artifact passes the Rhythm resolver. Packaged pin, private IPC and actual tab remain pending. |

## Concrete plan or queued repair; not implemented in PR

| Issue | Title | Current evidence / remaining work |
|---|---|---|
| [#1573](https://github.com/ajhochy/Rhythm/issues/1573) | Memory injection only ever uses the FTS lane; Engraph semantic search never fires despite reporting healthy | Source diagnosis found July30 relevance gate requires explicit backend confidence AND lexical overlap; this contradicts nonlexical retrieval. Degradation provenance and trustworthy semantic relevance repair remain planned; original runtime cause not freshly reproduced. |
| [#1572](https://github.com/ajhochy/Rhythm/issues/1572) | Unify model-picker visibility and availability filtering across providers | Preserved candidate; direct-provider usability unresolved, targeted repair planned. |
| [#1537](https://github.com/ajhochy/Rhythm/issues/1537) | [COL-12] Document and gate the all-user opt-in Colony release | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1536](https://github.com/ajhochy/Rhythm/issues/1536) | [COL-11] Qualify installed signed Colony on Apple Silicon and Intel | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1535](https://github.com/ajhochy/Rhythm/issues/1535) | [COL-10] Make release CI the Colony artifact producer | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1534](https://github.com/ajhochy/Rhythm/issues/1534) | [COL-09] Stage the sealed Colony artifact in the Mac package | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1533](https://github.com/ajhochy/Rhythm/issues/1533) | [COL-08] Complete resource behavior, accessibility and failure recovery | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1532](https://github.com/ajhochy/Rhythm/issues/1532) | [COL-07] Add local opt-in, persistent preferences and reversible import | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1531](https://github.com/ajhochy/Rhythm/issues/1531) | [COL-06] Connect exact task actions and Rhythm-native menus | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1530](https://github.com/ajhochy/Rhythm/issues/1530) | [COL-05] Build the native Colony tab, task rail and inspector | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1529](https://github.com/ajhochy/Rhythm/issues/1529) | [COL-04] Design the Rhythm-native Colony workspace and menu system | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1528](https://github.com/ajhochy/Rhythm/issues/1528) | [COL-03] Manage the owned local scanner and source discovery | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |
| [#1525](https://github.com/ajhochy/Rhythm/issues/1525) | [Colony] Rhythm-native workspace and packaged macOS rollout | Owned scanner/worker source569cf72 is now reviewed in companion PR5; explicit source configuration, disabled-source isolation and read-only synthetic stores pass. Rhythm native supervisor contracts are active; integration/pin/tab and final smoke remain pending. Still planned from the Rhythm PR contents perspective until the artifact is pinned. |

## Not currently mapped to an accepted implementation or active slice

| Issue | Title | Current evidence / remaining work |
|---|---|---|
| [#1580](https://github.com/ajhochy/Rhythm/issues/1580) | Electron AI settings: add provider login and model curation modeled after Hermes Desktop | Earlier login UI exists, but this full login/model-curation issue has no accepted implementation in the current batch. |
| [#1570](https://github.com/ajhochy/Rhythm/issues/1570) | Update the embedded Hermes Desktop artifact in place, without rebuilding Rhythm | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1567](https://github.com/ajhochy/Rhythm/issues/1567) | Session inspector property list is redundant, and hard-codes the date, the usage budget and zeroed token counts | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1566](https://github.com/ajhochy/Rhythm/issues/1566) | Electron session inspector shows an empty usage gauge; /agents/usage-budget is never called | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1564](https://github.com/ajhochy/Rhythm/issues/1564) | Electron Agent Settings: MCP connect/disconnect/remove disable every button with no progress indicator, and notices leak between sections | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1563](https://github.com/ajhochy/Rhythm/issues/1563) | Electron Agent Settings: Runtime and Auto-promotion report status in 9px right-aligned mono and assert state they never verified | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1562](https://github.com/ajhochy/Rhythm/issues/1562) | Electron Agent Settings: Profiles overview is 54 inert cards with no search and the only action buried below all of them | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1561](https://github.com/ajhochy/Rhythm/issues/1561) | Electron Agent Settings: MCP section leads with the add form and gives no way to find the 5 broken servers among 26 | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1560](https://github.com/ajhochy/Rhythm/issues/1560) | Electron Agent Settings: MCP failed/needs_auth servers look identical to connected ones, and their errors are styled as muted text | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1557](https://github.com/ajhochy/Rhythm/issues/1557) | Electron Agents: "+" button on each project heading to start a session in that project | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1556](https://github.com/ajhochy/Rhythm/issues/1556) | Sessions created with an isolated worktree lose their project (land under "No project") | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1555](https://github.com/ajhochy/Rhythm/issues/1555) | Electron Agent Settings: runtime control has no owner — Flutter cannot restart either; split engine restart (api_server) from local runtime restart (Electron IPC) | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1554](https://github.com/ajhochy/Rhythm/issues/1554) | Transcript: usage footer prints placeholder "Cost $0 · Input 0 · Output 0" for in-flight messages; cost is unformatted | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1553](https://github.com/ajhochy/Rhythm/issues/1553) | Transcript: empty "Reasoning" rows render as blank 40px bands; summary label is always the literal word "Reasoning" | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1551](https://github.com/ajhochy/Rhythm/issues/1551) | Electron Agent Settings: Keybindings gap notice is false — Electron already ships a working send-key preference, and Flutter's keybinds are inert shared_preferences strings | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1550](https://github.com/ajhochy/Rhythm/issues/1550) | Electron Agent Settings: Behavior (destructive-tool modal) is unimplemented — Flutter stores it in shared_preferences, not on the server | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1545](https://github.com/ajhochy/Rhythm/issues/1545) | Facilities: improve the Electron UI | Known Facilities UI follow-up; not implemented in the current batch. |
| [#1505](https://github.com/ajhochy/Rhythm/issues/1505) | Upgrade better-sqlite3 to 13.x (N-API) and pin every Node runtime — Node 24.19+ aborts 12.x during GC finalization | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1503](https://github.com/ajhochy/Rhythm/issues/1503) | v0.18.64: local API stalls ~30 s after agent turns — main thread JSON.parse of a large gzip'd HTTP response (not the skill-usage scan) | Prior event-loop/health repairs exist, but no evidence that this large-JSON-parse issue is resolved. |
| [#1485](https://github.com/ajhochy/Rhythm/issues/1485) | Epic: Recipes as durable, enforced multi-agent workflows | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1425](https://github.com/ajhochy/Rhythm/issues/1425) | OCU-35C follow-up: desktop transcript sharing review, recipient, and revoke UI | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1424](https://github.com/ajhochy/Rhythm/issues/1424) | Mega plan 1042–1108: complete the live/manual verification matrix | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1404](https://github.com/ajhochy/Rhythm/issues/1404) | Confirm which Developer ID Application signing identity is canonical for Rhythm | Signing-identity decision remains unqualified in this pass. |
| [#1403](https://github.com/ajhochy/Rhythm/issues/1403) | Phase 11: prove the signing/notarization pipeline via a real CI dispatch + clean-machine Gatekeeper check | Real release/clean-machine qualification remains; not covered by local gate. |
| [#1382](https://github.com/ajhochy/Rhythm/issues/1382) | Consolidate the fragmented permission/approval streams (bypass edge cases + agent-approvals 401 deadlock) | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1377](https://github.com/ajhochy/Rhythm/issues/1377) | Data repair: run reviewed cleanup of corrupted Theological-Researcher session bindings | Live data repair; requires exact reviewed cleanup rather than broad source implementation. |
| [#1376](https://github.com/ajhochy/Rhythm/issues/1376) | Rollout: enable RHYTHM_RESEARCH_PROJECTS_ENABLED after merging the mega PR | Post-merge production rollout; cannot be completed by draft source changes alone. |
| [#1374](https://github.com/ajhochy/Rhythm/issues/1374) | OCU-35B/use-case-2: secondary-desktop continuation/management of remote agent sessions | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1372](https://github.com/ajhochy/Rhythm/issues/1372) | OCU-35A/4: add v2 reconnect + session.next.* event stream/cursor — currently absent | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1371](https://github.com/ajhochy/Rhythm/issues/1371) | OCU-35A/3: add v2 session.abort (cancellation) — currently absent | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1370](https://github.com/ajhochy/Rhythm/issues/1370) | OCU-35A/2: implement real v2 session.shell + session.compact + session.wait (remove false-success no-ops) | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1369](https://github.com/ajhochy/Rhythm/issues/1369) | OCU-35A/1: implement real v2 session.create + session.prompt (replace placeholder casts) | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1356](https://github.com/ajhochy/Rhythm/issues/1356) | MCP Apps: harden security and prepare GA rollout | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1178](https://github.com/ajhochy/Rhythm/issues/1178) | OCU-35C — Build privacy-safe transcript sharing inside Rhythm | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1177](https://github.com/ajhochy/Rhythm/issues/1177) | OCU-35B — Deliver an isolated remote-workspace execution vertical slice | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1176](https://github.com/ajhochy/Rhythm/issues/1176) | OCU-35A — Adopt OpenCode v2 sessions only after upstream lifecycle parity | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |
| [#1094](https://github.com/ajhochy/Rhythm/issues/1094) | Expose native OpenAI image generation to agent profiles | No issue-specific accepted implementation or assigned execution slice identified in this PR audit. |

## Evidence

Live open-issue list: `/private/tmp/rhythm-all-open-issues.json`. PR closing references: `/private/tmp/rhythm-pr1544-state.json`. Full local branch history: `/private/tmp/rhythm-mega-commits.txt`. Integration revalidation: `docs/ai/runs/2026-09-24-repair4-revalidation.md`. Colony inspection: `/private/tmp/rhythm-finish-all-tab-inventory.md`. This snapshot will be updated as accepted slices land.

September24 integration update: private Accounts helper760dbb47 passed48 parent focused tests/typecheck, with253 candidate Electron tests. Pre-slice27c61758 passed all six remote checks. Review identified actual Hermes startup bypassing the new credential host path; repair remains in progress. Colony protocol/scene transport has234 candidate tests and passing parent focused tests, but a metadata collision found in review is being repaired before commit. Counts and closing references above remain unchanged.
