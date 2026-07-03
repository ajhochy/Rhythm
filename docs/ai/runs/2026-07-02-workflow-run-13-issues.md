---
date: 2026-07-02
repo: Rhythm
branch: workflow/run-2026-07-02
pr: [882]
issues: [857, 859, 860, 862, 858, 861, 863, 865, 814, 856, 864, 867, 868, 815]
status: PR open, CI green, awaiting review + live smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# 2026-07-02 — Workflow run: 13-issue governance/UX/infra closeout (PR #882)

Finished the open non-mobile backlog the prior mega build-out exposed, plus the
agent-UX and infra hardening the maintainer requested. Parallel worktree-isolated
coding agents (Sonnet, contract-first), folded sequentially into one run branch with
the full check suite between folds, CI watched to green. Mobile #418/#71 excluded.

## Issues (Closes on merge of #882)

- **#857 (CRITICAL):** org-optimizer data-sufficiency guard on tighten/prune (min
  7-day observation window + 10-activity floor, env-overridable via
  `ORG_OPTIMIZER_MIN_OBSERVATION_DAYS`/`_MIN_ACTIVITY_COUNT`); dead-name prune stays
  unconditional; legal `active → reverted` transition + `POST /agent-org-proposals/:id/revert`;
  #831 smoke extended (thin-history → no auto-tighten). Cron #830 stays OFF by construction.
- **#859:** memory merge-on-capture (owner+kind similarity, keeps distinct memories
  distinct), consolidation pass (reversible), memory-interview seed, `forget` 404 fix
  (resolves the ULID `remember` returns — DB-row id vs frontmatter id).
- **#862:** edit-in-place (`PATCH /agent-memory/:id` + `rhythm_update_memory` MCP tool,
  vault + index) + "Memories used in this reply" provenance
  (`agent_session_memory_provenance` + endpoint + panel).
- **#860:** collapsed the two memory stores — migrated 14 entities
  `~/Documents/Claude-Memory/memory.jsonl` → Obsidian AGENT-MEMORY vault (0 loss);
  disabled the standalone `memory` knowledge-graph MCP; idempotent migration + guard.
- **#858:** session-create/resume send the engine `agentConfig.ocAgent` (not the config
  UUID); sync backfills `oc_agent`; `/agents/capabilities` live-name gate;
  `PATCH /agent-configs/:id`.
- **#861:** nested delegation Task-card → child-session nav (child-nav stack, tappable
  nested chips, backend grandchild lookup for raw SDK ids); mounted-surface tests.
- **#867:** dispatched-session UI reflects its own agent + a reply continues as that
  agent (`AgentsController.selectedAgentFor` consults the session's `agentId`, not the
  app-wide picker); mounted-surface tests. (Filed this run from the maintainer's screenshot.)
- **#863:** one-tap staff quick actions (Help me finish / Draft next steps / Summarize /
  Create follow-up tasks) on task inspector + dashboard; reuses the existing
  agent-session path; real linked tasks.
- **#865:** read-only agent-run quality rollup (`run_quality_service`) — completion vs
  escalation, token-waste (distinct from spend), corrections, repeated mistakes +
  plain-language "Report Card" view; thin-history + unmeasured handled.
- **#814:** rhythm MCP launched by bundled path with a pinned-version fallback (never a
  bare `npx` spec); single source of truth in `opencode_client_service.ts`;
  `desktop_release.yml` mcp_server bundling.
- **#856:** `auth.json` watch + engine bounce (`reloadCredentials`, status `reloading`)
  so a Claude account switch no longer needs an app restart; pure `decideReload` unit-tested.
- **#864:** MCP stateless-readiness decision doc (both surfaces) + in-memory guard test.
- **#868:** optional Apple-Silicon oMLX provider (env-gated, no hardcoded paths),
  constrained `local` agent profile (read/glob/grep/edit/bash; MCP/skill/web denied),
  structured-tool-call smoke, Ollama auto-unload.
