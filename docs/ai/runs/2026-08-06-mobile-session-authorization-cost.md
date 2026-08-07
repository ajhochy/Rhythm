---
date: 2026-08-06
repo: Rhythm
branch: claude/mobile-direct-agent-connection-hu75he
pr: null
issues: []
status: verified
tags: [run, Rhythm, mobile, gateway, performance]
index: "[[Rhythm]]"
---

# Mobile gateway session-authorization cost

Started as a question — why can't mobile connect straight to the agent server
instead of the gateway — and narrowed to the two concrete problems behind it:
request latency, and agent permissioning breaking when the session auth layer
landed.

## Files

- `apps/api_server/src/services/mobile_opencode_security.ts`
  - Adds `sessionAuthorizedForCaller`: short-circuits on an explicit
    `mobile_opencode_resource_owners` row (indexed local read, no engine
    traffic), otherwise falls through to the unchanged `/session` list path.
  - Adds `filterBySessionAuthorization`, used by `projectPermissions` and
    `projectQuestions` so pending permission/question rows resolve through the
    same memoized per-session decision instead of building the full owned-id
    set.
  - `authorizeMobileOpenCodeOperation`, `shapeMobileOpenCodeResponse` and
    `mobileSessionBelongsToProject` accept an optional shared `ResourceScope`;
    `ResourceScope` is exported as `MobileOpenCodeResourceScope` and gains an
    `authorizedSessions` memo.
- `apps/api_server/src/services/mobile_opencode_proxy.ts`
  - Builds one `ResourceScope` per request and passes it to both the
    authorization and response-shaping passes.
- `apps/api_server/src/__tests__/mobile_session_authorization_cost.test.ts`
  - New. Owned session authorizes with no `/session` listing; a non-owner is
    still refused without the id ever being addressed upstream; the list
    resolves at most once per request.
- `apps/api_server/src/services/mobile_opencode_security.ts` (second pass)
  - Adds `ancestryAuthorizesSession` + `engineSessions`: a session is
    addressable when it *or an ancestor reachable by `parentID`* carries a
    claim, bounded at depth 32. Fixes subagent approvals being invisible and
    unreplyable on mobile.
- `apps/api_server/src/__tests__/mobile_child_session_permissions.test.ts`
  - New. Child-session approval lists and replies for the owner; stays hidden
    from a caller owning no ancestor; a child whose ancestry leaves the project
    is still excluded.

## Checks

- `npx tsc --noEmit` — clean.
- Fail-first: `mobile_session_authorization_cost.test.ts` against the
  pre-change sources — 1 failed / 2 passed. The owned-session case received
  `['/session', '/session/ses-owned/message']` where the contract expects only
  the caller's own request. The two guard cases pass on both sides by design.
- `npx vitest run --maxWorkers=1 src/__tests__/issue_1175_mobile_gateway_security.test.ts src/__tests__/issue_1169_mobile_opencode_proxy.test.ts src/__tests__/issue_1285_mobile_chat_discovery.test.ts src/__tests__/issue_1168_mobile_gateway_security.test.ts src/__tests__/issue_1173_mobile_tools_gateway.test.ts src/__tests__/mobile_gateway_routes.test.ts`
  — PASS, 6 files / 34 tests, all contract files **unmodified**.
- `npx vitest run --maxWorkers=1` (full api_server suite) — PASS,
  468 files / 3,838 tests, 85 files and 128 tests skipped, 0 failures.
- Fail-first for the child-session defect:
  `mobile_child_session_permissions.test.ts` against the pre-fix sources —
  2 failed / 2 passed. The permission list returned `[]` where it must list the
  child's approval, and replying to it rejected. The two negative cases passed
  on both sides by design.
- Full api_server suite after the child-session fix — PASS,
  **469 files / 3,842 tests**, 85 files and 128 tests skipped, 0 failures.
- PR [#1327](https://github.com/ajhochy/Rhythm/pull/1327) CI on the first
  commit: `foundation` and `server-checks` both success.

## Notes

- An earlier attempt authorized via `GET /session/{sessionID}` and required
  editing five fetch stubs across three contract files. The #1175 test caught
  it: a cross-project id produced two upstream requests where the contract
  requires zero. That approach was abandoned and the stub edits reverted — the
  contract files in this diff are untouched. See the decision note.
- Two diagnostic claims made to the user before reading far enough were wrong
  and are corrected in the decision note: the engine's `/session` is
  `directory`-scoped (so the listing was O(project history), not O(all
  history)), and no single operation fetched a collection twice.
- GitNexus MCP tools were not available in this session, so the
  `impact` / `detect_changes` steps in CLAUDE.md could not be run. Blast radius
  was established by reading call sites directly: `projectSessionIds` had five
  callers, all inside `mobile_opencode_security.ts`.
- Fix 3 from the diagnosis (short-circuit owner checks on a single-paired-user
  Mac) was deliberately **not** built — it changes what the #1175 contract
  means and is the user's call.
- Container note: `apps/api_server` had no `node_modules`; `npm ci` plus a
  no-save install of `@rolldown/binding-linux-x64-gnu` (the lockfile resolves
  darwin binaries) was needed before vitest would start. No manifest changes
  were committed.
