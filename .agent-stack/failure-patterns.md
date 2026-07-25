# Failure Patterns

## 2026-07-14 — Dev sandbox isolation lifecycle — smoke PASS

- **Result**: smoke PASS; verification had not yet claimed PASS; no divergence.
- **Category**: none (correctness); process: `verification-environment` and `stale-sandbox-state`.
- **Criteria affected**: live-service PID preservation, sandbox health, and complete sandbox cleanup all passed.
- **Root cause**: the first attempts encountered stale sandbox metadata and an unsupported Node 26 / better-sqlite3 ABI mismatch; selecting the existing supported Node 22 runtime and safely clearing stale sandbox state produced a clean lifecycle.
- **Suggested fix**: run the lifecycle from the repository-supported login-shell runtime and preflight stale sandbox metadata before `up`.
- See `.agent-stack/postmortems/2026-07-14-dev-sandbox-isolation.json`.

## 2026-06-27 — mcp-scope-04 — REST-first interactive session bypasses profile scope

- **Result**: smoke FAIL (verification claimed PASS) — divergence
- **Category**: C2 — wrong contract
- **Criteria affected**: mcp-scope-04 AC-03
- **Root cause**: `POST /agent-sessions` creates the opencode session using only
  an explicit legacy `mcpRole`; profile-derived scope is resolved later in
  `ws_gateway`, after the engine session already exists. AC-03 treated a
  `createSession` helper test as interactive-path proof without exercising this
  lifecycle.
- **Suggested fix**: add a full-stack POST contract for a scoped Agent Profile
  and resolve profile scope before the controller's initial engine-session
  creation.

## 2026-05-20 — PR #617 rounds 1-5 (#627, #628, #632-639) — Partial pass

- **Result**: 8 of 10 criteria PASS at smoke; #638 (3 sub-criteria) FAIL across 5 rounds, parked as known bug. verification-gate emitted PASS each round; manual smoke caught the divergence each time.
- **Category**: C2 dominant. Five rounds of (contract green-fail → fix → contract green-pass → verification PASS → smoke FAIL) on the same underlying issue. Each round addressed a real bug, contract tests were valid for what they tested, but each contract only covered ONE failure mode of a criterion that had multiple.
- **Criteria affected**: #638 c1/c3/c4 — full-view error rendering for new sessions; bubble works, full view doesn't.
- **Root cause**: acceptance-contract picks one failure mode per criterion. For #638 the criterion "error visible in full view" spans (resumed session × selected) × (new session × selected) × (new session × selection-cleared) × (new session × pre-listener-subscribe race) — at least 4 modes. Each round wrote a contract for one mode, fixed it, declared done; smoke uncovered the next mode. The bubble works as a fallback because it has its own independent render path that catches transient state.
- **Suggested fix**: acceptance-contract rubric MUST enumerate plausible failure modes (cold vs warm, new vs resumed, fast vs slow async, selected vs cleared) and write a test that covers the worst-case combination. A single mode is insufficient for any user-visible criterion. Pattern threshold: 2 rounds of C2 divergence on the same issue triggers a forced "enumerate modes" step in the next contract pass.

## 2026-05-20 — PR #617/#633 focused 4-fix batch — Partial smoke

