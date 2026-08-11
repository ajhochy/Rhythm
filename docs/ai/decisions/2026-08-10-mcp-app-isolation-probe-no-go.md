---
date: 2026-08-10
tags: [decision, Rhythm]
issues: [1343]
status: accepted
---

# MCP App isolation feasibility: NO-GO pending packaged evidence

## Context

Rhythm must not render untrusted MCP App HTML until a macOS host proves that
the official AppBridge and WKWebView can isolate a trusted outer shell from a
sandboxed app iframe. Issue #1343 requires debug and packaged-release evidence
for bridge ownership, nonce/origin/frame binding, per-view ephemeral storage,
CSP and navigation/network/download denial, finite resource limits, and
observable teardown.

This worker could compile and unit-test WebKit policy code on macOS 26.5.2
(arm64), Xcode 26.5, Swift 6.3.2. It could not perform the interactive DEBUG
matrix or produce and inspect a packaged Release build. The official MCP Apps
AppBridge package was not already resolved in the repository and cannot be
installed or authenticated offline, so its source/version was not guessed.

## Decision

**NO-GO.** Production MCP App WebView hosting remains blocked.

Retain only the disposable, DEBUG-compiled, explicit-env launcher and the
socket-free policy contract as feasibility evidence. The launcher is not part
of the Runner Xcode target and normal product code has no path to invoke it.
Do not add a permanent AppBridge/WebView dependency until M1–M6 pass for both
DEBUG and packaged Release on every supported macOS version.

The current evidence is:

- Five static/native policy contract cases pass.
- The standalone native launcher compiles and refuses to run unless
  `RHYTHM_MCP_APPS_ISOLATION_PROBE=1` is explicitly set.
- No interactive or packaged observation has been recorded.
- No official AppBridge version has been resolved and no dependency was added.

Exact commands and the outstanding matrix are recorded in
`docs/ai/contracts/issue-1343-manual-evidence.md` and
`docs/ai/runs/2026-08-10-issue-1343-mcp-app-isolation-probe.md`.

## Alternatives considered

- Claim GO from unit policy tests alone: rejected because static assertions do
  not prove WebKit process, storage, CSP, or teardown behavior.
- Add an unofficial/local bridge shim: rejected because it would not answer
  whether the official AppBridge is compatible or safe.
- Add the probe to `MainFlutterWindow`: rejected because a standalone harness
  provides the required test surface without creating a production bypass.

## Consequences

- Downstream production host work must treat this decision as fail-closed.
- A UI-capable orchestrator must resolve the official AppBridge, repeat M1–M6
  in DEBUG and packaged Release, and supersede this ADR only if every row passes.
- Failure of any row preserves NO-GO and requires no rollback because the
  shipping Runner has no probe registration or new dependency.
