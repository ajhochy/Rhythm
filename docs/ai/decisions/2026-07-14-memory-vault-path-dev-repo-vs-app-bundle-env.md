---
date: 2026-07-14
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# MEMORY_VAULT_PATH is correctly set — in the running app bundle's `.env`, not the dev repo's

## Context

While diagnosing why injected memories sometimes feel irrelevant, a search for
`MEMORY_VAULT_PATH` across the dev repo's `.env` files
(`/Users/ajhochhalter/Documents/Rhythm/.env`,
`apps/api_server/.env`) found no override, and `env.ts`'s documented default
(`~/Documents/Memory-Vault`) resolves on disk to a near-empty folder (2 stray
notes). This looked like a real bug: Rhythm's memory system appearing to read
from the wrong, nearly-empty vault instead of the real
`~/Documents/Obsidian Vault/AGENT-MEMORY/` (168 notes across
context/person/feedback/preference/project/fact/reference).

That conclusion was wrong. The actually-running process is **not** started
from the dev repo — `ps aux` showed the live api_server as
`/Applications/Rhythm.app/Contents/Resources/api_server/dist/server.js`, a
separately built/deployed bundle with its own `.env`
(`/Applications/Rhythm.app/Contents/Resources/api_server/.env`). Reading that
process's live environment (`ps eww -p <pid>`) confirmed:

```
MEMORY_VAULT_PATH=/Users/ajhochhalter/Documents/Obsidian Vault/AGENT-MEMORY
```

This matches `2026-07-02-memory-vault-env-injection-scope.md`'s intended
behavior exactly — the app bundle's env is correctly pointed at the real
168-note vault. The Brain UI and agent-referenced memories AJ observed were
already correct; the dev-repo `.env` search was a false trail.

## Decision

No code change. This is a "don't re-litigate this" note for future
diagnosis:

- **The dev repo's `.env` / `apps/api_server/.env` is NOT what the shipped
  desktop app runs with.** The running Rhythm.app has its own bundled
  `.env` at `/Applications/Rhythm.app/Contents/Resources/api_server/.env`,
  rebuilt/copied at package time (see bundle timestamp vs repo checkout —
  they can drift).
- To check what env a LIVE Rhythm session is actually using, read the
  running process's env directly rather than grepping repo `.env` files:
  ```
  ps aux | grep api_server/dist/server.js   # find the pid
  ps eww -p <pid> | tr ' ' '\n' | grep -i MEMORY
  ```
- `MEMORY_VAULT_PATH` is confirmed correctly set to
  `~/Documents/Obsidian Vault/AGENT-MEMORY` in the running app today
  (2026-07-14). No action needed on path resolution.

## Consequences

- Future memory-injection debugging should check the live process env (or
  the Brain UI directly) before assuming a dev-repo config file reflects
  production/desktop-app behavior.
- The real, still-open problem is retrieval SCORING, not path resolution —
  see `docs/ai/generated-issues/14-followup-engraph-semantic-memory-retrieval.md`.