- **Result**: smoke FAIL (4 items: 2 #628 rendering, 2 #632); verification claimed PASS — divergence
- **Category**: C2 dominant (wrong contract — passed unit, failed reality) + C1×2 (missing contract for layout/role-filter)
- **Criteria affected**: #628 truncation, #628 user-message visibility, #632 Gemini 3 Flash silent-close, #632 curated-visibility picker mismatch
- **Root cause**: acceptance-contract chose the easier-to-mock SDK branch (`{}`) instead of the worst-case (data + session-close); verification-gate's smoke probes covered only /health, not feature endpoints (/agent-models/visibility, /agents/models/catalog) where the real bug lived; #628 contract didn't enumerate layout or role-filter invariants.
- **Suggested fix**: acceptance-contract rubric must enumerate 2-3 plausible failure modes and pick the worst; verification-gate must curl feature endpoints (not just health); orchestrator's smoke-handoff must pre-run every curl/ps/Computer Use check itself.

## 2026-05-19 — PR #617 batch (20 smoke-test follow-ups) — Partial smoke

- **Result**: smoke FAIL (5 issues + 2 fresh bugs); verification claimed PASS — divergence
- **Category**: C1 (missing contract) dominant; C3 ×2, C5 ×1, C6 ×2, C7 ×2
- **Criteria affected**: #620 live-sync, #625 cold-bubble, #623 task-context, #622 question-tool, #610 slash-popover, OpenRouter no-answer, AppDelegate launch
- **Root cause**: orchestrator skipped acceptance-contract for the entire batch; verification-gate smoke probes hit the source dev server, not the bundled :4001 the Flutter app actually spawns.
- **Suggested fix**: make acceptance-contract a hard gate before coding-agent dispatch for smoke-test-followup runs; add a bundled-artifact smoke probe to verification-gate that curls /sync/now and /health against the spawned :4001 after a clean dist build.

## 2026-05-19 — PR #621 — agent FK tolerance

- See `.agent-stack/postmortems/2026-05-19-pr-621-agent-fk-tolerance.json`.

## 2026-05-26 — Run PR #642 (issues #626/#629/#631/#476/#48) — smoke PASS

- **Result**: smoke PASS (verification claimed PASS; no divergence). #631 PASS, #626 PASS, #629 unverified-by-smoke.
- **Category**: none (correctness). Key structural finding below.
- **Structural finding**: #629's *live* path (task-ready bubble → Open Chat → context note) is un-smokeable under `RHYTHM_LOCAL_SMOKE=1` because #476 disables `AgentTriggerWatcher` by design. Safe-smoke and trigger-dependent verification are mutually exclusive in one run.
- **Suggested fix**: add a local synthetic-trigger injection path so trigger-dependent flows can be smoked without production polling.
- **Triage note**: 4 of 5 issues were already implemented on `main` and just never closed (#626, #476, and the linkage half of #629; #48 sub-changes 1/2/4). Pattern worth watching — "open issue already satisfied on main."
- **Discovered unrelated bug (C6)**: task collaborator ("Visalia CRC") does not persist on save in the task inspector → no claude-trigger → no bubble. Not in PR #642 diff; needs its own investigation issue.
- See `.agent-stack/postmortems/2026-05-26-run-642.json`.

## 2026-05-30 — Staff guide + download proxy (PR #660) — smoke PASS

- **Result**: smoke PASS (user: "works great"); verification claimed PASS; no divergence. Live `rhythmguide.vcrcapps.com` gated by Cloudflare Access, `/download/mac` delivers `Rhythm-macOS.dmg` from the private GitHub release.
- **Category**: none (correctness). W-issues recorded below.
- **Workflow finding (W1 ×1, W3 ×1)**: Three chain steps (`coding-agent`, `verification-gate`, `project-state-updater`) executed in-process but were never invoked via the `Skill` tool. Their substance ran (artifacts exist on disk, evidence captured) but the Guard 5 contract — "When executing a chain step in-process, invoke the skill via the Skill tool" — leaked. `failure-postmortem` itself WAS Skill-invoked, proving the discipline is enforceable; it just isn't consistently applied for "feels small" steps. TodoWrite contained 6 phase-level orchestrator items rather than skill-checklist expansions (W3).
- **Suggested fix**: Tighten Guard 5 in `workflow-orchestrator/SKILL.md` so the in-process bypass requires emitting the Skill-tool call before the in-process work, not after-the-fact. Pre-summary self-audit (Guard 6) is the existing backstop but didn't fire because no completion-language summary referenced the skipped skills by name — they were referenced as "Phase N" task labels instead. Consider expanding Guard 6 to match generic chain-step language ("verification PASS", "project memory updated"), not just literal skill names.
- See `.agent-stack/postmortems/2026-05-30-staff-guide.json`.

## 2026-05-26 — Issue #645 — agent badge updated in only 1 of 4 render sites
- **Result**: smoke FAIL (verification claimed PASS) — #643 in the same PR passed
- **Category**: C2 — wrong contract (widget tested in isolation, not composing views)
- **Criteria affected**: issue-645-c2
- **Root cause**: The fix + contract test exercised `_AgentKindBadge` via a test harness, but the badge renders in 4 sites (`_SessionRow`, `_ResumableSessionRow`, `_TranscriptHeader`, and `agent_bubble_overlay`); only `_SessionRow` was threaded with `providerId`, so header + bubble showed a stale/optimistic agent ("Gemini CLI") while the session was actually Claude.
- **Suggested fix**: Cross-cutting UI contracts must enumerate every render site and assert each composing view; thread the resolved-agent logic into all 4 sites (and reconcile optimistic model selections that error/don't persist).

## 2026-06-11 — PR #676 (#674/#675) — planner scheduledDate smoke FAIL: stale Synology container

- **Result**: smoke FAIL (verification claimed PASS)
- **Category**: C5 — environment issue (deploy gap, not code)
- **Criteria affected**: issue-675-c3, issue-674-c5
- **Root cause**: "API Deploy (Synology)" workflow only publishes the image to GHCR; the manual `docker compose pull && up -d` on the NAS was never run, so production served pre-#674 code. Orchestrator claimed "deploy is live" off a /health 200 that cannot identify code version (W5).
- **Suggested fix**: expose build commit in /health for one-curl deploy verification; rename or extend the publish workflow.
  - **Resolved 2026-06-11**: user ran `docker compose pull && up -d` on the NAS; re-smoke PASS (Wednesday task landed in Wednesday column). C5 diagnosis confirmed — no code change. Deploy-verifiability follow-up: #677.

## 2026-06-11 — Issue 677 + watchtower label — deploy-verifiability smoke PASS

- **Result**: smoke PASS (verification claimed PASS — no divergence)
- **Category**: none
- **Criteria affected**: issue-677-c1/c3 closed live (production /health returned commit 3313c97 + builtAt after NAS pull); watchtower-rhythm-api-c4 (auto-update without SSH) is the one open criterion, observable on the next api_server merge.
- **Root cause**: n/a — clean run.
- **Suggested fix**: n/a.

## 2026-06-24 — agent-question-hang (bug) — ask-question handshake + dark-mode card

- **Result**: smoke PASS (both the hang fix and the in-session dark-mode follow-up)
- **Category**: none (correctness). Process: P4 (issue_638 SharedPreferences async-after-completion flake, unrelated, de-flaked in 4b66c3f) + a noted local-verification-scope gap (Flutter verify scoped to test/features/agents/ vs full CI run).
- **Criteria affected**: agent resumes after answering (PASS); dark-mode rendering (caught by smoke, fixed in-session via context.rhythm tokens, re-smoked PASS).
- **Root cause**: opencode answers its `question` tool via a dedicated Question API (question.asked + POST /question/{id}/reply), not session.input — Rhythm replied via session.input so the tool hung at status:running forever. Card was also hardcoded to light-theme colors.
- **Suggested fix**: smoke handoffs for mid-agent-session UI changes (un-screenshot-able by verification-gate) should explicitly request light+dark verification so theming defects surface on the first smoke.

## 2026-06-26 — PR #749 agent-fixes (#742 #743 #745 #746 #747 #748) — 6-issue agent-subsystem run

- **Result**: smoke PASS (no divergence). AI UI smoke: 4 runtime PASS (#747 endpoint+is_system exclusion, #743 nesting-schema + #743 no-flood, #748 Chrome reuse), 3 not_checked (#745/#746/#742 UI click-through) — blocked by a macOS screen-recording consent modal, NOT a defect; code confirmed present for all three.
- **Category**: none (correctness). Process: `ai-smoke-blocker` (consent modal blocks computer-control clicks to Flutter canvas — needs one-time human Allow); `release-runtime` (installed app was spawning STOCK opencode not the bundled fork — path-depth bug, fixed 962f1ac4e).
- **Workflow**: partial — W5 (#746 coding-agent committed + opened PR #749 prematurely against `main` before #748 and before orchestrator verification-gate), W6 (wrong PR base), W4 (first coding-agent edited home-dir secretary.md instead of the version-controlled opencode_agent_writer). All recovered by the orchestrator.
- **Root cause (process)**: coding-agent dispatches did not hard-honor "do not commit / do not open PR"; subagents chained the full workflow autonomously.
- **Suggested fix**: sharpen coding-agent boundaries (no commit/PR when dispatched as an implementation-only subagent) and add a "never edit ~/.config runtime paths — find the version-controlled writer" rule for opencode agent-profile changes.

## 2026-06-27 — Issue #752 — v18.52 terminal fix regressed the engine launch

- **Result**: smoke FAIL (verification claimed PASS)
- **Category**: C1 — missing contract (no local check that the signed binary launches)
- **Criteria affected**: Agents Terminal opens a working shell in the release build
- **Root cause**: Signing the opencode bun binary with disable-library-validation ALONE turned on Hardened Runtime JIT enforcement; without allow-jit + allow-unsigned-executable-memory the binary SIGTRAP-crashed in dyld at launch (exit 133, "Server exited with code null"). v18.51 had no entitlements blob so it launched.
- **Suggested fix**: For codesign/entitlements changes to a bundled bun/JIT/standalone binary, verification-gate must run a local hardened-runtime launch+behavior test (cp; codesign --options runtime --entitlements <f> -s -; run; exercise feature). Presence ≠ correctness. Fixed in #756 (v18.53).

## 2026-06-27 — Issue 751 — "stuck on Starting" is a fork-engine /event regression, not the bridge map-miss
- **Result**: smoke FAIL (verification claimed PASS) — divergence
- **Category**: C5 — Environment/runtime-parity; plus process: release-deploy (fork binary regression), W5 (PASS claim on non-representative runtime)
- **Criteria affected**: issue-751-c1 (session leaves "Starting", messages persist, child appears)
- **Root cause**: The bundled fork opencode engine (0.0.0-main-202606271725) emits only `server.connected` on /event then no session/message events; the bridge listener loop ends and nothing is relayed. Verification "passed" because the live repro accidentally used the STOCK 1.14.40 engine (PATH augmentation prepends ~/.opencode/bin), which emits events correctly.
- **Suggested fix**: (1) opencode-dependent verification/smoke MUST spawn the bundled fork engine, not PATH/stock opencode; (2) fix the fork /event SSE regression in apps/opencode_fork. The api_server map-miss fix (PR #758) is correct defense-in-depth but does not resolve #751.

## 2026-06-27 — Issue 759 — /event fix verified; user-facing symptom persists in Flutter UI layer
- **Result**: smoke FAIL (user-visible) — but verification claimed PASS for #759 and was CORRECT at the engine/bridge/DB layer
- **Category**: C6 — Dependency failure (failing area not in this PR's diff)
- **Criteria affected**: assistant responses render in Flutter UI (out of #759 engine scope)
- **Root cause**: #759 engine /event collapse is fixed (stream stays open, status→idle, 2 messages persisted, bridge broadcasts over WS keyed by correct UUID); Flutter client did not surface the broadcast message events in the rendered list/context panel
- **Suggested fix**: follow-up issue on the Flutter agents client WS-ingestion/rendering of message.part/message.updated; verify #759 + #758 together for full UX

## 2026-06-27 — secretary-profile-scope — Secretary session loads ALL MCP servers despite scope fix

- **Result**: smoke FAIL (user-visible) — verification claimed PASS (73 targeted + TypeScript)
- **Category**: C2 — Wrong contract (false negative); secondary W5 (verification-gate trusted a boundary-only mock)
- **Criteria affected**: issue-secretary-profile-scope-c1 ("excludes servers not allowed by that profile")
- **Root cause**: c1's integration test mocks opencodeClient.createSession and only asserts mcpRoleConfig was passed; it never asserts the running fork session actually excludes disallowed servers. Scope commit a30510f44 touched only agent_sessions_controller.ts (+11 lines) — sends config but the initial fork session does not enforce it, so a real new Secretary session shows all servers.
- **Suggested fix**: acceptance-contract must require an end-to-end assertion against a real/fake fork session's resolved MCP tool set (exclusion verified), not just the argument handed to a mocked createSession.

## 2026-06-27 — mcp-scope-04 — REST-first interactive session bypasses profile scope

- **Result**: smoke FAIL (verification claimed PASS) — divergence
- **Category**: C2 — wrong contract
- **Criteria affected**: mcp-scope-04 AC-03
- **Root cause**: `POST /agent-sessions` creates the opencode session using only
  an explicit legacy `mcpRole`; profile-derived scope is resolved later in
  `ws_gateway`, after the engine session already exists. AC-03 treated a
  `createSession` helper test as interactive-path proof without exercising this
  lifecycle.
- **Suggested fix**: add a full-stack POST contract for a scoped Agent Profile
  and resolve profile scope before the controller's initial engine-session
  creation.

## 2026-06-27 — Issue 764 — SyncEvent dual-bus split fixed; smoke PASS
- **Result**: smoke PASS (verification claimed PASS — no divergence)
- **Category**: none (correctness); process: smoke-environment ×2; workflow: W3 (host TodoWrite unavailable, Task tools used)
- **Criteria affected**: issue-764-c1 (pass/pass)
- **Root cause**: namespace Bus and per-request DI Bus.Service held separate per-directory wildcard PubSubs; SyncEvent publishes never reached /event. Fixed via a shared module-level Map<directory,State> read-through in bus/index.ts.
- **Suggested fix**: provide a dev-smoke launcher that frees :4096, refuses a competing :4000 engine server, and stages+verifies the freshly-built fork at apps/api_server/opencode_bin/opencode before launch (engine-change smokes otherwise risk running the stale system binary or failing on port contention).

## 2026-06-28 — Issue #775 — per-agent skill scoping (smoke PASS)

- **Result**: smoke PASS (verification claimed PASS; no divergence)
- **Category**: none (correctness); W5/W1 on the first pass — false-green caught by user
- **Criteria affected**: all 3 pass; live end-to-end (restricted session refuses out-of-scope skill load) confirmed on the running fork
- **Root cause**: skills are served by the opencode FORK (skill tool + system-prompt listing), not api_server's buildSkillsPreface; per-profile allowed_skills_json never reached the engine — the #765 shape. First verification attempt tested the inert api_server path (C2 false green).
- **Suggested fix**: when a capability is served by the bundled fork, the acceptance contract must exercise the fork (built binary / fork unit test), not the api_server preface; a green api_server unit test for such a criterion is presumptively a false green.
- **Process notes**: missing-migration bug surfaced ONLY by building+running the binary (build-verification); hardcoded picker drift — 4/14 picker names match the 79 real discovered skills (→ #777 + unification plan).

## 2026-06-29 — Local Ollama skill guard — native tool blocked by MCP scope

- **Result**: smoke FAIL (verification claimed FAIL; no divergence)
- **Category**: C1 — missing contract
- **Criteria affected**: role-scoped sessions must allow OpenCode-native tools while limiting MCP tools to the selected servers
- **Root cause**: `OpencodeStreamBridge` applied `mcpAllowedToolsJson` to every tool name, so Secretary's `["rhythm","obsidian"]` MCP scope falsely rejected the native `skill` tool even though the fork's skill allowlist permitted `daily-morning-briefing`.
- **Suggested fix**: contract-test native OpenCode permissions and MCP-server dispatch as separate capability boundaries.

## 2026-07-02 — Run #882 — boot-only defects escaped a green verification-gate
- **Result**: smoke FAIL (verification claimed PASS) — divergence=true
- **Category**: C1 (missing contract: "boots cleanly") + C2 (#857 "cron OFF" claim unverified)
- **Criteria affected**: clean-boot; #857 cron-off
- **Root cause**: verification-gate ran build+unit+analyze but never BOOTED the server, so startup-only issues were invisible — (A) reloadSkills ECONNREFUSED before the engine listens; (B) #856 auth watcher self-bouncing on its own OAuth access-token refresh (raw-byte compare). Separately, #857's coding-agent claimed the optimizer cron was "off by construction" without booting to verify — it was seeded-ON.
- **Suggested fix**: add a boot-smoke to verification-gate for server-spawning repos (launch backend against the real engine; assert zero error-level lines + no spurious restart in first N seconds). Coding-agents must not assert runtime state ("cron off") without a boot check.

## 2026-07-02 — Run #882 UI smoke — 5 of 7 items fail-then-fixed despite green suites
- **Result**: smoke FAIL→fixed in-run (verification claimed PASS) — divergence=true
- **Category**: C2 (wrong contracts) dominant
- **Root cause**: contract tests modeled fixture-convenient environments, not production shape — legacy-only vault layout (#886), engine directory-scoping (#861), generic-agent child rows (#867), empty-cwd test fake (#863), no user-feedback assertion (#863).
- **Suggested fix**: acceptance contracts must pin the PRODUCTION environment (clean layout env vars, real id spaces the UI sends, delegated-row shapes); verification-gate's boot-smoke should include one interactive-path probe per changed surface.

## 2026-07-03 — Issue 888 — quick action spawned wrong manager (workflow-orchestrator, not secretary)

- **Result**: smoke FAIL (verification claimed PASS)
- **Category**: C2 — wrong/fixture-convenient contract
- **Criteria affected**: quick-action → Secretary
- **Root cause**: fix resolved agentId from `managerAgent` (first isManager match), but production has TWO managers (secretary + dev workflow-orchestrator); the widget test's fake overrode `managerAgent` to a lone secretary, so it passed while real multi-manager resolution picks workflow-orchestrator.
- **Suggested fix**: resolve Secretary by its stable slug via a dedicated `secretaryAgent` getter; regression-test the real getter with two managers (workflow-orchestrator first).

## 2026-07-03 — Issue 889/890/891 — delegation regression: wrong tool + inert catalog-gated default

- **Result**: smoke PASS (after fixes; divergence caught in live UI smoke)
- **Category**: C2 — tests codified the wrong mechanism (fixture-convenient / prompt-text assertions)
- **Criteria affected**: Secretary delegation nesting (#891); session-picker default = Secretary (#890)
- **Root cause**: (a) #889 hub preamble delegated domain work via the rhythm_delegate MCP tool (orphan top-level session) instead of engine-native `task`/subagent_type (nests); (b) #890 resolved the default by searching _catalog (engine kinds only), so the profile default was inert → fell to the ambiguous first manager. Both had GREEN unit tests that asserted the wrong thing (presence of 'rhythm_delegate'; a faked 'secretary' catalog entry).
- **Suggested fix**: agent-behavior changes (prompt/preamble, runtime-shape-dependent resolution) need live/integration outcome probes, not unit assertions on prompt text or fixture-convenient catalogs.
## 2026-07-10 — Issue 1007 — scheduler bypasses prompt-derived naming

- **Result**: smoke FAIL (verification claimed PASS)
- **Category**: C2 — wrong contract
- **Criteria affected**: scheduled/headless session name derives from prompt
- **Root cause**: AgentScheduler supplies an explicit `Scheduled: <task name>` sessionName, so the tested AgentRunner fallback never runs on the real scheduled path.
- **Suggested fix**: Trigger a real schedule in the contract and assert the persisted session name.

## 2026-07-10 — Issue 1014 — roster reload is inert in an open session

- **Result**: smoke FAIL (verification claimed PASS)
- **Category**: C2 — wrong contract
- **Criteria affected**: next task call in an already-open manager session uses the edited roster
- **Root cause**: the regression test asserted only that reloadConfig was called; the running session retained the old task permission rules.
- **Suggested fix**: Contract must make a denied task call, PATCH the roster, then make an allowed task call in the same engine session.

## 2026-07-10 — Issue 997 / Plan B — real discovery judge drops every candidate at 0/0

- **Result**: smoke FAIL (verification already recorded incomplete)
- **Category**: C1 — missing contract
- **Criteria affected**: open gap → real candidate → gated external-adoption proposal
- **Root cause**: production `scoreSkillBody` returned zero for both downloaded candidate and would-be draft, so the strict-greater gate silently dropped all otherwise-valid candidates.
- **Suggested fix**: Require a known live candidate to produce a nonzero comparative score and proposed row; keep the direct approve→install→measure probe as a separate downstream contract.

## 2026-07-11 — Issue #1002 (USO epic PR #1036) — verification probe missed the real scheduled-task path
- **Result**: smoke PASS 5/5 for the epic's own scope (verification claimed PASS) — BUT divergence: the #1002 user-symptom ("background runs produce no output") still reproduced on real profile-bound scheduled tasks during manual smoke.
- **Category**: C1 — Missing contract/coverage (verification-gate live probe used the optimizer-diagnosis entry point, which passes no profile ocAgent, and thus avoided the ocAgent/mode + primary-empty-output causes the user's real tasks hit).
- **Criteria affected**: issue-1002-headless-output (real scheduled-task path).
- **Root cause**: A multi-cause user symptom ("scheduled runs fail") was verified via one convenience entry point; the cwd cause was genuinely fixed, but ocAgent-mode ("Agent not found") + primary empty-output were untouched and uncovered. Also: the fix itself had been silently dropped from main by the #1020 partial re-land.
- **Suggested fix**: verification-gate must drive the REAL user entry point (profile-bound scheduled task via trigger-now) for multi-entry-point symptoms; run acceptance-contract per-issue even in large epics. Follow-up: #1039.
- **Workflow note**: W1 — acceptance-contract folded into coding-agent dispatch prompts instead of emitting per-issue contract.json + failing tests (13-issue epic).
## 2026-07-25 — Issue #1132 — built generated-SDK event smoke PASS after compiled-runtime recovery

- **Result**: smoke PASS (verification claimed PASS; no final divergence).
- **Category**: none for correctness. Process issues: compiled-runtime-coverage, live-smoke-fixture, and worktree-dependency-isolation.
- **Criteria affected**: issue-1132-c6 initially blocked; all c1-c6 pass after recovery.
- **Root cause**: Source-only containment tests and a binary `--version` check did not execute the split bundle's late `AppFileSystem.containsReal` namespace member, so a real bash call failed before permission evaluation. Two fixture defects obscured the path: a `#`-prefixed label hit #1134's unquoted YAML bug, then an omitted `ocAgent` silently ran built-in `build` permissions.
- **Suggested fix**: Keep a built/minified live test that binds the projected agent explicitly and exercises a real permission ask. For worktrees, verify internal workspace symlinks resolve inside that worktree before building.
- See `.agent-stack/postmortems/2026-07-25-issue-1132.json`.

## 2026-07-24 — Issue 1135 — audit-locked profiles remain inert until reviewed re-enable

- **Result**: smoke PASS (verification claimed PASS; no divergence)
- **Category**: none (correctness); process: sandbox-dependency-setup + sandbox-process-lifetime + aggregate-test-flake + smoke-wrapper-cleanup
- **Criteria affected**: issue-1135-c1 through issue-1135-c6 all passed
- **Root cause**: The security gap was an ordinary `enabled` preference with no independent audit lock; the smoke harness also needed fresh fork dependencies and foreground process ownership in this worktree.
- **Suggested fix**: Keep the dedicated optimistic reviewed transition and authoritative lock checks; teach the sandbox launcher pinned dependency setup and a foreground mode. Two unrelated aggregate-only HTTP failures each passed in isolation and on clean aggregate reruns; investigate full-suite resource contention if the coordinator gate sees another.

## 2026-07-25 — Issue #1137 — picker/discovery false-positive gate

- **Result**: initial smoke/verification claim invalidated by independent review.
- **Category**: C1 — missing contract.
- **Criteria affected**: issue-1137-c1 and issue-1137-c2.
- **Root cause**: The contract stopped at empty picker filters and persistence of a synthetic instruction. It never drove an arbitrary browser binary through `createPromptAttachments`, never checked Flutter's binary `@mention` fast path against traversal/symlink input, and never asserted a concrete reader candidate. The fork still rejected arbitrary binaries after selection, while Flutter bypassed the API realpath guard.
- **Suggested fix**: Picker contracts must drive post-selection consumption through request construction and the built engine. Binary workspace references must use a server-returned canonical contained path. Reader-discovery live gates must install and observe a concrete matching reader, plus cover browser data URLs and pre-prompt symlink rejection.
- **Repair result**: The expanded built live gate caught a second defect after the independent-review fixes: generic `rhythm` token matches alphabetically crowded the exact `rhythmfixture-reader` out of the surfaced top five. A noisy-catalog regression now forces exact extension/MIME matches to rank first; the final standalone-engine gate passed native + browser consumption, exact reader surfacing, and symlink rejection.
- See `.agent-stack/postmortems/2026-07-25-issue-1137.json`.

## 2026-07-24 — Issue 1096 — signed Semantic Memory sandbox smoke

- **Result**: smoke PASS (verification had correctly remained incomplete pending the live and signed-client gates)
- **Category**: none — no correctness divergence; process: sandbox-port-isolation
- **Criteria affected**: c3, c5, c7-c15, c17-c18, c20 passed in the live/signed smoke; the remaining criteria retained automated contract evidence
- **Root cause**: the feature branch predated alternate sandbox-port support, so the already-reviewed coordinator patch was applied only for the isolated run and restored byte-for-byte afterward.
- **Suggested fix**: land alternate-port sandbox support before the next parallel live workstream so branch verification never needs a temporary launcher patch.

## 2026-07-24 — Issue #1123 — interactive async delegation (smoke PASS)

- **Result**: smoke PASS (verification claimed PASS; no divergence)
- **Category**: none
- **Criteria affected**: issue-1123-c1 through issue-1123-c6
- **Root cause**: no product failure; the first live-test lineage assertion mixed local database session IDs with the engine SDK identities returned by `/children`, then passed after failure triage corrected the identity domain.
- **Suggested fix**: live contracts crossing local and engine session surfaces should declare the identity domain of every endpoint before asserting lineage.

## 2026-07-25 — Issue #1171 — desktop-to-iPhone pairing smoke PASS

- **Result**: smoke PASS (verification intentionally remains review-pending; no correctness divergence)
- **Category**: none; process: base-test-regression, native-build-infrastructure, and foundation-manifest-drift
- **Criteria affected**: issue-1171-c1 through issue-1171-c5 passed; c6 awaits immutable independent review
- **Root cause**: Product behavior passed live and native probes; unrelated issue #723 uses a Vitest-incompatible dynamic-import seam, and the reviewed base's OpenAPI source fingerprint drifts from its accepted mobile manifest.
- **Suggested fix**: Retain the live exchange/native deep-link probes, review the immutable pairing commit independently, and repair #723 plus the base manifest drift in their owning slices.
- See `.agent-stack/postmortems/2026-07-25-issue-1171.json`.

## 2026-07-24 — Issue 1164 — real 50-reader scheduler swarm

- **Result**: smoke PASS (verification correctly remained incomplete until the live run)
- **Category**: none — no correctness divergence; process: sandbox-exec-lifetime, live-fixture-drift, api-test-shared-state
- **Criteria affected**: c1 and c10 passed live; c2-c9 retained focused deterministic contract evidence.
- **Root cause**: the product scheduler was sound, while the first launcher cell reaped its sandbox child, the live fixture used a stale catalog shape/model, and the parallel API merge gate exposed shared-state/timeout flakes.
- **Suggested fix**: keep sandbox guardian sessions active, intersect live model selection with the running engine, and retain the serialized 15s-budget API merge gate.

## 2026-07-25 — Issue #1170 — mobile realtime proxy corrective smoke PASS

- **Result**: smoke PASS (verification had correctly reported FAIL before corrective implementation; no correctness divergence).
- **Category**: none for product behavior; process issues were worktree-dependency-isolation and sandbox-exec-lifetime.
- **Criteria affected**: c2, c4, and c5 passed live; c1 and c3 passed strengthened direct integration contracts; c6 remains pending independent corrective re-review.
- **Root cause**: product behavior passed after fatal SSE errors were made terminal, real engine session event shapes were recognized, and legacy unauthenticated WebSockets were restricted by the actual socket address; the live harness first needed ignored fork dependencies and a guardian process.
- **Suggested fix**: add deterministic dependency bootstrap and a foreground/guardian mode to `tools/dev/sandbox.sh`.
- See `.agent-stack/postmortems/2026-07-25-issue-1170.json`.

## 2026-07-25 — Issue #1171 corrective — identity-bound transactional pairing

- **Result**: smoke PASS (verification had not yet made a final claim; no correctness divergence)
- **Category**: none; process: simulator-fixture-state
- **Criteria affected**: issue-1171-c2 through issue-1171-c6 passed in the native iPhone SE smoke; c1 retained focused API evidence
- **Root cause**: The first replacement probe deliberately preserved the existing local credential when a freshly reset fake gateway no longer contained that old device; resetting local and server fixture state together produced the expected old-device revoke, new-device activation, and final revoke.
- **Suggested fix**: Reset simulator-local pairing and fake-gateway device state atomically before every native replacement smoke.
- See `.agent-stack/postmortems/2026-07-25-issue-1171-corrective.json`.
