---
date: 2026-09-24
tags: [decision, rhythm, hermes, issue-1569]
---

# #1569: Brokered credentials and memory capability contract

## Context

The approved direction is host-brokered, in-memory provider credentials for only the Rhythm-spawned, default Hermes backend. Rhythm must not write Hermes credential stores or share rotating grants. Astra's revised direction narrows eligible sources and strengthens the child-process boundary; this document freezes that corrected S0 contract. The durable planning source is `docs/ai/plans/2026-09-24-issue-1569-brokered-credentials-plan.md` in the integration worktree (2026-09-24); this S0 branch is documentation-only.

## Decision

1. Read only the validated OS-user OpenCode `auth.json`. Eligible entries must be static API entries (`type === "api"`, string key) for `openrouter`, `anthropic`, `openai`, or `google`, mapped respectively to `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`. OpenCode Zen is disabled: no `opencode` / `OPENCODE_ZEN_API_KEY` mapping.
2. A mixed `auth.json` may be read transiently to inspect eligible static entries, but OAuth values are never selected, retained, fingerprinted, logged, returned, or forwarded. Claude subscription discovery remains the existing upstream behavior; it is informational, not brokered and not a claim of race-free shared refresh.
3. A grant persists only references and user consent (Rhythm user, default profile, capability/provider, timestamps and schema metadata). It contains no credential value, digest, fingerprint, or value-derived identifier.
4. Credential and grants reads are descriptor-based and symlink-resistant: reject symlink paths/components, require expected owner/regular file/size bounds, open without following links where supported, and verify descriptor identity/path confinement before consuming bytes. Failure is closed and represented as unreadable/unknown; it never falls back to unsafe reads.
5. Spawn a clean child environment from an explicit allowlist. Set controlled `PATH`, `HOME`, temp directory variables, and locale; add only approved granted API-key variables (plus the separately gated memory capability endpoint). Do not inherit arbitrary `process.env`, secrets, approval tokens, relay tokens, proxy credentials, or loader/injection variables (`DYLD_*`, `LD_*`, `NODE_OPTIONS`, `PYTHON*`, etc.). Host-owned Hermes/session variables are set explicitly after sanitization. No grant injection into borrowed runtimes or non-default profiles.
6. Effective identity is the tuple `(server origin, Rhythm user, default Hermes profile, canonical Hermes home, source/capability, auth generation)`. A change invalidates effective eligibility. Grants apply only at the next owned backend start. Logout, server-origin change, or user change revokes the in-memory application and disposes the owned backend before another identity can use it. Rotation/removal is pending until the next start; disclose that a running process may retain its already-injected key until it is disposed.
7. Status must distinguish `absent`, `present`, `unreadable`, `malformed`, `unknown`, `configured`, `applied`, and `shadowed` without value disclosure or stronger claims than observed. In particular, API-file presence/configuration is distinct from proven child application; existing Anthropic credential discovery is not race-free shared refresh.
8. Every in-process memory read-modify-write path is serialized. Each mutation uses an optimistic digest check and a validated temporary write plus atomic rename. Two Rhythm writers must preserve both mutations; a Rhythm-versus-Hermes/Obsidian edit observed before the final digest check must survive and cause a retry or `MEMORY_NOTE_CONFLICT`; generated index/README readers must never see torn content. A non-cooperating external writer can still change a note after the final digest check but before Rhythm's rename. That narrow check-to-rename race remains explicit: there is no interoperable cross-process lock and no absolute no-lost-update claim for that window.
9. A note without valid Rhythm frontmatter is unmanaged. Rhythm may index and return it from search, but must never rewrite, delete, re-type, enroll, or add Rhythm frontmatter to it. Mutating operations fail closed with `MEMORY_NOTE_UNMANAGED`, leaving its bytes unchanged.
10. The shared vault/memory root has a generated aggregate ownership `README.md`. It identifies the owning tool for Rhythm-managed notes, unmanaged/user notes, Hermes working-memory files, logs, and indexes. Regeneration uses the same validated temporary-destination and atomic-rename discipline as the index; it is not a partially written or ambiguous ownership marker.
11. Hermes auth-store inspection is version-gated before provider enumeration. A recognized documented version may yield provider names only. An unrecognized version degrades to `unknown`/`unsupported` without inspecting secret fields, returning/logging/retaining values, throwing, or crashing.
12. Rhythm never opens, reads, or writes Hermes operational SQLite databases. Readiness inspection is limited to the documented auth/config files named in this contract; Hermes databases are outside the broker and inspector boundary.
13. Every grant mutation requires native main-owned confirmation bound to the exact mutation. IPC is closed-schema with strict size/enums; reject unknown fields and validate `ownsDocument`, main-frame status, trusted sender/origin URL, authentication, and ownership for every sender. Reject unauthenticated/non-owning senders. Renderer never supplies identity, path, or credential/memory value; main derives these from trusted state. S1/S2 tests for confirmation and sender/origin rejection are mandatory even when optional S6 remains disabled.
14. Memory search, if enabled, is query-only and returns bounded result count/snippets plus opaque IDs only. Labels/content are explicitly untrusted. The server enforces current user, server, profile, vault, and runtime generation on every request/result. Canonicalize and confine the vault root; reject traversal, symlink escape, stale-index results, redirects, and remote endpoints. Revoke immediately on identity/generation change or disposal. Absent a valid ephemeral server-enforced read-only capability, S6 remains disabled; no general/unauthenticated memory access or write/forget capability.
15. Source inspection confirms one shared upstream Keychain entry, not merely two independent Keychain readers. Rhythm's `apps/api_server/src/services/credentials_bridge_service.ts:324-330` invokes `security find-generic-password` for service `Claude Code-credentials`; Hermes' `agent/anthropic_adapter.py:988-1008` invokes the same command for the same service. S1 may describe that exact relationship as the same upstream Claude Code credential, while preserving the existing refresh-race caveat.
16. Grant-store writes use a validated temporary file followed by atomic rename. The grants file is mode `0600` inside a mode `0700` directory. A malformed or corrupt grants file applies no grants and reports `malformed`; it is never partially applied, silently normalized, or replaced as a side effect of the failed read.
17. Credential values and value-derived digests or fingerprints are excluded from production logs, diagnostics, crash reports, DTOs, error messages, and outbound requests to the Rhythm production API or telemetry destinations across S1, S2, and S7. Redaction and absence are tested with synthetic value and fingerprint sentinels in captured logs, serialized DTOs, failure paths, and captured outbound production-API/telemetry requests.
18. Rhythm exclusively owns the vault aggregates `index.md` and `log.md`; Hermes never writes either. The ownership `README.md` states these two rules explicitly so a model or human reading the shared tree cannot infer joint ownership.
19. Hermes' `MEMORY.md` and `USER.md` remain in their existing `~/.hermes/memories/` location and remain Hermes-owned working memory. Rhythm never moves, rewrites, enrolls, re-types, or deletes either file; S5 fixtures prove both files remain unchanged.
20. S1 inspection never opens Hermes credential stores (`.env`, `auth.json`, `config.yaml`, or `mcp-tokens`) with write-capable flags and never mutates them, even transiently. A focused synthetic-file test instruments opens and mutations and rejects either operation; before/after hashes remain an additional invariant, not the sole proof.

