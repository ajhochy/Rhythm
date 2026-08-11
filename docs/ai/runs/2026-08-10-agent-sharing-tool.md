---
date: 2026-08-10
repo: Rhythm
branch: feat/artifact-viewer
pr: 1338
issues: [1339]
status: blocked
tags: [run, rhythm, mcp, live-artifacts]
---

# Agent live-artifact sharing tool

## Files

- Draft MCP tool/test/registration/security-boundary changes are present only in the assigned MCP files.
- Added contract: `docs/ai/contracts/live-artifacts-agent-sharing-tool.json`.
- Extended the env-gated live E2E with share-by-email then revoke behavior.

## Contract

- Initial failing acceptance command: `cd apps/mcp_server && npx vitest run src/tools/__tests__/liveArtifacts.test.ts src/tools/__tests__/liveArtifacts.negative.test.ts src/security/__tests__/external_content_role_graph.test.ts src/__tests__/mcp_capabilities_and_tool_registration.test.ts`
- Result: **FAIL**, 10 failures: missing `rhythm_update_live_artifact_sharing`, registration count remained 90, and no security-role registration.
- Focused unit command after the draft implementation: same command above.
- Result: **PASS**, 4 files / 28 tests.

## Checks

- `cd apps/mcp_server && npm test` — **PASS**, 29 files / 176 tests; 2 env-gated skipped.
- `cd apps/mcp_server && npm run typecheck && npm run build` — **PASS**.
- `cd apps/api_server && node_modules/.bin/tsc --noEmit && npm run build` — **PASS**.
- `cd apps/opencode_fork/packages/opencode && bun run build --single` — **PASS**; fork smoke test passed.
- `tools/dev/sandbox.sh up` — could not start because a live sandbox already owned `:4098`/`:4097`; `status` confirmed active PIDs. It was not stopped because this run did not create it.
- Live command attempted against that isolated sandbox:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-dev-sandbox" DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_mcp_live_e2e.test.ts --no-file-parallelism`
- Live result: **FAIL**. The real engine rejected the new MCP call before mutation: `trusted MCP call payload mismatch` for `live-artifact.state.update`.

## Approval verifier continuation

- Added `live-artifact.sharing.update` to both API and MCP security-action allowlists.
- Bound that action only to `rhythm_update_live_artifact_sharing`; the sharing tool now uses it rather than `live-artifact.state.update`.
- Added API verifier test `#1339 c9`: exact action/tool binding passes and a trusted state-update tool envelope is rejected for the sharing action.
- Focused contract after the change: MCP 4 files / 28 tests **PASS**; API verifier 8 tests **PASS**; both TypeScript checks and builds **PASS**.
- Full MCP suite/build: **PASS**, 176 tests (2 env-gated skipped). Full API suite: **FAIL**, 9 unrelated existing failures in memory provenance/index/injection, research-owner visibility, delegation caller identity, and audit-lock tests; focused API security suite remains green.

## Security doubt review

- Risk: an approval for another mutation could authorize sharing. Cheapest probe: the API verifier contract asserts the exact `live-artifact.sharing.update` → `rhythm_update_live_artifact_sharing` binding and rejects a signed state-update envelope. It passed. The real sandbox E2E remains required to prove the deployed API/engine path.

## Live blocker

- The required live command was rerun against the supplied sandbox and failed with its **old** code: `trusted Rhythm MCP caller is required for rhythm_update_live_artifact_state: trusted MCP call payload mismatch`.
- `tools/dev/sandbox.sh status` reports that API `:4098` is PID 21167 running `apps/api_server/dist/server.js`; it cannot load the rebuilt verifier without an owner-authorized sandbox restart through `tools/dev/sandbox.sh`. This run did not stop or hand-start either server.

- Required restart-and-rerun command: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-dev-sandbox" DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_mcp_live_e2e.test.ts --no-file-parallelism`.

## Failure triage (2026-08-10, rebuilt sandbox)

Sandbox rebuilt and running (API :4098 / engine :4097). The command above was rerun three
times; no product code was changed.

### Run 1 — reproduce

**FAIL** at `live_artifacts_mcp_live_e2e.test.ts:343`, `expected 200 to be 404`. Sandbox
`api_server.log`:
`[ERROR] Handled FORBIDDEN POST /agent-approvals/consume — human approval is required after external content was consumed`.

**Root cause — test-harness defect, production is correct and fail-closed.** Turn 4 calls
`rhythm_get_live_artifact`; `live-artifact.get` is an external-content ingress and is *not*
in `SOURCES_EXEMPT_FROM_APPROVAL_GATE`, so it records a session taint. The second prompt's
`rhythm_update_live_artifact_sharing` is a protected outbound action
(`live-artifact.sharing.update`), so `consumeApproval` refuses it without an approval token.
The mutation never ran, so the collaborator kept access. The fixture asserted that an
*unapproved* post-taint revocation would land — the exact thing #1134 exists to prevent.
The first share succeeded only because it ran *before* the `get`, on a clean session.

### Fix — live fixture only

