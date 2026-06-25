# Project State

## Current focus

**2026-06-24 — P4 manager-to-specialist delegation implemented locally.**

Follow-up B / P4 D1-D5 is implemented on `feature/agent-scheduler`: manager profiles can delegate to importer-authorized specialist profiles through a local API + MCP tool, with sub-runs invoked through `AgentRunner.run` under the target profile id so the existing `resolveProfileScope` path re-scopes model, MCPs, skills, system prompt, and `ocAgent`.

Run detail: `docs/ai/runs/2026-06-24-manager-delegation.md`.
Contract: `docs/ai/contracts/issue-P4-manager-delegation.json`.

**2026-06-25 — smoke "create→close" regression was a misdiagnosis (no backend bug).**
The backend does not auto-close new sessions (verified live + statically). The new
session was appended to the bottom of a tall-card list. Fixed in the Flutter UI:
newest-first ordering + compact `SessionRow`. Detail:
`docs/ai/runs/2026-06-25-session-list-ordering-density.md`. Still open: delegated-session
card stays "Starting"/no usage (synchronous run, no WS lifecycle streaming).

**2026-06-25 — sync now preserves user-owned overlay allowlist fields.**
`syncOpencodeAgentProfiles` was nulling `allowed_delegates_json` (and could wipe
`allowed_mcps_json` — live Secretary bug) on every re-sync. The three overlay
columns (`allowed_mcps_json`, `allowed_skills_json`, `allowed_delegates_json`)
are now treated as user-owned: importer defaults on first INSERT only,
backfill-when-null + preserve-on-UPDATE thereafter. Engine fields
(`ocAgent`, `sessionSelectable`) still refresh every sync. Detail:
`docs/ai/runs/2026-06-25-sync-preserve-overlay-fields.md`; decision:
`docs/ai/decisions/2026-06-25-sync-preserve-overlay-fields.md`.

## Active branch / PR

- **Branch:** `feature/agent-scheduler`
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open; do not auto-merge
- **Base:** `main`
- **Local state:** P4 implementation is uncommitted and unpushed in this working tree

## In progress

- D1: `agent_configs.allowed_delegates_json` added to SQLite/Postgres bootstrap and repository/API models.
- D2-D4: `delegateToAgent` service authorizes manager callers, validates allowed delegates, blocks self-delegation, caps depth at one layer, and runs target sub-runs under the target profile.
- D3: `rhythm_delegate` MCP tool posts to `/agent-delegation/delegate` on the local agent API.
- D5: `syncOpencodeAgentProfiles` importer marks `workflow-orchestrator` as manager and re-syncs its allowed delegate list; Flutter model/profile sheet surfaces `allowedDelegatesJson`.
- Generated issue split exists under `docs/ai/generated-issues/D1-*.md` through `D5-*.md`.

## Risks / known issues

- GitNexus reports the local P4 diff as **medium** risk; direct compare against `main` is **critical** because this branch already contains a large stack of unrelated prior work.
- `AgentConfig` Dart model impact remains **HIGH** because it is shared by agent views/widgets and the follow-up smoke flow; this change is additive and covered by a focused model/sheet test plus `flutter analyze --no-fatal-infos`.
- Delegation authorization currently trusts the caller-supplied manager profile id, then checks that profile in the local DB. This matches the MCP/tool boundary but does not cryptographically bind the live opencode session to that profile.
- Partial app smoke ran after implementation. The isolated smoke server attempt timed out, but the same allowed manager delegation passed against the currently running live app server after importer sync.

## Test status

| Suite | Status |
|-------|--------|
| `ai-workflow checks --level issue` | **PASS** — Flutter analyze, Dart format, API `tsc --noEmit` |
| `ai-workflow checks --level pr` | **PASS** — issue checks + API Vitest |
| `apps/api_server npx tsc --noEmit` | **PASS** |
| `apps/api_server npx vitest run` | **PASS** — 141 files, 1189 tests (incl. overlay-preservation suite) |
| `apps/api_server` focused P4 contract tests | **PASS** — schema, repo, delegation auth, importer |
| `apps/mcp_server npm run typecheck` | **PASS** |
| `apps/mcp_server npx vitest run src/tools/agentDelegation.test.ts` | **PASS** |
| `apps/desktop_flutter flutter test test/features/agents/agent_profile_model_picker_test.dart` | **PASS** — 6 tests |
| `apps/desktop_flutter flutter analyze --no-fatal-infos` | **PASS** — info-level pre-existing lints remain |
| GitNexus `detect-changes --repo Rhythm --scope unstaged` | **PASS** — medium risk, 14 files / 20 symbols / 4 flows |
| P4 live smoke | **PASS / PARTIAL SCOPE** — see `smoke-test.md`; launch/API/importer/auth guards passed, and live allowed delegation returned `SMOKE_DELEGATION_OK` |

## Next step

1. Run manual profile-sheet smoke for editing `workflow-orchestrator` allowed delegates.
2. Review whether `rhythm_delegate` should bind caller identity to the active session profile instead of trusting the caller-supplied profile id.
3. Commit/push P4 after final review.
