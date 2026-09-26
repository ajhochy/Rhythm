---
date: 2026-09-24
repo: Rhythm
issue: 1569
review: c9faabc0-f1ee-4037-b925-16384642de84
status: manager_directed_reconciliation
tags: [review, rhythm, issue-1569, astra]
---

# S0 repair 2 reconciliation — #1569 boundaries

This S0 repair 2 is a manager-directed reconciliation of the contract against the planning source. It is not an independent Astra approval, implementation approval, or test result. The earlier memo content remains an authoritative manager transcription of specialist session `c9faabc0-f1ee-4037-b925-16384642de84`, reviewed 2026-09-24; that session is not repo-readable here. The original review identified durable-review/mock/cross-repo coordination gaps. Corrected boundaries:

1. **Eligible source and provider mapping:** read only validated OS-user OpenCode `auth.json`; forward only static `type: "api"` key entries for OpenRouter, Anthropic, OpenAI, and Google, mapped to their named API-key environment variables. OpenCode Zen is disabled (no `opencode` mapping).
2. **Mixed auth/OAuth:** a mixed file may be read transiently for eligible static entries, but OAuth values are never selected, retained, fingerprinted, logged, returned, or forwarded. Claude subscription discovery remains existing upstream behavior; do not claim brokered or race-free shared refresh.
3. **Reference grants:** persist consent and references only (user, default profile, provider/capability, timestamps/schema); never persist credential values, digests, fingerprints, or value-derived identifiers.
4. **Descriptor safety:** credential and grant reads reject symlink paths/components, validate owner/regular-file/size, use no-follow open where supported, and verify descriptor identity/path confinement before consuming bytes. Unsafe reads fail closed as unreadable/unknown; no unsafe fallback.
5. **Explicit clean child environment:** construct from a fixed allowlist with controlled PATH, HOME, temp paths and locale. Add only granted static API keys and an explicitly gated memory endpoint. Do not inherit ambient secrets, proxy/approval/relay credentials, or loader/injection variables (`DYLD_*`, `LD_*`, `NODE_OPTIONS`, `PYTHON*`, etc.). Set host-owned Hermes/session values explicitly. No injection for borrowed runtimes or non-default profiles.
6. **Identity, auth generation, lifecycle:** bind eligibility to `(server origin, Rhythm user, default profile, canonical Hermes home, source/capability, auth generation)`. Apply only on the next owned backend start. Logout/origin/user change revokes in-memory application and disposes the owned backend before another identity uses it. Rotation/removal cannot erase a running child's injected key; disclose its lifetime until disposal.
7. **Honest status and residual secrets:** distinguish absent/present/unreadable/malformed/unknown/configured/applied/shadowed only as observed; DTOs and logs reveal neither values nor hashes. API-file presence is not proof of child application. Disclose Anthropic discovery's shared-refresh race and residual running-child secret lifetime.
8. **Optimistic vault limits:** detect external edits and publish indexes atomically, but state plainly that a digest check narrows—not eliminates—the external-writer race between final check and rename. Do not claim cross-process locking.
9. **Grant mutation confirmation:** every grant mutation requires native, main-process-owned confirmation bound to the exact proposed mutation. Renderer intent alone, including a renderer-supplied confirmation claim, cannot authorize, create, change, or revoke a grant.
10. **Closed IPC and sender boundary:** IPC uses closed schemas with strict size and enum bounds; reject unknown fields/values and oversized payloads. Validate `ownsDocument`, main-frame status, and trusted URL on every relevant sender; reject unauthenticated and non-owning senders. Renderer never supplies or selects identity, filesystem path, or credential/memory value; main resolves these from trusted session/host state.
11. **Memory query-only output:** search is query-only, bounded by count and snippet length, and returns opaque IDs only (no paths or mutation handles). Labels and content are explicitly untrusted data. Enforce current Rhythm user, server origin, profile, vault, and runtime generation on the server for every request/result; renderer claims are not authority.
12. **Memory path/index/redirect boundary:** canonicalize and confine the vault root; reject symlink escape, traversal, stale-index results, redirects, and remote endpoints. Revoke the ephemeral capability immediately on identity/generation change or disposal. If any prerequisite/capability is absent, S6 remains disabled; no unauthenticated/general memory access or write/forget capability.
13. **S0–S7 ownership and gates:** S0 is only the four authorized docs including this memo. S1 owns inspector/status IPC and safe source inspection; S2 owns grant/broker and depends on S1/S3 contract; S3 owns Hermes fork clean-env `backendEnv`, provenance/build, then Rhythm pin update; S4 owns UI and follows S1/S2; S5 owns vault optimistic edits/atomic index; S6 is gated/disabled and depends on S2/S3/#1540; S7 owns live and packaged/manual qualification after applicable slices. S1/S3/S5 may proceed independently in disjoint worktrees. F1 renderer session-token exposure, F2 unauthenticated local memory mutation routes, F3 Claude refresh race, and F4 arbitrary environment inheritance (now a mandatory S3 fix, not deferred) remain tracked follow-ups.

