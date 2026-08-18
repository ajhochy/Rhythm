---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [electron-m1-slice-0]
status: pass
tags: [run, Rhythm, electron, live-engine]
---

# Electron M1 Slice 0 — deterministic real-engine provider probe

## Files

- `docs/ai/contracts/deterministic-engine-provider.md`
- `docs/ai/runs/2026-08-14-electron-m1-provider-probe.md`
- Temporary harness: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/deterministic-engine-provider-probe.mjs` (removed after PASS)

No product code, manifests, lockfiles, API server, engine fork, Flutter, or prototype files changed.

## Phase 0 baseline

Command:

```bash
git status --short --branch && git rev-parse HEAD && git rev-parse origin/main && git branch --show-current
```

Observed:

```text
## codex/react-electron-live-suite...origin/main
9d8c4443f076756cec919e182222fdb45c39abcc
9d8c4443f076756cec919e182222fdb45c39abcc
codex/react-electron-live-suite
```

Command:

```bash
tools/dev/sandbox.sh status
```

Observed before probing:

```text
api :4098 listener: 78645
engine :4097 listener: 78666
gateway :4099 listener: 78645
```

The sandbox was already healthy. It was not started, stopped, or hand-launched.

## Acceptance-contract red run

Command:

```bash
node "/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/deterministic-engine-provider-probe.mjs"
```

Expected failing excerpt before probe implementation:

```text
AssertionError [ERR_ASSERTION]: strategy not configured: deterministic provider/session probe has not run
```

Result: **FAIL as required before implementation**.

## Strategy selection

The production engine's real `GET /provider` response was filtered for provider/model IDs or
names containing `test`, `mock`, `fixture`, `fake`, or `deterministic`, and for loopback URLs.
The exact internal-provider result was empty:

```json
{"exactInternal":[]}
```

The engine did expose its standard custom `lmstudio` OpenAI-compatible definition. Its configured
model `qwen/qwen3-coder-30b` points at `http://127.0.0.1:1234/v1`. Port `1234` was confirmed free,
distinct from `4097`, `4098`, `4099`, `4001`, and `4096`, then selected for the temporary provider.
No internal deterministic provider was available, so the required fallback strategy was used.

Authentication was a nonce-derived throwaway value supplied through the real engine auth API. It
is intentionally not recorded. The temporary auth record was deleted after the probe and the
supervised engine restart was allowed to complete; no API or engine process was hand-started.

## Passing real-engine probe

Command:

```bash
node "/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/deterministic-engine-provider-probe.mjs"
```

Sanitized observed output:

```json
{
  "result": "PASS",
  "strategy": "temporary loopback OpenAI-compatible provider via existing lmstudio provider definition",
  "nonce": "electron-m1-59bc8052776bdaed",
  "engine": {
    "url": "http://127.0.0.1:4097",
    "pid": 92103,
    "version": "0.0.0-codex/react-electron-live-suite-202608142141",
    "bootId": "cbc863df-c508-4f9a-974d-495ea0e51be8"
  },
  "provider": {
    "host": "127.0.0.1",
    "port": 1234,
    "providerID": "lmstudio",
    "modelID": "qwen/qwen3-coder-30b",
    "requestCount": 1
  },
  "stream": { "totalSessionEvents": 28, "deltaOrUpdateEvents": 8 },
  "persistence": { "nonceObservedAfterFreshRead": true },
  "cleanup": { "sessionDeletedAnd404": true, "throwawayAuthRemoved": true },
  "protectedPorts": { "engineSampleContains4001Or4096": false },
  "fixtureSubstitution": { "providerReceivedPromptNonce": true, "engineEventsObserved": true }
}
```

The harness created `smoke-provider-electron-m1-59bc8052776bdaed` through `POST /session`, opened
the real `GET /event` SSE stream, and prompted through `POST /session/:id/message`. The provider
emitted three delayed OpenAI-compatible chunks plus the finish chunk. The engine exposed eight
message delta/update events before the prompt completed. A new `GET /session/:id/message` read
contained the nonce in persisted assistant text. `DELETE /session/:id` returned `true`, and a fresh
session lookup returned `404`.

This was not fixture/replay substitution: the temporary provider recorded exactly one live
`/v1/chat/completions` request containing the nonce, the production engine emitted 28 session SSE
events, and persisted engine content contained the same nonce after a fresh read.

## Protected-port and cleanup proof

During the live provider request, `lsof -nP -a -p 92103 -iTCP` contained the engine-to-provider
`127.0.0.1:1234` socket and contained no TCP endpoint on `:4001` or `:4096`. Every harness HTTP call
was guarded to require the `http://127.0.0.1:4097` prefix.

Post-run commands and observations:

```bash
tools/dev/sandbox.sh status
# api :4098 listener: 78645
# engine :4097 listener: 93273
# gateway :4099 listener: 78645

node -e '<query GET /provider and GET /session through 127.0.0.1:4097>'
# {"lmstudioConnected":false,"smokeSessionCount":0}

if lsof -nP -iTCP:1234 -sTCP:LISTEN; then exit 1; else printf 'provider port 1234 has no listener\n'; fi
# provider port 1234 has no listener

ENGINE_PID=$(node -e '<read 127.0.0.1:4097/global/health PID>') && \
  lsof -nP -a -p "$ENGINE_PID" -iTCP
# engine PID 93273 has no TCP endpoint on 4001 or 4096
```

The temporary harness was then deleted. Ports `4001` and `4096` were never contacted or managed.

## Result

**PASS** — all eight observable contract criteria passed through the production fork engine.
