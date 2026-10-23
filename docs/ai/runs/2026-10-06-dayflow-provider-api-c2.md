---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-coordinator-approval-resume-20261006
pr: none (source-only, uncommitted)
issues: []
status: source-complete-pending-review
tags: [run, rhythm]
---

# Dayflow provider API (C0/C2 API half)

Same persisted Sonnet-5.5 session (`5a65716e-eac3-49a4-99b0-8d708b2d9993`), model served `claude-sonnet-5-5`.
Source only: no commit, package, install, live app/model/approval/capture/auth/grant/consent/history change.
Frozen native interface files were read only; nothing under `apps/opencode_fork` was touched.

## Files

Production (8 reserved existing + 1 named DTO):
- `apps/api_server/src/contracts/dayflow_provider_admission_contract.ts` (new) — exact DTO parsers/validators, bounds, `providerBasisDigest`.
- `apps/api_server/src/services/opencode_client_service.ts` — frame/enroll adapters, projected-load ingress, callback native anchor (only the reserved seam; accepted approval source otherwise byte-for-byte).
- `apps/api_server/src/repositories/dayflow_receiving_context_repository.ts` — V2 `userExposure` ledger, typed receiver lookup, transactional append, final admission proof.
- `apps/api_server/src/services/dayflow_qualified_evidence_service.ts` — enrollment before every V1 body; `readAutomaticOverlay`.
- `apps/api_server/src/services/dayflow_receiving_context_authority.ts` — `DayflowGuardEnrollmentService`.
- `apps/api_server/src/services/dayflow_receiving_history_guard.ts` — `revalidateForProjectedLoad`, `DayflowProviderAdmissionService`.
- `apps/api_server/src/routes/dayflow_references_routes.ts` — `POST /dayflow-agent/provider-admission` under `requireLocalOrCloudAuth`.
- `apps/api_server/src/app.ts`, `apps/api_server/src/server.ts` — composition with one shared enrollment.

Tests (new): `dayflow_provider_admission.test.ts` (39), `dayflow_provider_witness_basis.test.ts` (3),
`dayflow_provider_client_adapter.test.ts` (10), `helpers/dayflow_provider_harness.ts`.
Adjacent: `dayflow_coordinator_server_composition_contract.test.ts` (+1 coverage test).

## Checks (all exit 0)

- `npm --prefix apps/api_server test -- --run` on: provider_admission (39), witness_basis (3), client_adapter (10), composition_contract (3).
- Regression: dayflow_shared_composition, dayflow_qualified_reader, opencode_client_service, opencode_client_typed_wrappers, opencode_client_v2_wrappers, coordinator_goal_approval_resume, coordinator_conversation_navigation → 7 files / 250 tests pass.
- core_boundary_callback, issue_1123_contract, issue_1134_external_content_security + the three new suites → 88 tests pass.
- `npm --prefix apps/api_server run build` → pass. `git diff --check` → clean.
- All 14 protected approval pins match their recorded sha256 (unchanged).
- No broad baseline/stress run; the four closed memory failures were not touched.

## Design decisions

- V2 exposure rides the existing dispatch manifest columns (no migration, no new production path). V2-only rows have a NULL tool turn that a later V1 append binds. V1-only rows keep identical bytes.
- Order for every body: enrollment → source re-read → durable append → live frame proof → final synchronous source + receiver proofs → scan/fence/3,800 B text. Failure at any step releases nothing.
- Receivers are typed: foreground (`route_authed=1`, `c2_foreground`) or the exact null-auth `c2_goal_callback:<id>` joined to the durable delegate_goal command and the async delegation row. No oldest-unlinked heuristic, no signed-MCP identity invented.
- `basisDigest` = receiver/owner/project/root/agent/consent + persisted witnesses + full candidate JSON; excludes nonce/attempt/inputDigest/read time.
- A history-only decision (different agent, compaction/summary) is `allow` when history is valid and `project` only when something retained is invalid or a sticky marker exists; `receiver_changed` projection only when consent is no longer current.
- `guardRegistrationVersion: 1` is emitted only when the composed evidence service carries the shared enrollment; a composition test asserts one producer construction with the shared enrollment.

## Early boundary correction (E1/E2, Sol early review)

- E1: `dayflow_receiving_history_guard.ts` no longer holds authoritative zero-dependency non-root/child sessions; root/primary is required only for retained dependencies or an overlay.
- E2: `readAutomaticOverlay` returns `sourceStillCurrent()`; after the retained-history await the guard synchronously re-proves source admission, qualified overlay candidates, typed receiver, consent/config generation, primary root, selected agent and the durable exposure. A stale overlay is omitted (and eligibility/receiver cleared in the basis); the existing hold/project policy applies; history/taint/transcript unchanged.
- Red first (7 failed), then green: admission 50 + basis 3; qualified_reader/shared_composition/composition_contract/client_adapter 79; build 0; `git diff --check` clean; 14 protected pins unchanged.
- New hashes: history_guard `90dfd38d…`, evidence_service `522d4429…`, admission test `32f24963…`, harness `ec881f81…`. Receipt: `rhythm-dayflow-provider-api-c2-20261006/early-boundary-correction/`.
- Canonical content is not re-read after the last await (sync proof covers fingerprint, reference versions, durable exposure).

## Remaining gates / limits

- Native overlay-bearing useful tool continuation has no clean-group certificate in the frozen native interface. Reported, not faked.
- Owned-engine frame/enrollment routes are a disclosed stand-in in tests; no cross-process or live proof.
- 2 s exchange deadline is untested against a real engine under load.
- Anchor ordering relies on native ascending `msg…` ids; non-`msg` anchors hold `history_ambiguous` (contract ambiguity to confirm).
- Actual provider/root-hydration integration and Sol/Astra review remain. GitNexus impact/detect_changes were unavailable in this session.
- Minor cleanup left: `providerFinalAdmissionCurrent` has an IIFE and a few possibly unused type imports in the history guard (build passes).
