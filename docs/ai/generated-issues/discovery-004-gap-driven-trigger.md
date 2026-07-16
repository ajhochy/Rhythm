# Discovery-004: Make discovery capability-gap-driven, not timer-only

## Goal

Turn external discovery from a weekly-timer job into a responsive, gap-driven process: when a capability gap is recorded, schedule a debounced discovery pass to try to *find* a skill for it, instead of waiting up to a week. Drain the existing backlog of 152 open gaps. This is what makes "found" the primary acquisition path rather than an occasional batch.

## Context

Discovery is already gap-driven in structure — `discoverCandidatesFromEcosystem` filters to `kind === 'capability-gap'` and early-returns `[]` when there are none (`external_discovery_search.ts:269-270`) — but it is only *invoked* from the cron-driven optimizer pass, and it runs **last under a shared proposal cap** (`org_optimizer_run_service.ts:340`, `if (newlyCreated.length < maxProposalsPerRun)`), so a busy run can exhaust the budget before discovery runs.

Gaps are written on a narrow harvest branch (`skill_extractor.ts:631-646`, `insertIfAbsentAsync` `:637`) only when reuse/auto-wire finds no existing match. Live DB shows **152 of 153 gaps `open`, 1 resolved** — a ready backlog that nothing is consuming. Resolution closes the loop on adopt+keep (`org_proposal_measure.ts:473-476`, `resolveByDedupKeyAsync`); revert leaves the gap `open` (`agent_capability_gaps_repository.ts:185-191`).

## Likely files

- `apps/api_server/src/repositories/agent_capability_gaps_repository.ts` — `insertIfAbsentAsync` (`:637` call), `listOpenAsync`, `resolveByDedupKeyAsync` (`:185-191`)
- `apps/api_server/src/services/skill_extractor.ts` — gap-write branch (`:631-646`)
- `apps/api_server/src/services/org_optimizer_run_service.ts` — Stage B discovery (`:333-351`), shared cap (`:340`), `runOrgOptimizer` (`:202`)
- `apps/api_server/src/services/generators/external_discovery_search.ts` — `discoverCandidatesFromEcosystem` (`:268-270`)
- NEW: a debounced discovery scheduler (reuse scheduled-task infra or an in-process debounce keyed by gap batch)

## Acceptance Criteria

- [ ] **Gap-triggered discovery:** inserting a new open capability gap schedules a discovery pass for that gap (or a debounced batch of recent gaps), rather than relying solely on the weekly cron. Debounce window is a documented config constant (e.g. coalesce gaps for N minutes into one pass).
- [ ] **Discovery not starved by the shared cap:** discovery gets a dedicated proposal budget (or runs before the cap is exhausted) so a busy optimizer pass cannot skip it. Document the budgeting approach.
- [ ] **Backlog drain:** a bounded backfill processes the existing open-gap backlog over successive passes (rate-limited so it does not fan out into a cost spike — respects Cost-002's cheap-tier posture). Document the per-pass limit.
- [ ] **Loop closure verified:** adopting + keeping a discovered skill resolves its gap (`resolveByDedupKeyAsync`); reverting leaves it open for retry. Add a test.
- [ ] **No cost regression:** gap-triggered discovery reuses the cheap-tier scorer/judge from Cost-002; a burst of gaps coalesces into bounded work, not one session per gap.
- [ ] **vitest:** cover (a) new gap → debounced discovery scheduled; (b) burst of gaps → single coalesced pass; (c) backlog backfill is rate-limited; (d) adopt→keep resolves the gap, revert keeps it open.
- [ ] `tsc --noEmit && npx vitest run` passes in `apps/api_server`.

## Dependencies

- **Discovery-005** (Postgres) — the gap store is inert on Postgres today, so gap-driven discovery only works in prod after 005. Sequence 005 before the prod-facing part of 004.
- **Cost-002** — reuse its cheap-tier posture so backlog drain is affordable.

## Out of Scope

- MCP-server discovery (Discovery-006).
- Auto-applying discovered skills without approval (keep the proposal gate).

## Data safety

- No customer/private data. Gap rows store intent title/problem/tags + a sample sessionId — do not include raw transcript text in discovery queries beyond the existing intent fields.