### Frozen host interface

Optional fork host callback, called only for Rhythm-owned default-profile spawn:

```ts
backendEnv?: (request: {
  serverOrigin: string;
  rhythmUserId: string;
  profile: "default";
  hermesHome: string; // canonical absolute path
  source: "opencode-auth-json" | "memory-search";
  authGeneration: string; // opaque generation, not a secret fingerprint
}) => Promise<Record<string, string>> | Record<string, string>
```

The callback result is an ephemeral env delta, never persisted. The host filters names and values, applies a bounded timeout/fail-closed behavior, redacts granted values from child logs, and uses the fixed allowlisted base environment. No call occurs for borrowed or non-default backends. The grants DTO is reference-only; status DTO reports source/readiness/lifecycle states only, never values or hashes.

### Slices, worktrees, ownership, and dependencies

All Rhythm slices use isolated worktrees from the approved Rhythm base/mega branch and only their listed files. Fork work uses the separately identified Hermes fork worktree/branch and must retain upstream provenance. Do not work in the primary/integration worktree. Coordinates verified 2026-09-24: local S0/planning base `e93eac6e`; Rhythm integration PR #1544 targets `main`, GitHub PR base SHA `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`, remote PR head `788e7ccc82bcca4bacc000940eecfeaed4fdd863`; companion repository `ajhochy/hermes-rhythm-plugin`, draft PR #17, branch `mega/2026-09-18-rhythm-plugin-finish`, base `main`, head `8ea642dbb6a8b8d65868c3e7a468c471914f037b`. Before implementation re-verify both repositories' current heads and rebase/review from current coordinates; do not treat the local S0 base as the GitHub PR base.

