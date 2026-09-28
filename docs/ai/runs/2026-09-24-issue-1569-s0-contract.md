---
date: 2026-09-24
repo: Rhythm
branch: sol/1569-contract
pr: null
issues: [1569]
status: pending_independent_re_review
tags: [run, rhythm, issue-1569, s0]
---

# #1569 S0 contract and handoff

## Files

- `docs/ai/decisions/2026-09-24-issue-1569-brokered-credentials-contract.md` — adds decisions 15–19 for same-entry Keychain confirmation, grant-write protections, production/diagnostic non-disclosure, exclusive Rhythm ownership of `index.md`/`log.md`, and preservation in place of Hermes working-memory files; updates the moved planning-source path.
- `docs/ai/contracts/issue-1569.json` — expanded from 22 to 27 pending criteria with exact `not_tested` parity; no implementation criterion is claimed as tested.
- `docs/ai/reviews/2026-09-24-issue-1569-astra-review.md` — records repair 3 as manager-directed reconciliation after AJ revalidation, expressly not independent Astra approval.
- This run record.

## Checks

- Launch discipline verified first with `pwd && git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD` → `/private/tmp/rhythm-1569-contract`, `sol/1569-contract`, `08bd238f`.
- Read durable source `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/integration/docs/ai/plans/2026-09-24-issue-1569-brokered-credentials-plan.md`, repo context, the four S0 docs, and the two source sides of the Keychain claim. Rhythm `credentials_bridge_service.ts:324-330` and Hermes `agent/anthropic_adapter.py:988-1008` both name `Claude Code-credentials`; `auth_credential_watcher.ts` watches OpenCode `auth.json` and is not the evidence for the shared Keychain entry.
- WAIVED: documentation/contract-only S0 changes no runtime behavior; verification is the requested JSON criteria/parity assertion, exact four-file scope check, trailing-whitespace check, and stale-plan-path check. This waiver does not waive any implementation or behavioral validation criterion.
- Contract implementation test command intentionally not run: no implementation criteria are being claimed as tested. Follow the per-criterion exact commands in `docs/ai/contracts/issue-1569.json` when their slices are implemented.
- Required Python JSON assertion (valid JSON, unique criterion IDs, all `pending`, exact IDs/`not_tested` parity) → `PASS 27`.
- `git status --porcelain` → exactly the four authorized tracked docs modified and nothing else.
- `grep -n ' $'` across the four files → no output.
- Obsolete planning-source filename search across the four files → no output.
- No runtime/server/product tests were run. No product, test, project-state, plan, app, or git-state change was made.
- Coordinates (verification snapshot 2026-09-24): local S0/planning base `e93eac6e`; GitHub Rhythm PR #1544 targets `main`, base SHA `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`, remote head `788e7ccc82bcca4bacc000940eecfeaed4fdd863`. Hermes PR #17 coordinates remain branch `mega/2026-09-18-rhythm-plugin-finish`, base `main`, head `8ea642dbb6a8b8d65868c3e7a468c471914f037b`. Re-verify/rebase/review current heads before implementation.

## Frozen DTO/interface

`backendEnv` is optional and invoked only for a Rhythm-owned default-profile spawn. Request identity is `{serverOrigin, rhythmUserId, profile:"default", hermesHome:canonicalAbsolutePath, source, authGeneration}`. Response is an ephemeral env delta, never persisted. Broker source is validated OS-user OpenCode `auth.json`; only static `type:"api"` keys for OpenRouter, Anthropic, OpenAI and Google are mapped; OpenCode Zen is disabled. Mixed-file OAuth is never selected or exposed. Grant storage holds consent/references only. Descriptor-based symlink-resistant reads fail closed. Child starts from an explicit clean allowlist with controlled PATH/HOME/temp/locale, and no inherited secrets or loader hooks. Borrowed and non-default runtimes never receive injection. Logout/server/user identity transition disposes owned process state. Status is limited to observed state; disclose Anthropic shared-refresh and running-child secret-lifetime caveats. Every grant mutation requires exact-mutation native main-owned confirmation. IPC is closed-schema with strict size/enums and sender ownership/document/main-frame/trusted-URL/auth checks; renderer never supplies identity, path, or value. Memory search remains disabled absent capability, otherwise query-only with bounded count/snippets and opaque IDs, untrusted labels/content, server-enforced user/server/profile/vault/runtime generation, canonical-root confinement, current index, traversal/symlink/stale-index/redirect/remote rejection, and immediate revocation. Vault checks do not eliminate the final digest-check-to-rename external-writer race.

