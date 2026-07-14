---
date: 2026-07-14
repo: Rhythm
branch: feat/dev-sandbox-isolation
tags: [decision, rhythm, dev-sandbox]
index: "[[Rhythm]]"
---

# Isolate local development sandboxes by ports, paths, and process tree

## Context

The desktop app owns api port 4001 and an Opencode engine on 4096. Starting a
second server on the default engine port can invoke stale-port reclamation
against the live engine. Shared HOME and SQLite paths also let a test server
modify live agent files, auth state, memory-vault contents, or scheduled work.

## Decision

Use a fixed headless sandbox: API 4098, engine 4097, temporary HOME/vault,
SQLite `.backup` copy, and a separately built fork binary. Resolve
`RHYTHM_OPENCODE_ENGINE_PORT` once at api_server module load and pass it
explicitly to the SDK. Disable all copied scheduled tasks before launch.

## Alternatives

- Containers or a VM: unnecessary for these local path and port boundaries.
- Harden stale-port reclamation ownership checks: deferred; distinct ports
  prevent the live-engine collision without changing recovery behavior.
- Share the live database or HOME: rejected because either permits live writes.

## Consequences

Sandbox runs retain real copied data and auth, so their directory remains
sensitive local data and `down` removes it. The sandbox has its own in-process
run pool and must re-enable only a deliberately tested scheduled task.
