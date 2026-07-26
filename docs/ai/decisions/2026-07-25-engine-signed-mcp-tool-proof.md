---
date: 2026-07-25
repo: Rhythm
tags: [decision, Rhythm, security, mcp, opencode]
index: "[[Rhythm]]"
---

# Engine-signed MCP tool proof

## Context

Creative capability installation is a consequential local action. The local
API must distinguish a real OpenCode tool call from a model-controlled process
that sends HTTP directly to the loopback API.

An initial bearer design injected a dedicated credential into the API, engine,
and Rhythm MCP environments. Although direct HTTP callers could not guess that
credential, a same-user model shell could recover it from process environments
with `ps eww`. Loopback-only networking therefore did not make the bearer a
trusted boundary.

## Decision

The Rhythm OpenCode fork owns an ephemeral Ed25519 keypair in engine process
memory. The private key is never placed in configuration, environment
variables, logs, or files.

For every Rhythm MCP tool execution, the engine signs a versioned payload
containing:

- the raw MCP tool name;
- a canonical SHA-256 hash of the exact model-produced JSON arguments;
- SDK session, turn, agent, and tool-call identities authored by the engine;
- an issue timestamp; and
- a random one-time nonce.

The API fetches and pins the fork's public key only as part of API-owned engine
startup or restart. Request verification never rotates or re-pins a key.
Unknown keys, stale or future proofs, payload/tool/context changes, invalid
signatures, and nonce replay all fail closed.

The MCP process may forward the public proof, but it cannot mint or alter one.
The creative install route uses only the signed arguments and resolves the
durable Rhythm session from the signed SDK session ID.

## Alternatives

- A dedicated environment bearer was rejected because same-user process
  inspection exposes it.
- Trusting any loopback caller was rejected because model-controlled processes
  run under the same account.
- Request-time public-key refresh was rejected because an attacker that
  displaced the engine could select a replacement key.
- A persisted shared private key was rejected because it creates a recoverable
  secret with rotation and file-permission obligations.

## Consequences

- Engine restart rotates the proof key and requires API lifecycle code to pin
  the replacement before trusted action routes become available.
- Stock OpenCode engines without the Rhythm key endpoint continue to run, but
  trusted local action routes fail closed.
- The fork/API boundary now has behavioral coverage through a real model
  stream, real MCP process, real signed tool call, approval persistence,
  direct-forgery rejection, replay tests, and process-environment inspection.