`apps/api_server/src/__tests__/live_artifacts_mcp_live_e2e.test.ts`. The revocation prompt
now drives the real approval flow instead of expecting a free mutation. Turn sequence is
now `create, update_sharing, update_state, get, revoke_denied, request_approval,
revoke_approved` and the test asserts:

- the unapproved revocation is refused with `human approval is required after external
  content was consumed`, and collaborator access read **mid-flight** is still 200;
- `rhythm_rhythm_request_approval` is advertised, and mints a pending row bound to exactly
  `live-artifact.sharing.update` with the server-authored canonical preview
  `{"collaborators":[],"id":"<id>","visibility":"private"}` — no reuse of the state/bundle/
  create actions and no reuse of the earlier untainted share;
- the approved re-call consumes that token exactly once (`consumed_at` set);
- the collaborator then gets 404 under the same stable artifact ID.

Approval was **not** disabled. Only the human's tap is simulated, by flipping that one
server-minted pending row to `approved`. It cannot be done over HTTP here: `PATCH
/agent-approvals/:id` needs a P-256 signature, and the sandbox holds only
`HUMAN_APPROVAL_PUBLIC_KEY` + capability digest (verified: the key is not the parity-gate
generator point, and `RHYTHM_LIVE_HUMAN_CAPABILITY` is unset). Every other binding —
session, agent, action, payload digest, taint id, taint turn, single-use — is still checked
by the real server. Signature coverage lives in `human_approval_signature.test.ts` and
`issue_1175_adversarial_live.test.ts`.

### Run 2 — approval flow verified

**PASS**, 1/1, 9.42s. But the sandbox log showed a line the assertions did not cover:
`[ERROR] Handled BAD_REQUEST DELETE /live-artifacts/<id>/collaborators/6 — userId must be a
positive integer`. The 404 was coming from the visibility flip alone; the collaborator grant
had survived and the tool had returned an error. Green for the wrong reason.

### Run 3 — honest assertions, real defect surfaced

Added two assertions: the approved revocation's tool result must not contain
`Rhythm API error`, and `live_artifact_collaborators` must be empty for the artifact.

**FAIL** at `live_artifacts_mcp_live_e2e.test.ts:433`:

```
AssertionError: expected 'Error: Rhythm API error 400: {"error"…' not to contain 'Rhythm API error'
Received: "Error: Rhythm API error 400: {\"error\":{\"code\":\"BAD_REQUEST\",
           \"message\":\"userId must be a positive integer\"}}"
```

`LiveArtifactsController.deleteCollaborator` passes the **string** path param to an
`integer()` guard built on `Number.isInteger`, so `DELETE
/live-artifacts/:id/collaborators/:userId` can never succeed — for the MCP tool or for
Flutter's `live_artifacts_data_source.dart`. The sharing tool half-applies (visibility PATCH
lands, removal does not) and reports failure. The route is new in this PR (`afa2f0d1`,
`03fc26a0`), not a pre-existing main defect, and the MCP unit tests missed it because they
mock HTTP and only assert the DELETE was *issued*.

Filed: `docs/ai/generated-issues/2026-08-10-p0-live-artifact-collaborator-delete-400.md`
(P0). One-line fix in `live_artifacts_controller.ts:49` —
`integer(Number(req.params.userId), 'userId')`. Not applied here: product authorization code
is outside this triage's file grant.

### Contract status

- `issue-1339-c8` → **FAIL**. Approval gate and access revocation proven live; grant removal
  is not.
- `issue-1339-c3` → **FAIL** (was `pass` on mocked unit evidence only).
- `not_tested` now records the unsignable human-decision step.

### Other checks

- `cd apps/api_server && node_modules/.bin/tsc --noEmit` — **PASS**.
- No product code touched. Files changed: the live test, this note, the contract, and the
  new generated issue.

## P0 collaborator DELETE route repair (2026-08-10)

- Acceptance test first: `cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts` — **FAIL**, `expected 400 to be 204` for the numeric Express path parameter.
- Surgical fix: `LiveArtifactsController.deleteCollaborator` now passes only `Number(req.params.userId)` to its existing strict `integer()` guard. Owner authorization and repository behavior are unchanged.
- Focused route/API check: `cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts && node_modules/.bin/tsc --noEmit && npm run build` — **PASS**, 1 file / 27 tests; TypeScript and build passed.
- Sandbox rebuilt only through `tools/dev/sandbox.sh down && tools/dev/sandbox.sh up && tools/dev/sandbox.sh status`; it is running at API `:4098` (PID 61096) and engine `:4097` (PID 61126) for the upcoming Flutter smoke.
- Live evidence: `cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-dev-sandbox" DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_mcp_live_e2e.test.ts --no-file-parallelism` — **PASS**, 1 file / 1 test, 12.20s. The fixture proves unapproved post-taint revoke is denied with access still 200, then exact approved revoke has no Rhythm API error, collaborator-row count is 0, and collaborator GET is 404.
- `gitnexus_detect_changes(scope=unstaged)` — **LOW** risk; the stale index mapped only two pre-existing security symbols across the worktree and no affected processes. The new collaborator route remains unindexed, as confirmed by pre-edit `api_impact`/symbol impact returning no route/target.
