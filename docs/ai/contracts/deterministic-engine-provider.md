# Deterministic Real-Engine Provider Probe Contract

**Date:** 2026-08-14  
**Surface:** production fork engine at `http://127.0.0.1:4097`  
**Executed test command:** `node /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/deterministic-engine-provider-probe.mjs`  
**Temporary harness:** removed after the passing run as required; the run note preserves sanitized evidence.

| ID | Mode | Observable criterion | Status |
|---|---|---|---|
| provider-probe-c1 | live | The worktree begins clean on `codex/react-electron-live-suite`, exactly at `origin/main` `9d8c4443`, and sandbox status identifies API `:4098` and engine `:4097`. | pass |
| provider-probe-c2 | live | The production fork is checked first for an existing internal deterministic provider; the selected strategy and evidence are reported. | pass |
| provider-probe-c3 | live | If no internal provider is usable, one temporary loopback OpenAI-compatible provider on a distinct free unprivileged port streams a unique nonce using throwaway authentication only. | pass |
| provider-probe-c4 | live | A real-engine session titled `smoke-provider-<nonce>` receives a nonce-bearing prompt and emits more than one stream transition/event before completion. | pass |
| provider-probe-c5 | live | A fresh real-engine message read after completion contains persisted assistant content with the unique nonce. | pass |
| provider-probe-c6 | live | The temporary real-engine session is deleted/closed and a subsequent lookup proves cleanup. | pass |
| provider-probe-c7 | live | Listener/connection evidence proves the probe used neither `:4001` nor `:4096`, and event payloads came from the live engine/provider rather than fixtures or replay. | pass |
| provider-probe-c8 | live | The temporary provider and probe files are removed, with no listener left on the provider port and only the two owned documentation files changed. | pass |

## Regression caught

This contract fails if the milestone relies on mocked/replayed output, a non-streaming provider,
an unpersisted response, an uncleaned session/provider, or either protected live-app port.

## Phase 0 expected failure

Before provider/session probing is implemented, the command must fail at the explicit
`strategy not configured` assertion. The run note records the command and failure excerpt.