| Slice | Files / worktree | Interface and gate |
|---|---|---|
| S0 | Rhythm docs only: this decision, `docs/ai/contracts/issue-1569.json`, and S0 run/handoff. | Freeze this contract; no product/test edits. |
| S1 | Rhythm `apps/electron/src/hermes-accounts.mjs`, `main.mjs`, `preload.cjs`, corresponding Electron tests/package script. | Names/state-only readiness DTO; descriptor-safe inspection; owned-document IPC. Independent. |
| S2 | Rhythm `apps/electron/src/hermes-credential-broker.mjs`, IPC/preload/view integration and broker tests. | Reference/consent-only grants and callback implementation matching the frozen callback; depends S1 and S3 contract. |
| S3 | Companion repository `ajhochy/hermes-rhythm-plugin`, verified coordinates above; fork host files/tests in its actual reviewed/current tree, then rebuilt artifact/provenance and Rhythm `hermes-desktop-config.mjs` pin update in a separate Rhythm worktree. | Implement `backendEnv` and clean allowlist env boundary; no borrowed/non-default injection. Independent implementation, but S2 integration requires this contract. Fork source commit → reproducible build → integrity manifest → Rhythm pin, in that order. Record upstream repository, base/tag, exact source commit, build command/toolchain, artifact SHA-256 and integrity metadata. No opaque/prebuilt artifact substitution. Re-verify repository/branch/head and base before creating the implementation branch. |
| S4 | Rhythm `apps/web/src/components/tools/AgentSettingsTool.tsx`, new `aiAccountsBridge.ts`, focused web test/config. | Consume status DTO and grant references only; depends S1/S2. |
| S5 | Rhythm `apps/api_server/src/services/memoryVaultWriteService.ts`, `memory_vault_index_writer.ts`, `memory_vault_log.ts`, `memoryVaultSyncService.ts` and targeted tests. | Optimistic digest checks, conflict/fail-closed handling, atomic index publication; independent. Preserve explicit external-writer race limitation. |
| S6 | Rhythm broker endpoint wiring only if capability exists; Hermes fork `plugins/rhythm/` only after #1540's plugin base is integrated. | Ephemeral server-enforced read-only search grant; otherwise explicitly disabled. Depends S2/S3 and #1540. |
| S7 | Rhythm Electron live qualification test and run evidence; packaged candidate gate. | Integration qualification after S1–S6 applicable slices; never use real credential values. |

Parallelization: S1, S3, S5 can proceed independently in separate worktrees. S2 follows the frozen interface and coordinates with S3. S4 follows S1/S2. S6 follows S2/S3 and #1540. S7 follows all applicable slices. Do not parallelize overlapping file ownership.

### Validation and acceptance

Contract IDs, exact test targets, commands, and implementation status are in `docs/ai/contracts/issue-1569.json`. Intended targeted gates:

