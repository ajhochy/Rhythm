---
date: 2026-08-06
repo: Rhythm
branch: mega/run-2026-08-04
pr: 1319
issues: [1305, 1325, 1328]
status: smoke-complete
tags: [run, Rhythm]
---

# K2 smoke, the #1305 shadow, and 413 tests that were not running

Finishing the last outstanding manual smoke item (K2) on `mega/run-2026-08-04`.
The item itself passed. Getting there exposed three defects, two of them in code
this branch had already "fixed".

## Files

- `tools/dev/launch_desktop_current.sh` — `install_engine` helper; stages the
  engine to BOTH resolution paths; `verify_running_engine` compares sha256.
- `apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart` —
  `await channel.ready` + explicit `_connected`; `wsUrl` test seam.
- `apps/desktop_flutter/test/features/agents/ws_send_queue_live_socket_test.dart`
  — new; real `HttpServer`, real `AgentsDataSource`.
- 65 desktop test fakes + `integration_test/follow_up_smoke_test.dart` —
  `send` signature and the two members `031e28e7` added.
- `docs/testing/mega-2026-08-04-smoke.md`, `docs/ai/project-state.md`.

Commits: `4eec569f`, `367ca25b`, `ee6ea444`.

## Checks

- Desktop: **1049 pass / 0 fail**, 0 analyze errors, format clean.
  Was 636 runnable before this run.
- `ws_send_queue_live_socket_test.dart`: 5/5, both regressions
  mutation-verified.
- Launcher: `bash -n` + shellcheck clean; live relaunch passes every gate.
- CI on `ee6ea444`: all five workflows triggered.

## Notes

### K2 attempt 1 was invalid, and the user caught it

After killing the app's server I started one by hand:
`cd apps/api_server && AGENT_LOCAL=true PORT=4001 npx tsx src/server.ts`.
`env.ts` defaults `dbPath` to `process.cwd()/rhythm.db`, so it opened a
13-message scratch DB, and because `ApiServerService` **reuses any healthy
server on :4001**, the client reconnected to that. I reported "message never
persisted" while the client was writing to a different database. AJ spotted it
instantly — "it's not reconnected to the right server, the sessions list is
unfamiliar."

There is a standing memory that says never start a bare manual server for smoke.
I had it and walked into the trap anyway. The correct procedure — kill the
app-owned subtree, let **Retry** respawn it so `DB_PATH` is right by
construction — is now written into the smoke doc.

### K2 attempt 2 — PASS

Session `2558d284` predated the outage (created `15:27:48Z`); :4001 died ~15:52;
the app respawned the server at `15:53:30Z`; `k2 test two` persisted at
`15:53:38Z` and the agent answered it. The 8-second gap is the whole result: the
frame was typed before the server existed and written after it returned.

### #1305 was a structural mismatch, not a stale file

`opencode_client_service` resolves `opencode_bin` three levels up, because in the
packaged bundle it is a SIBLING of `api_server`. Run from source, that same walk
lands on `apps/opencode_bin` — but the launcher staged only
`apps/api_server/opencode_bin`. Launcher and resolver disagreed *by design*, so
a verified-fresh build coexisted with a stale binary actually serving :4096.

Both binaries report the same `--version` (it carries the branch, not the build),
so only a content hash can prove which is live. Now: stage both paths, compare
sha256.

### The queue fix was half a fix

`WebSocketChannel.connect()` is lazy — it returns a channel before the socket
exists, and `sink.add` on that channel buffers instead of throwing. So
`_channel != null` never meant connected: a send during an in-flight reconnect
was swallowed, and `_flushPendingSends()` could drain the queue into a socket
that never came up.

The lesson worth keeping: `ws_send_queue_test.dart` passed the entire time,
because its fake modelled `connected` as an explicit flag. **The fake was correct
and the production code was not.** A contract restated against a fake tests the
restatement. The replacement drives the real class against a real socket, and
fails when the defect is reintroduced.

### 413 tests were not running

`031e28e7` changed `AgentsRepository.send` from `void` to `bool` without updating
the fakes, so 64 files failed to compile — one `Failed to load` each, every test
inside skipped. Desktop CI did not surface it because it died one step earlier at
`dart format --set-exit-if-changed`; that gate short-circuits before
`flutter test`, so the run looked like a formatting nit. Filed as #1328 (CI step
ordering). `flutter analyze` alone would have caught it — it reports
`invalid_override`.

Two corrections to the record: the state doc claimed all four CI workflows were
green, but Desktop CI had been red on `a625f4df`. And the MCP Server CI failure
on `367ca25b` was GitHub infra (`Service Unavailable` resolving action downloads),
not code.

### Process note

A `git stash push` naming an untracked file failed on the pathspec, so nothing
was stashed — and the following `git stash pop` applied an unrelated older stash,
leaving conflict markers in `docs/ai/project-state.md`. Recovered from HEAD (the
content was already committed) with the old stash left intact. Check that a
`stash push` actually succeeded before popping.
