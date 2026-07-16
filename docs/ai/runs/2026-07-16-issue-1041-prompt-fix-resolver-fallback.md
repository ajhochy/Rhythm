---
date: 2026-07-16
repo: Rhythm
branch: (orchestrator-owned)
pr: (pending)
issues: [1041]
status: implemented-pending-verification
tags: [run, rhythm]
---

# Issue #1041 — workflow-prompt-fix resolver fallback

## Files changed
- `apps/api_server/src/services/org_proposal_appliers_wiring.ts` — resolver fallback + actionable refusal
- `apps/api_server/src/services/__tests__/issue_1041_prompt_fix_resolver_fallback.test.ts` — new focused tests

## Summary
`resolveSkillForProposal` failed closed when the LLM diagnosis put the PROFILE id in
`targetRef`/`affectedSkill` (e.g. `skill:worship-planning`) instead of the skill title
(`monday-worship-planning`), leaving un-appliable HIGH cards.

Root-cause fix at the shared resolution point (`resolveSkillForProposal`, used by both
workflow-prompt-fix and refine-skill validators + appliers). When direct id/title lookups
miss, `resolveSkillByFallback` tries, in order:
- **(a)** a skill title mentioned verbatim in `diagnosis` / `concreteFix` / `rationale` text — used only when EXACTLY ONE live skill title matches.
- **(b)** the affected profile's allowed-skills list (namespace-prefix aware, e.g. `anthropic-skills:foo` → `foo`) — used only when EXACTLY ONE live skill matches.
Each hit logs which fallback resolved. Still fail-closed (null) when nothing resolves.

Refusal made ACTIONABLE via `describeSkillResolutionFailure`: names the ref(s) looked for
(`targetRef`, `affectedSkill`, `skillName`) AND up to 5 closest candidate skill titles
(profile allowlist first, then diagnosis-mentioned), all four refusal sites updated
(workflow-prompt-fix + refine-skill, validate + apply).

**Empty body:** already handled by existing `draftPromptFixBody("", fix)` → `fix\n` +
unconditional `applySkillBodyRevision` write. Confirmed by test (body_len=0 → content written). No code change needed there.

## Checks run
- Focused: `MEMORY_VAULT_SUBDIR=memory npx vitest run src/services/__tests__/issue_1041_prompt_fix_resolver_fallback.test.ts` → 3/3 passed.
- Regression: `... org_proposal_apply.test.ts issue_1003_delegation_gate.test.ts` → 13/13 passed.
- Typecheck: `npx tsc -p tsconfig.json --noEmit` (apps/api_server) → exit 0.
- GitNexus impact(resolveSkillForProposal, upstream) → LOW, 4 direct callers, 0 processes.
- GitNexus detect_changes → LOW, 1 file, 0 affected execution flows.
- No server needed (pure resolution logic against in-memory DB).

## Notes
- Scope re PR #1082 (revert snapshot path): my edits are confined to the resolver +
  the four one-line refusal-message strings; `applySkillBodyRevision`'s snapshot body was
  NOT touched (only shows as line-shifted in detect_changes). Minimal conflict surface.
- Follow-up (direction 2, NOT implemented): generation-side validation in
  `workflow_signal_generator.ts` to emit a correct `skill:<title>` targetRef at
  proposal-creation time (targetRef is built as `skill:${agentConfigId}` at
  workflow_signal_generator.ts:1000). Not trivial/same-file, so deferred.