## S0 repair 2 manager reconciliation

The manager directed restoration of six safeguards present in the planning coverage matrix but absent or insufficiently explicit in the first contract candidate:

1. Untyped notes remain unmanaged: Rhythm never rewrites, deletes, re-types, enrolls, or adds frontmatter to them, and they remain searchable.
2. The shared vault/memory root contains a generated aggregate ownership README that identifies which tool owns each note/file/index class and is regenerated with validated temporary-write plus atomic rename.
3. In-process memory mutations serialize and use optimistic digest validation plus atomic rename. Two Rhythm writers preserve both mutations; a Hermes/external edit observed before the final check survives through retry/conflict; index/README content is never torn. The non-cooperating external write after final digest check but before rename remains a known race, so the contract makes no cross-process-lock or absolute no-lost-update claim for that window.
4. Hermes auth inspection gates on a recognized store version before provider enumeration. An unknown version reports unknown/unsupported without inspecting secret fields or crashing.
5. Rhythm never opens or reads Hermes operational SQLite databases; inspection is limited to the documented auth/config files.
6. Native exact-mutation grant confirmation and sender/document/main-frame/trusted-origin/authentication/ownership rejection are mandatory S1/S2 test targets even if optional S6 remains disabled.

These points are reconciliation instructions, not independent Astra findings or approval. They are represented by six new pending criteria in the contract and remain unverified until their owning implementation slices run the listed tests.

## Verified companion coordinates (2026-09-24)

- Companion repository: `ajhochy/hermes-rhythm-plugin`
- Draft PR: #17
- Branch: `mega/2026-09-18-rhythm-plugin-finish`
- Base: `main`
- Head: `8ea642dbb6a8b8d65868c3e7a468c471914f037b`
- Rhythm local S0/planning base: `e93eac6e`.
- Rhythm integration PR: #1544; target branch `main`; GitHub PR base SHA `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`; remote PR head at verification: `788e7ccc82bcca4bacc000940eecfeaed4fdd863`.

Hermes #17 coordinates above are unchanged. Before implementation, re-verify both repositories' current target/base/head coordinates and branch/rebase/review against current heads; the local planning base, GitHub PR base, and remote PR head are distinct coordinates. These are a dated snapshot, not a license to build from stale base/head.

## Frozen S7 mock behavior gate

Use disposable temporary HOME, HERMES_HOME, userData and vault, synthetic credential values, a local mock provider endpoint selected via `OPENROUTER_BASE_URL`, and a synthetic prompt. The mock endpoint itself must assert `Authorization` equals the granted synthetic key. After revoking the grant and restarting, the next prompt/request must carry no Rhythm key. When a Hermes-owned key is configured, prove it shadows the Rhythm grant. Hash Hermes `.env`, `auth.json`, `config.yaml` and `mcp-tokens` before/after and assert all hashes are unchanged. Assert logs and returned DTOs disclose no synthetic key. The local mock behavioral gate does not substitute for required sandbox/API/engine or packaged qualification.

The canonical contract is [`../contracts/issue-1569.json`](../contracts/issue-1569.json); implementation and behavior remain unverified at S0.

## S0 repair 3

S0 repair 3 (2026-09-24): manager-directed reconciliation after AJ revalidation; not independent Astra approval.

AJ revalidated five required coverage items: source-backed same-entry Keychain status, fail-closed atomic grant persistence and permissions, production/diagnostic non-disclosure, exclusive Rhythm ownership of `index.md` and `log.md`, and preservation in place of Hermes `MEMORY.md` and `USER.md`. They are now explicit pending criteria and decisions; no implementation evidence or approval is claimed.

## S0 repair 4 — independent review findings addressed

The separate read-only review receipt at `/private/tmp/rhythm-codex-takeover-review/1569-independent-review.md` gave the pre-repair S0 contract a FAIL verdict: unchanged Hermes-store hashes could miss a write-capable open or mutate/restore operation, and S7-c3 omitted credential transmission to Rhythm production API or telemetry destinations. The manager authorized this bounded documentation repair and an independent re-review. Pending S1-c8 now requires a synthetic focused test that instruments and rejects write-capable opens and mutations while retaining hash checks. Pending S7-c3 now requires synthetic value/fingerprint sentinel assertions on captured outbound production-API and telemetry requests, including failure paths. The decision and run records reflect both additions. This repair does not constitute independent approval, implementation evidence, or a frozen S0 verdict; re-review remains required.