- Electron: `cd apps/electron && npm test && npm run typecheck` (include focused readiness/broker/host tests).
- S1 store preservation: `cd apps/electron && node --test test/hermes-accounts.test.mjs && npm run typecheck`; instrument write-capable opens and mutations against synthetic Hermes stores and compare before/after hashes.
- Fork: `cd apps/desktop && npx vitest run electron/embedded-host.test.ts electron/embedded-host-initialization.test.ts && npm run typecheck`.
- Web: `cd apps/web && npm run typecheck && npx playwright test --config tests/agent-settings-accounts-playwright.config.ts && npm run test:electron-slices`.
- Vault: `cd apps/api_server && npx vitest run src/__tests__/memory_vault_external_edit.test.ts src/__tests__/memory*.test.ts && npx tsc --noEmit`.
- S6: `pytest plugins/rhythm -q` only if enabled; disabled state is the required outcome otherwise.
- Live behavior (S7): with temporary HOME, HERMES_HOME and userData, run Hermes against a local mock endpoint selected by `OPENROUTER_BASE_URL` and submit a synthetic prompt. The mock itself must assert the received `Authorization` header equals the explicitly granted synthetic key. Revoke the grant and restart: a subsequent request must not contain any Rhythm key. Configure a Hermes-owned key and verify it shadows Rhythm's grant. Hash Hermes `.env`, `auth.json`, `config.yaml`, and `mcp-tokens` before/after and assert all hashes are unchanged. Assert neither logs nor returned DTOs contain the synthetic key. Capture outbound requests to Rhythm production API and telemetry destinations and assert synthetic credential value and fingerprint sentinels are absent, including failure paths. This is the exact mock gate; it does not replace any required real API/engine sandbox or packaged qualification. For sandbox runs build fork/API as required by `AGENTS.md`; use `tools/dev/sandbox.sh up/status/down`, never a hand-started API. Packaged test uses locally signed candidate, clean PATH, pinned artifact and credential scan.
- Manual final gate: AJ observes real profile state only; never print/read real values, hash before/after without content, verify no Hermes store writes, identity/logout behavior and disclose unresolved UI/provider caveats.
- Per slice run relevant focused tests, package/type checks, and `ai-workflow checks --level pr` as the issue-level gate before draft PR readiness. Tests use temporary directories and synthetic values only.

All implementation criteria remain pending and not tested at S0. No behavioral test was authored or waived for implementation; implementation verification remains mandatory. The documentation-only S0 action itself carries the explicit waiver in its run record. The authoritative manager-transcribed revised Astra review (specialist session `c9faabc0-f1ee-4037-b925-16384642de84`, 2026-09-24; not independently repo-readable) is [`docs/ai/reviews/2026-09-24-issue-1569-astra-review.md`](../reviews/2026-09-24-issue-1569-astra-review.md).

## Alternatives

- Rhythm writes keys into Hermes `.env` or `auth.json`: rejected; creates a foreign persistent secret copy, complicates ownership/rotation, and risks refresh-token contamination.
- Share OAuth grants: rejected; refresh-token rotation is client-bound and can revoke grants; OAuth is never selected or forwarded.
- OpenCode Zen mapping: rejected/disabled because provider identity is not approved for this contract.
- Inherit all of Electron `process.env` and strip a few known names: rejected; unbounded ambient secrets and loader hooks are not an acceptable child boundary.
- General or unauthenticated memory endpoint: rejected; S6 is disabled absent a server-enforced ephemeral read-only capability.
- Anthropic shared-refresh claim: rejected; retain accurate existing-discovery-only status and disclose race.

## Follow-ups

- F1: renderer exposure of the Rhythm session token through current-session IPC.
- F2: unauthenticated local agent-memory mutation routes bypassing MCP-side approval.
- F3: shared Claude Code refresh-token race among Claude Code, Rhythm and Hermes.
- F4 (moved from S0 plan): complete child-process environment inheritance risk; S3 must now remove this risk with the explicit allowlist. Track any remaining fixed-environment/platform gaps under S3; do not defer arbitrary inherited env.

## Consequences

No secret leaves the Rhythm auth store except a consented static API value transiently supplied to an owned Hermes child. The grant store cannot recover or attest to a credential value. Status is deliberately conservative. Restart/disposal semantics and residual secret lifetime are user-visible. S6 may ship disabled. S1–S7 do not inherit permission to write the real Hermes profile or publish/release artifacts.
