---
date: 2026-10-06
repo: rhythm
branch: codex/memory-search-cloud-auth-20261005
pr: none
issues: []
status: unverified
tags: [run, rhythm]
---

# Mobile follow-through corrections C1 + C2 (continues `2026-10-06-mobile-coordinator-followthrough.md`)

Base `5da2f764`. Not committed. Plan: `task-4/rhythm-mobile-followthrough-correction-plan.md`; verification: `task-4/mobile-followthrough-sol-verification.md`.

## Red before edit
`npx jest --runInBand tests/sol-coordinator-followthrough-verification.test.ts tests/coordinator-delayed-result.test.ts`: 4 failed / 13 passed. Failing: same-root client replacement (old row 99 installs), event during finite planning admission, inert-no-catalog, SSE-down fallback. Matches Sol's report.

## Changes
- `providers/coordinator-conversation-controller.ts`
  - `activate(binding, client?)`: same key + a different non-null client object takes the existing key-change path (abort controllers/history, drop in-flight request marker, bump `activeEpoch`). `activeClient` is memory only.
  - `RecordState.trailingEpoch`: `revalidate()` during `record.request` records the epoch instead of dropping the signal; `run()` finally drains it with one microtask-deferred `revalidate` only if key, epoch and `enabled` are unchanged. Epoch bump (exit/activate/client change) cancels it. Existing single-flight/`again` coalescing handles the rest.
- `providers/coordinator-conversation-provider.tsx`: activation effect passes `pairedHost.client` (and lists it as a dep).
- `tests/coordinator-delayed-result.test.ts`: +3 cases (controller-level late old-client status; exit during finite admission drops trailing read; several events during one operation give exactly one trailing status read).
- Sol's `tests/sol-coordinator-followthrough-verification.test.ts` untouched.

## Results (exact, after change)
Sol file (12): PASS burst coalesce, teardown, late status project/root/client loss (3), client-replacement history (C1), finite-admission trailing read (C2), history parser, event decoder, ChatView projection. **FAIL (remaining gates, unchanged): inert primary without catalog row (C3); SSE-down safety callback (C4).**
Own file `tests/coordinator-delayed-result.test.ts`: 8/8 pass. `tests/coordinator-conversation.test.ts`, `global-event-stream`, `session-refresh-pinning`, `post-prompt-refresh`: pass. Total 67 pass / 2 fail (the two C3/C4).
`npm run typecheck`: clean. `npm run lint`: 0 errors, 7 pre-existing warnings in untouched files.
Red/green rigor: the new late-status test first passed vacuously at provider level (a new `open()` supersedes the status controller); rewritten at controller level and verified red (`Expected false, Received true`, stale status installed) with the client fence disabled, then green with it restored. The first red of that test was a const-assignment test bug and was discarded.

## C3/C4: seam report only (no implementation)
- C4 (SSE down): the existing 5s `setInterval` in `opencode-provider.tsx` safety effect (runs only when stream is not connected or a session is busy) is the one reusable seam. Minimal mobile-only option: after its SDK reads, call a new identity-free listener channel with `{projectId: activeProjectPath}`; coordinator provider answers with `controller.revalidate(currentBinding)` only when binding.projectId matches and the view is enabled. That reads via the authenticated paired client for the binding's own local root, works for catalog and inert bindings, adds no timer. It is not an SDK-session event, so no unknown/ordinary/child id is treated as the root. Sol's harness constructs the effect with a fixed name list, so it needs the new notifier identifier added to its supplied dependencies (plan allows mirroring the approved seam).
- C3 (inert, healthy SSE, no catalog row): no mobile-only trusted producer exists; the only mobile signals are SDK-identified. Needs a reviewed canonical post-commit notification (core/gateway) or accepting the project-scoped safety read above as supplementary only. Not implemented; waiting for the decision.
- Shell hashing was denied; Astra to collect patch hashes.
