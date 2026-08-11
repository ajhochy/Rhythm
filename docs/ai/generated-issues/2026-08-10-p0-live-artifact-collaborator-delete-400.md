---
date: 2026-08-10
repo: Rhythm
branch: feat/artifact-viewer
pr: 1338
issues: [1339]
priority: P0
status: open
tags: [issue, rhythm, live-artifacts, security]
---

# DELETE /live-artifacts/:id/collaborators/:userId always 400s — collaborator revocation never removes the grant

## Failure

`LiveArtifactsController.deleteCollaborator` validates the **path** parameter with a
number-typed guard. Express path params are always strings, so the guard rejects every
request and the route can never succeed. Removing a collaborator is therefore impossible
through the HTTP API — for the new MCP sharing tool *and* for the Flutter client.

Found by the issue-1339 live behavioral gate, not by unit tests: the MCP unit tests mock
the HTTP layer, so they assert the DELETE was *issued*, never that it *succeeded*.

## Repro Command

```
cd apps/api_server
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-dev-sandbox" \
DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" \
RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" \
npx vitest run src/__tests__/live_artifacts_mcp_live_e2e.test.ts --no-file-parallelism
```

## Expected

The approved `rhythm_update_live_artifact_sharing` revocation succeeds, and
`live_artifact_collaborators` has no row left for the artifact.

## Actual

The tool returns an error and the collaborator grant survives:

```
AssertionError: expected 'Error: Rhythm API error 400: {"error"…' not to contain 'Rhythm API error'
Received: "Error: Rhythm API error 400: {\"error\":{\"code\":\"BAD_REQUEST\",
           \"message\":\"userId must be a positive integer\"}}"
```

Sandbox `api_server.log`:

```
[ERROR] Handled BAD_REQUEST DELETE /live-artifacts/<id>/collaborators/6
        — userId must be a positive integer { authUserId: 1 }
```

## Relevant Output

Order of operations inside the sharing tool's membership diff:

1. `PATCH /live-artifacts/:id` → visibility `shared` → `private` — **applied**.
2. `POST .../collaborators` for additions — none in this case.
3. `DELETE .../collaborators/:userId` for removals — **400, throws**.

So the call **half-applies and then reports failure**. The collaborator's read is blocked
only because visibility flipped to `private`; the grant row is still there.

## Why this is P0, not cosmetic

- **Revocation is not revocation.** The ACL row survives. Re-sharing the artifact later
  (owner or agent) silently restores a user who was explicitly revoked, with no new grant.
- **The agent sees an error** on a partially-applied mutation, so a retry loops forever
  and the approval token from the first attempt is already consumed.
- **Flutter is affected too** — `live_artifacts_data_source.dart` calls the same route.
- The route is new in this PR (`afa2f0d1`, `03fc26a0`); it is not a pre-existing main defect.

## Likely Cause

`apps/api_server/src/controllers/live_artifacts_controller.ts:15,49`

```ts
const integer = (value: unknown, name: string) => {
  if (!Number.isInteger(value) || (value as number) < 1) throw AppError.badRequest(...);
  return value as number;
};
...
async deleteCollaborator(req, res, next) {
  ... await repo.removeCollaborator(artifact.id, integer(req.params.userId, 'userId'));
}
```

`integer()` is correct for JSON bodies (`addCollaborator` passes `req.body?.userId`, a real
number). `deleteCollaborator` is the only caller that feeds it a **path** param, which is a
string, so `Number.isInteger` is always false.

## Likely Files

- `apps/api_server/src/controllers/live_artifacts_controller.ts` (the fix)
- `apps/api_server/src/__tests__/live_artifacts.test.ts` (route list only asserts auth, never a
  successful DELETE — that gap is why this shipped)

## Required Fix

Coerce the path param at the single broken call site; leave `integer()` and the
authorization path (`this.owner(req)`) untouched:

```ts
await repo.removeCollaborator(artifact.id, integer(Number(req.params.userId), 'userId'));
```

`Number('6') === 6`; `Number('abc')` is `NaN` and `Number('1.5')` is `1.5`, both still
rejected by `Number.isInteger`, so the guard keeps its strictness.

## Required Tests / Evaluation

1. **Unit** — `apps/api_server/src/__tests__/live_artifacts.test.ts`: owner adds a
   collaborator, `DELETE /live-artifacts/:id/collaborators/:userId` returns 204, and
   `GET /live-artifacts/:id/collaborators` no longer lists them. Add a non-numeric
   `:userId` case asserting 400 is still returned.
2. **MCP unit** — `apps/mcp_server/src/tools/__tests__/liveArtifacts.test.ts`: assert the
   revocation tool result is a success payload, not `toolError`.
3. **Live** — re-run the command above. The two assertions added at
   `live_artifacts_mcp_live_e2e.test.ts` (`revokeResult` has no `Rhythm API error`, and
   `live_artifact_collaborators` count is 0) must pass. They are already in place and are
   the gate for this issue.
