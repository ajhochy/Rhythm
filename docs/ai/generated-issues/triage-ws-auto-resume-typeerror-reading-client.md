# triage(agents): WS auto-resume of pre-existing session throws `TypeError: Cannot read properties of undefined (reading 'client')`

## Status

**Triage required.** Source not yet identified. Filed during the `vbeta.18.32` manual smoke (PR #617). Diagnosis attempt during smoke pointed at `opencode_client_service.ts:333` (`respondPermission`), but the line reads `.session` not `.client`, and the user wasn't responding to a permission, so that diagnosis is wrong. The error string almost certainly originates inside `@opencode-ai/sdk` (the bundled JS, not source we control) or in a chained call where the first object is undefined.

## Reproduction

1. Launch Rhythm `vbeta.18.32` from `/Applications/Rhythm.app/`.
2. Wait for `/opencode/auth` → `ready: true`.
3. Force the api_server child to be killed (any of these triggers it): Cmd+Q + relaunch (the lifecycle bug means children orphan), or `lsof -tiTCP:4001 -sTCP:LISTEN | xargs kill`, or just relaunch the app.
4. After the new api_server is up (`opencodeSessionMap` is empty), open an existing session row in the Agents UI.
5. Type any message and press Send.

Expected: message sends, session resumes.

Actual: red error bubble appears: `Error: TypeError: Cannot read properties of undefined (reading 'client')`. No further turns can be sent in that session. Workaround: create a brand-new session.

## What we know

- `/opencode/auth` reports `ready: true` and lists all four providers, so the SDK itself is initialized cleanly.
- The auto-resume branch in [ws_gateway.ts](apps/api_server/src/services/ws_gateway.ts) around lines 220–260 calls `await opencodeClient.createSession(...)`, then dynamic-imports `./opencode_stream_bridge` and calls `streamBridge.streamSession(...)`. Both have null/error guards that surface user-visible messages (`'Could not resume session — Opencode engine unavailable.'`) — and the user is **not** seeing that message, so the error is firing past those guards.
- The opencode subprocess on `:4096` is alive at the time of the error.
- The error string `reading 'client'` means some expression of the form `X.client` is being evaluated with `X` undefined. The user-visible TypeError suggests it surfaces as a server-side error message back through the WS pipe.

## Where to look next

- Inspect what `opencodeClient.subscribeToEvents(directory)` returns when called on a freshly-created (resumed) session vs. a never-before-streamed one. The shape may differ.
- Trace inside `@opencode-ai/sdk`'s `session.prompt` and `session.promptAsync` for any `result.client.x` deref.
- Check whether `opencodeSessionMap.set(localId, sdkId)` is racing the subsequent `prompt` call — if the prompt fires before the map write commits visibility to the listener, the listener could try to look up a client-side handle that isn't there.
- Inspect the `_listen(directory)` loop in [opencode_stream_bridge.ts](apps/api_server/src/services/opencode_stream_bridge.ts) — does any path inside the listener access a per-session client handle that only exists after a fresh `createSession`?

## Workaround until fixed

In the UI, after any api_server restart, **create a new session** instead of continuing an old one. The new-session path goes through `createSession` cleanly and does not hit this branch.

## Out of scope

This issue is filed separately rather than fixed in PR #617 because: (a) the root cause is not yet identified and the diagnosis attempt was wrong, (b) the user has a clean workaround, and (c) fixing the api_server SIGTERM lifecycle (this PR) plus the new-session model-picker bug (also this PR) collectively reduces how often users hit this path — fewer api_server restarts means fewer orphaned sessions to auto-resume.

## Acceptance criteria

- [ ] Identify the exact source of `reading 'client'` — file + line + expression.
- [ ] Either guard the offending deref with a null check + surface a meaningful error to the UI, OR fix the upstream condition that makes the deref necessary.
- [ ] Reproduction sequence above no longer surfaces the TypeError; the prompt either succeeds (resume worked) or fails with a human-readable message + the UI offers "Start fresh" affordance.
- [ ] Regression test in `agents_ws_e2e.test.ts` covering the kill-server-then-resume path.
