# Failure Patterns

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
