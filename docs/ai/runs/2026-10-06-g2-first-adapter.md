---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-coordinator-approval-resume-20261006
pr: none (source-only, uncommitted)
issues: []
status: first-adapter-source-complete-pending-review
tags: [run, rhythm]
---

# G2 first source adapter checkpoint

Same persisted Sonnet-5.5 session (`5a65716e-eac3-49a4-99b0-8d708b2d9993`), model served `claude-sonnet-5-5`.
Source only: no commit, package, install, server/model/HTTP launch, live app, grant, consent or approval card.
This is the first adapter checkpoint only; it is NOT full G2, current-body, native or live runtime acceptance.
GitNexus was not available in this session (no tool surface), so impact analysis was manual.

## Files

Reserved initial (edited): `contracts/coordinator_conversation_contract.ts`, `services/persistent_workstream_coordinator.ts`, `services/coordinator_conversation_service.ts` (one narrowing guard only).
Reserved initial (unchanged): `repositories/coordinator_conversations_repository.ts`, `server.ts`.
Conditional seams (recorded in `conditional-seam-reservation.json` before editing): `services/opencode_client_service.ts`, `services/agent_delegation_service.ts`. The other four conditional seams were not needed and are unchanged.
New tests: `coding_workflow_adapter_dispatch.test.ts`, `coding_workflow_coverage_inspection.test.ts`, `coding_workflow_contract_and_reads.test.ts`.

## What it does

- Contract: fixed `workflow` admission purpose with the explicit `acknowledgesCodingWorkflowCoverage` acknowledgement; typed receipt, coverage and hold-reason contract with a strict receipt parser. Issuance is deliberately not enabled.
- Producer: `delegateToAgentAsync` accepts an optional server-only `codingWorkflow` input; the client `promptAsync` gets a distinct typed context. The native anchor is minted and the exact pending provenance row is durable before the SDK request, the anchor is in the SDK body, and the receipt is exported with delivery accepted or unknown. A thrown transport error is `unknown` (delegation not failed); an engine error is a definitive rejection. Calls without the typed input keep their exact old argument list and behavior.
- Inspection: `CodingWorkflowCoverageInspector` joins exact local rows, then reads the manager, every recursive native descendant (bounded), all message pages and strict lifecycle per directory under the same engine identity before/after, charges exactly the listed root/review anchors, re-enumerates the tree afterward and re-proves the local scope. Missing/malformed/changed input holds with no usage.
- Strict reads: `listChildrenStrict` / `listMessagesPageStrict` return null instead of defaulting to empty; the old wrappers are untouched.

## Checks

- Red/green notes: the first wide regression run exited 1 (3 existing tests assert the exact `promptAsync` argument list; my first version appended trailing `undefined`s) — fixed by passing the extra arguments only for the typed input; the second run exited 0.
- `npm --prefix apps/api_server test -- --run <16 affected files>` exit 0, 339 tests (includes the three new files: 12 + 29 + 13).
- Dayflow C2 suites (6 files) exit 0, 70 tests (unchanged, shared client file).
- `npm --prefix apps/api_server run build` exit 0; `git diff --check` exit 0.
- Mutation check: disabling the service guard does not fail the service test because the existing purpose gates already answer `planning_authority_conflict`; the guard is explicit belt-and-braces plus type narrowing.
- All other protected pins (approval 14 + Dayflow C2) re-hashed equal to the reservation.

## Limits (not hidden)

Source-only proof; the SDK/fetch edges and the native tree are stand-ins. No consumer is wired (server.ts unchanged). Authorization/ordinal/workstream/goal exist only in the returned receipt until the general continuation checkpoint persists them. Root/review anchors are caller-supplied from persisted dispatch rows. Unknown-delivery receipts hold. Deleted native sessions are invisible. The child row's project is not checked locally (owner and the parent chain are). Full G2, general continuation, retrofit of legacy goals, and callback action authority are untouched and open.