- **#815:** VERIFICATION-ONLY — feature already on main; live smoke pending (no code in #882).

## Checks (commit 784c7abc7)

- api_server `tsc --noEmit` clean; vitest **1996 pass** / 1 skip / 1 fail.
- The 1 fail is `opc_curated_mcp_ensure.test.ts` c1 — pre-existing #835 machine-local
  sidecar fragility (tracked #881); sidecar is gitignored → **CI clean-runner passes**.
- mcp_server build clean + **59 pass**; Flutter analyze **0 errors** + format clean + **773 pass**.
- CI on PR #882: Server CI ✓, MCP Server CI ✓, Desktop CI ✓ (all green).

## Notes / decisions / deviations

- **Failure-triage (one loop):** the integration full-suite surfaced the curated test
  failing. Triaged to a pre-existing, machine-local #835 sidecar issue (registry file +
  test both byte-identical to main; sidecar gitignored). Verdict OUT OF SCOPE → filed
  #881, continued; confirmed CI-green afterward.
- **node_modules hazard (deviation worth recording):** worktrees symlinked a single
  shared `apps/api_server/node_modules`; wave-1 agents running `npm ci`/`install`
  concurrently raced and stripped `better-sqlite3` mid-run. Repaired with `npm ci`
  between waves; wave-2 agents were given an explicit "deps are ready — do NOT reinstall"
  rule. Future: per-worktree installs or a shared read-only tree.
- **Real side effects executed:** #860 migrated 14 memory entities into the live vault
  and disabled the live standalone `memory` MCP (idempotent). Fork engine rebuilt +
  ad-hoc signed at `apps/opencode_bin/opencode` for #815 live verification.
- **Follow-ups filed:** #867 (folded into this run), #870 (Rhythm can't self-file GH
  issues), #871–#880 (setup-agent wave: doctor/wizard/prompt-injection-scan/skill-env/
  conditional-activation/lazy-deps/supply-chain-scan/command-approval/blank-slate/
  profile-export), #881 (curated test fragility). #869 closed (no secret present — the
  handoff's "plaintext credentials" was a projectId + local endpoints, nothing to rotate).
- Also filed 10 setup-agent issues on the maintainer's behalf (they'd been generated
  locally by a shell-less session as `docs/ai/generated-issues/setup-0*.md` but never pushed).

## Manual smoke round (post-PR, fixes folded into #882)

7/7 items PASS after in-run repairs; every fix pushed + CI green on `8123b222c`:
1. Boot: reloadSkills ECONNREFUSED spam (isReady guard) + #856 self-bounce on token
   refresh (identity fingerprint) + optimizer-cron doc corrected (seeded-ON; decision:
   merge #882 before 02:00).
2. #863: `cwd:''` → 400 (HOME default); "spun then did nothing" → SnackBar +
   navigate-to-session via the #815 pending-nav path.
3. #865 PASS — Report Card surfaced the recurring Gemini 512-function-declaration
   failure → #884.
4. #862: app read the OLD Memory-Vault (env never wired → #885); edit 404 from the
   source_id convention split (#886, fixed + contract test); provenance redesigned into
   the Context tab.
5. #861: child transcript empty (engine reads are directory-scoped → ?directory=
   threading) then redesigned link-first to the EXISTING local child session
   (sdkSessionId on the Flutter model); bash/tool cards default collapsed.
6. #867: child rows persisted agent_kind='claude-code' — specialist now parsed from the
   engine title at upsert + 31 live rows backfilled; identity + reply binding verified.
7. #815 verified live (question tool → macOS notification → click-to-focus) — CLOSED.

Postmortems: `.agent-stack/postmortems/2026-07-02-issue-882-run-smoke.json` (boot) +
`2026-07-02-issue-882-ui-smoke.json` (UI round; C2-dominant — contracts modeled
fixture-convenient environments, not production shape).
Also filed/closed this round: #883 (secretary delegation gap, corrected), #884, #885,
#886 (fixed in-run), #869 closed (no secret), #870–#881 (see above).
