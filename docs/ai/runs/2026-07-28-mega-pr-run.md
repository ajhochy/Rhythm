---
date: 2026-07-28
repo: Rhythm
branch: mega/run-2026-07-28
pr: TBD (draft MEGA PR against main)
issues: [1208, 1213, 1214, 1215, 1216, 1217, 1218, 1220, 1221, 1222, 1223, 1232, 1233, 1234, 1236, 1239]
status: verified — awaiting human review + manual smoke
tags: [run, Rhythm, mega-pr]
index: "[[Rhythm]]"
---

# 2026-07-28 MEGA PR run — triage → parallel Codex/Claude implementers → live-verified integration

## Shape of the run

- **Triage:** 10 Haiku readers classified all 37 open issues against origin/main `16d222788` (post-#1165).
  - Closed: #1096 (verified shipped: WP1 `e31d6890d` PR #1130, WP2 `78f53423b`).
  - In-run (16 shipped): see frontmatter.
  - Excluded (human/hardware/product gates): #1037, #1076, #1175, #1176, #1177, #1178, #1197, #1198, #1199, #1200.
  - Deferred by planner (overlap/scope): #1170, #1171, #1172, #1173, #1231 (iOS epics overlapping this run's corrective issues), #1209 (needs fork rebuild cycle), #1219 (design-first; partially overlaps shipped MEM-OKF).
- **Implementation:** one isolated in-repo worktree per group under `.worktrees/` (Codex sandbox cannot write outside the repo dir or bind sockets — worktrees moved inside; verification centralized with the orchestrator). Implementers: Codex gpt-5.6-sol (9 groups) + Claude Sonnet subagents (scheduler group + profile-editor repair/test-migration, after the Codex queue produced a zombie task and two silent launch failures).
- **Verification model:** contract-first tests written failing-first per issue; orchestrator ran full suites per worktree, bounced regressions back as repair loops with distilled evidence, committed only green branches, merged sequentially into `mega/run-2026-07-28`.

## Branch → issue map (all merged)

| Branch | Issues | Key verification |
|---|---|---|
| mega/memory-1218-1215 | #1218 #1215 | api suite green; live: fresh boot activates v2 prompt, curated>synthesis ranking (2/2 live) |
| mega/mcp-status-1216-1217 | #1216 #1217 | doctor/setup hermetically stub live probe; live: fail-fast + doctor live status (2/2) |
| mega/mcp-catalog-1220-1221 | #1220 #1221 | required-env check independent of transport status; mcp-7-c1 restored |
| mega/proposals-1223 | #1223 | catalog-unavailable fallback preserves #822/#936/#1139; live approval grants capability (1/1) |
| mega/mobile-access-1239 | #1239 | flutter 1012/1012; pairing endpoints fail closed (401) live |
| mega/gallery-1208 | #1208 | qlmanage poster pipeline (no new deps), 5s bound; real poster generated in tests |
| mega/mobile-agents-1232 | #1232 | e2e 48/48 after visibility/Activity-entry repair |
| mega/mobile-modelpicker-1233 | #1233 | e2e 47/47; tsc literal-widening + spec expectation fixed |
| mega/mobile-tools-1234 | #1234 | e2e 52/52 after fake-server fixture-leak repair |
| mega/profile-editor-1236 | #1236 | flutter 996/996; pill-drawer tests retired per contract c1, #906 warning coverage migrated |
| mega/scheduler-1213-1222-1214 | #1213 #1222 #1214 | live: local routing (prod stub got 0 requests), ownerless task success, Postgres quarantine |

## Final integration gate (branch tip `6fe8edda9`)

- api_server: `npm test` → 3631 passed / 105 skipped / 1 failed (`issue_1186_sandbox_foreground` — pre-existing load-sensitive flake, fails on unmodified main too; filed #1240). `npm run build` exit 0.
- mcp_server: vitest 108 passed / 2 env-gated skipped; tsc clean.
- desktop_flutter: full `flutter test` + `flutter build macos --debug` (results in PR body).
- apps/mobile: `test:ci:static` + Playwright e2e vs fake-opencode (results in PR body).
- `ai-workflow checks --level issue`: exit 0.
- Live gates ran against isolated dev sandboxes (`tools/dev/sandbox.sh`; real-DB-copy sandbox for 1216/1217, schema-only fresh-DB sandbox for 1223/memory; scheduler group ran its own sandbox + throwaway Postgres container).

## Gotchas recorded (reusable)

- Codex runtime sandbox: writes only inside the repo dir; `listen EPERM` on any socket; Flutter SDK cache not writable. Put worktrees in-repo (`.worktrees/`, git-excluded) and centralize suite/live verification outside Codex.
- Codex queue reliability: one zombie (registry said running/verifying, log+worktree dead 90+ min) and two silent launch failures (task id returned, no state files ever created). Check `~/.claude/plugins/data/codex-inline/state/<repo>/jobs/` mtimes, not just status.
- `api_server` binds a fixed auxiliary port 4002 (mobile gateway) regardless of sandbox ports — two sandboxes cannot coexist unless `RHYTHM_MOBILE_GATEWAY_PORT` is overridden.
- `sandbox.sh` requires the fork built (`bun install` in apps/opencode_fork first on a fresh worktree) and a schema-bearing DB (schema-only sqlite works for a "fresh install" sandbox via `RHYTHM_LIVE_DB_PATH`).
- apps/mobile e2e uses fixed ports 44096 (fake server) + 19006 (web export) — serialize runs across worktrees.
- Doctor unit tests must stub `mcpLiveStatus` — the #1217 live probe defaults to `127.0.0.1:4001`, which on a dev machine is the user's real running agent server.
- Live e2e guards must not pin specific ports; assert localhost + not-4000/4001 + `RHYTHM_LIVE_E2E_ISOLATED=1`.
- The issue-1233 contract test evals the selectors TS file as plain JS — no TS-only syntax (as const, annotations) inside `selectModelPickerGroups`.

## Follow-ups filed

- #1240 — flaky `issue_1186_sandbox_foreground` under machine load.

## Residual risks / manual smoke

- Desktop visual click-through (Settings→Mobile Access, Gallery MP4 posters, Agent Profile capability editor) deferred to human manual smoke — the user's live Rhythm app owns the singleton runtime surfaces (port 4001, real DB), so the orchestrator did not launch a second desktop instance. Widget/e2e-level rendering is asserted for all changed surfaces.
- iOS-native visuals (keyboard, Dynamic Type) not covered — corrective issues #1237/#1238 remain open by design; mobile behavior verified via Playwright e2e on the web export against the fake engine.
- #1214 quarantines future prod scheduler ticking only; reconciling existing legacy production rows is a documented manual operator step (see docs/release/hosted_deployment_synology_cloudflare.md).