## Slice handoff

- S1 Rhythm inspector/status IPC; S2 grants/broker; S3 Hermes fork clean-env `backendEnv` and pinned artifact; S4 Accounts UI; S5 vault optimistic external-edit protection/atomic index; S6 gated read-only memory search or disabled; S7 isolated live + packaged/manual qualification.
- S1/S3/S5 may parallelize in disjoint worktrees. S2 depends on S1 and frozen S3 interface; S4 depends S1/S2; S6 depends S2/S3 and #1540; S7 follows applicable work. Companion coordinates verified 2026-09-24: `ajhochy/hermes-rhythm-plugin` draft PR #17, branch `mega/2026-09-18-rhythm-plugin-finish`, base `main`, head `8ea642dbb6a8b8d65868c3e7a468c471914f037b`; Rhythm local S0/planning base `e93eac6e`; GitHub integration PR #1544 targets `main`, base SHA `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`, remote head `788e7ccc82bcca4bacc000940eecfeaed4fdd863`. Re-verify/rebase/review current heads before implementation.
- Exact S7-c1 mock gate is specified in the contract and decision: local endpoint via `OPENROUTER_BASE_URL`, synthetic prompt, mock-side Authorization assertion, ungrant+restart no Rhythm key, Hermes key shadows, four unchanged store hashes, and no key in logs/DTOs. This is not live sandbox or packaged evidence.
- Fork provenance is mandatory: upstream repo/base, source commit, reproducible build/toolchain, rebuilt artifact digest/integrity, then Rhythm pin. No artifact-only shortcut.
- Follow-ups: F1 renderer session-token exposure; F2 unauthenticated local memory mutations; F3 existing Claude refresh-token race; F4 moved to S3 as explicit inherited-environment-removal requirement (not a deferrable arbitrary-env gap).
- Repair scope: only the four tracked S0 decision/contract/review/run docs changed. No product/tests/project-state/plan changes; no commit, push, merge, stash, clean, server, runtime, or profile access.

## S0 repair 4 — bounded documentation checklist

- [x] Read the independent FAIL receipt and original planning coverage rows 342 and 350; preserve the 27 pre-repair pending criteria and prior five additions.
- [x] Add pending S1-c8: focused synthetic-file assertions reject write-capable opens or mutations of Hermes credential stores, including mutate/restore; retain before/after hash checks.
- [x] Extend pending S7-c3: synthetic value and fingerprint sentinels must be absent from captured requests to Rhythm production API and telemetry destinations, including failure paths.
- [x] Align the decision and review records; record that the independent pre-repair verdict was FAIL and this repair is awaiting independent re-review.
- [x] Re-check JSON validity, unique IDs, pending statuses, exact `not_tested` parity, four-file scope, and line references; observed results below.

This docs-only repair started from branch `sol/1569-contract` at `c192c8fe`; no implementation branch or product/runtime test was started. All implementation criteria remain pending. The prior `PASS 27` in Checks above describes the pre-repair snapshot, not this candidate.

Repair 4 static checks: Python JSON assertion returned `PASS 28` (valid JSON, 28 unique IDs, all `pending`, exact `not_tested` parity, both repairs present). `git status --short` showed exactly these four modified docs; `git diff --check` produced no output. Criterion references are contract lines 14 and 34, decision lines 30, 33, 74 and 79, and review lines 65–67. No implementation tests, network calls, or runtime qualification were run. Independent re-review remains pending.

## Parent S0 freeze after independent review

Independent read-only review returned PASS for the 28-criterion documentation contract; see `../reviews/2026-09-24-issue-1569-repair4-independent-review.md`. All implementation criteria remain pending. The review does not grant implementation authority; AJ's prior explicit conditional authorization in `../decisions/2026-09-24-swarm-repair-3-authorizations.md` authorizes branching S1/S3/S5 after this S0 freeze. The original planning file is included unchanged. Current fork/head revalidation remains required before implementation branches.
