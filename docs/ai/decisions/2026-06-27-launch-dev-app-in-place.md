---
date: 2026-06-27
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Launch the Debug desktop app in place for repo-local agent-server smoke tests

## Context

In development, `ApiServerService._findServer()` locates
`apps/api_server` by walking upward from the running Rhythm executable. The
existing `tools/dev/launch_desktop_current.sh` copies the built app to
`/private/tmp/Rhythm Current.app` and also starts a separate API server on
`:4000`. From `/private/tmp`, the app cannot discover the repo-local agent
server source, while the separate server can contend for the fixed opencode
port `:4096`.

## Decision

For smoke tests that require the app-spawned `:4001` server and a repo-local
staged opencode fork:

1. Ensure `:4000`, `:4001`, and `:4096` are free.
2. Build with `flutter build macos --debug`.
3. Launch the Debug product directly from
   `apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app`.
4. Verify both the `:4096` listener executable path and its version before
   treating the smoke environment as valid.

## Alternatives considered

- Launch the `/private/tmp` copy — rejected because dev server discovery cannot
  reach the repo from that executable path.
- Start the agent server manually — rejected for this smoke because it bypasses
  the GUI spawn path under test.
- Re-sign or Gatekeeper-approve the fork before launch — unnecessary in this
  run; the engine launched and loaded its extracted dylib without a denial.

## Consequences

- The app itself owns the `:4001` server lifecycle, and only that server owns
  the `:4096` engine.
- The dev resolver sees `apps/api_server/opencode_bin/opencode` before the
  system binary.
- `tools/dev/launch_desktop_current.sh` remains unchanged and must not be used
  as-is for this specific engine smoke workflow.
