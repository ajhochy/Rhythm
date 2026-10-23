---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: []
issues: []
status: repairing
tags: [run, Rhythm]
---

# Codex OAuth Grid model catalog

## Files

- `apps/opencode_fork/packages/opencode/src/plugin/codex.ts` admits the three exact integer-major GPT-6 model IDs used by the reviewed Grid routes through the existing Codex OAuth model hook.
- `apps/opencode_fork/packages/opencode/test/plugin/codex-models.test.ts` checks those routes, the existing decimal/older routes, an unknown integer model, and non-OAuth pass-through through the real hook.
- `.github/workflows/opencode_fork_ci.yml` adds that focused regression to the workflow's selected fork tests.

## Checks

- RED, guarded `bun test test/plugin/codex-models.test.ts`: 1 failed / 1 passed. OAuth output omitted exactly `gpt-6-astra`, `gpt-6-sol`, and `gpt-6-luna` while retaining `gpt-6.1-sol` and `gpt-5.4`.
- GREEN, guarded `bun run typecheck && bun test test/plugin/codex-models.test.ts test/plugin/codex.test.ts test/plugin/codex-accounts.test.ts`: typecheck exit 0, 22 passed / 0 failed, 34 assertions.
- GitNexus upstream impact for `CodexAuthPlugin`: LOW/0 in an index 301 commits stale. Manual scope HIGH: the builtin plugin controls the engine's OpenAI OAuth model catalog, which feeds picker and Grid; the edit preserves the existing other authorization, curation, and entitlement gates.

## Notes

- First private startup showed an OpenAI placeholder despite a valid synthetic account and engine auth entry. Relaunch of the same signed app and unchanged private fixture restored 30 authorized OpenAI rows, proving the startup auth/provider-state ordering gap. This hook change does not repair startup ordering.
- On the second launch, `gpt-6.1-sol` appeared hidden while the three integer-major Grid IDs were absent. The signed engine snapshot contains all three; the hook's decimal-only version regex excluded them.
- No rebuilt engine or native catalog confirmation exists yet; model entitlement and served-model behavior remain unverified.
