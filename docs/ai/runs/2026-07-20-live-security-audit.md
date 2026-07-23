---
date: 2026-07-20
repo: Rhythm
branch: main
pr: null
issues: [1133, 1134, 1135]
status: complete-with-high-findings
tags: [run, Rhythm, security, audit]
index: "[[Rhythm]]"
---

# Live Security Audit — 2026-07-20

## Executive Summary

- DuneSlide: **FAIL** — the Rhythm MCP server itself exposes no path-bearing tool parameters, but the shipping agent engine and local API expose `workdir`, `cwd`, `directory`, `worktreeDir`, `path`, and `filePath` surfaces whose authorization is lexical, not symlink-canonical. Issue [#1133](https://github.com/ajhochy/Rhythm/issues/1133).
- GitLost: **FAIL** — the email-assistant role can read attacker-controlled Gmail content and then send email or write shared Rhythm messages in the same context. Content is fenced with model instructions but is not scanned or taint-gated. Issue [#1134](https://github.com/ajhochy/Rhythm/issues/1134).
- Engraph: **PASS** — semantic retrieval is opt-in, has a hard 1,000 ms fail-closed timeout, defaults to FTS, and the live manager is disabled with no executable configured.
- Rogue Profile: **FAIL** — the database row is disabled and hidden, but the stale projected agent file remains loaded by the live engine as a Gemini subagent. Issue [#1135](https://github.com/ajhochy/Rhythm/issues/1135).

No exploit was attempted. No agent was invoked, no email was sent, and no production data or configuration was modified. The only external writes were the three required GitHub security issues.

## Findings

### Phase 1: DuneSlide Sandbox Escape

**Status:** FAIL

#### MCP schema inventory

`apps/mcp_server/src/tools` contains no MCP tool input named `working_directory`, `cwd`, `directory`, `path`, `filePath`, or `file_path`. The `path` argument in `api_client.ts` is an internal HTTP-route string, not a model-supplied filesystem path. Therefore the standalone Rhythm MCP tool schemas pass this narrow check.

The shipping agent runtime is nevertheless exposed to equivalent path-bearing **core engine tools** and local REST adapters. Those are security-relevant because model tool calls and local agent sessions reach them directly.

#### Tools with directory or file-path inputs

1. **`shell`** — parameter: `workdir`. Validation before use: **partial** (non-empty schema plus lexical `path.resolve` and permission evaluation). Fail-closed: **no** for an in-root symlink. Symlink-safe: **no**. The process is spawned with the unresolved path as `cwd`. Relevant symlink-escape test: **no**. Risk: **HIGH**.
2. **`read`** — parameter: `filePath`. Validation before use: **partial** (lexical external-directory permission). Fail-closed: **no** for an in-root symlink. Symlink-safe: **no**. Relevant test: **no**; direct outside paths and `..` are tested. Risk: **HIGH**.
3. **`write`** — parameter: `filePath`. Validation before use: **partial** (lexical permission). Fail-closed: **no** for a symlinked file or parent directory. Symlink-safe: **no**. Relevant test: **no**. Risk: **HIGH**.
4. **`edit`** — parameter: `filePath`. Validation before use: **partial** (lexical permission). Fail-closed: **no**. Symlink-safe: **no**. Relevant test: **no**. Risk: **HIGH**.
5. **`apply_patch`** — parameter: `patchText`, with file paths embedded in patch hunks. Validation before use: **partial** (`path.resolve` plus the same lexical external-directory permission). Fail-closed: **no**. Symlink-safe: **no**. Relevant test: **no**. Risk: **HIGH**.
6. **`glob`** — parameter: `path`. Validation before use: **partial** (type check and lexical permission). Fail-closed: **no**. Symlink-safe: **no**. Relevant test: **no**. Risk: **HIGH** because escaped files become model context.
7. **`grep`** — parameter: `path`. Validation before use: **incorrectly ordered**: permission is checked on the lexical path, then `AppFileSystem.resolve()` canonicalizes it. Fail-closed: **no**. Symlink-safe: **no** because real-path resolution occurs after authorization. Relevant escape test: **no**. Risk: **HIGH**.
8. **`lsp`** — parameter: `filePath`. Validation before use: **partial** (lexical permission). Fail-closed: **no**. Symlink-safe: **no**. Relevant test: **no**. Risk: **HIGH**.
9. **`repo_overview`** — parameter: `path`. Validation before use: **partial** (lexical permission and later directory stat). Fail-closed: **no**. Symlink-safe: **no**. Relevant test: **no**. Risk: **HIGH**.

Adjacent local API path surfaces:

10. **`GET/POST/DELETE /opencode/worktrees` and `POST /opencode/worktrees/reset`** — parameters: `directory`, `worktreeDir`. Validation: **non-empty string only**. Fail-closed confinement: **no**. Symlink-safe: **no**. Tests: functional and missing-parameter tests exist; escape tests do not. Risk: **HIGH**.
11. **`POST /agent-sessions`** — parameter: `cwd`. Validation: **non-empty string plus tilde expansion**. The value is then used for VCS checkout, worktree creation, project lookup, and engine session creation. Root allowlist: **no**. Symlink-safe: **no**. Relevant escape test: **no**. Risk: **HIGH** when the local endpoint is reachable by an agent or compromised UI context.
12. **Session file proxy (`.../files/list`, `.../files/content`)** — parameter: `path`. Validation: **lexical `path.resolve` prefix comparison**. Fail-closed for `..`: **yes**. Symlink-safe: **no**. Tests: `..` traversal exists; symlink escape does not. Risk: **HIGH** for file disclosure through an in-root symlink.
13. **Agent/skill discovery selectors** — parameters: `cwd` or `directory`. Validation: **none before SDK query**. These are read-only registry/discovery surfaces, not direct file writers. Symlink-safe: **no documented check**. Risk: **MEDIUM**.
14. **`POST /engraph-manager/choose-binary`** — parameter: `path`. Validation: **yes**: `realpathSync` occurs before use; the resolved target must be executable and must return an `engraph X.Y.Z` identity from a fixed `execFile(..., ['--version'])` call. Fail-closed: **yes** for resolution and validation failures. Symlink-safe: **yes for canonicalization**, with dedicated tests. Risk: **LOW for symlink escape**, although this remains a privileged binary-selection endpoint.

#### Exact vulnerable primitives

`apps/opencode_fork/packages/core/src/filesystem.ts` authorizes lexical containment:

```ts
export function contains(parent: string, child: string) {
  return !relative(parent, child).startsWith("..")
}
```

`apps/api_server/src/routes/opencode_worktrees_routes.ts` validates only presence:

```ts
function requireDirectory(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw ...
  return value;
}
```

Neither primitive resolves the target and allowed root to canonical real paths before authorization. This is CWE-59 (Improper Link Resolution Before File Access) plus CWE-22 (Improper Limitation of a Pathname to a Restricted Directory).

**Risk Assessment:** A symlink inside an allowed project can point outside it while still satisfying the lexical containment check. `shell.workdir` can then execute in the escaped directory, while read/write/edit/patch tools can disclose or modify out-of-root files without the expected external-directory permission transition.

**Remediation Required:** yes. Canonicalize existing targets with `fs.realpath()` before authorization; for new write targets, canonicalize the nearest existing parent; reject ambiguous resolution; authorize the canonical path; and add symlink-escape tests plus a real-engine live behavioral test. Tracked in [#1133](https://github.com/ajhochy/Rhythm/issues/1133).

### Phase 2: GitLost Prompt Injection

**Status:** FAIL

#### Untrusted → agent-write paths

1. **Gmail subject/snippet/body → email assistant → Gmail send and Rhythm shared messages** — `rhythm_search_gmail` and `rhythm_read_email` place attacker-controlled content in model context. The same role grants `rhythm_send_email`, `rhythm_send_message`, and `rhythm_create_message_thread`. Write-back to the same source: **yes**. Shared-resource write: **yes**. Context scanner: **no**; structural fence only. Risk: **HIGH**.
2. **GitHub issue/comment → development agent through `gh`/shell → GitHub issue/PR/comment writes** — public issue content can be read into a broad development session that retains authenticated `gh` write capability. Write-back to the same public source: **yes**. Context scanner: **no central tool-result scanner**. Risk: **HIGH**.
3. **Web pages and general MCP responses → research agent → Obsidian notes and Rhythm tasks** — externally controlled web/tool text becomes model context, while the research role can write internal shared artifacts. Write-back to the same public source: usually **no**; shared internal write: **yes**. Scanner: depends on the connector; no universal scanner. Risk: **MEDIUM**.
4. **Signed webhook payload → scoped scheduled agent** — HMAC verification, a structural untrusted-content fence, high-risk proposal classification, and human approval mitigate the path. The eventual target agent may retain its scoped write tools. Context regex scanner: **no**, but fence and approval exist. Risk: **MEDIUM**.
5. **Prior user/session text → Memory Consolidation via `rhythm_list_sessions` → durable agent memory** — session bodies are returned directly to the model and can be persisted with `rhythm_remember_memory`. Write target is private/internal memory rather than public. Context scanner: **no**. Risk: **MEDIUM** (persistent prompt poisoning).

The external-adoption generator is the strongest counterexample: it calls `scanContextContent()` on registry/GitHub candidate text and drops blocked content before scoring or proposal creation. Its proposals are also human-gated. Risk: **LOW**.

#### End-to-end Gmail trace

1. `google_broker_controller.ts` accepts Gmail search/read requests and calls `GmailApiService`.
2. `gmail_api_service.ts` fetches attacker-controlled Gmail API JSON.
3. `apps/mcp_server/src/tools/google.ts` returns the JSON through `untrustedContext()`. This adds delimiters and “data, not instructions” text, but does not call `scanContextContent()` and does not create enforceable taint state.
4. `.mcp-roles/email-assistant.mcp.json` grants the same agent read/search and send capabilities, plus Rhythm message-thread writes.
5. `rhythm_send_email` posts directly to `/integrations/google/gmail/send`; `GmailApiService.sendMessage()` sends through Gmail. No server-enforced approval token or clean-context transition is required.

**Risk Assessment:** The system has a useful prompt fence, but the fence is still an instruction to the same model being attacked. The high-risk condition in the brief is met: untrusted external content and same-source/shared write capabilities coexist in one context. CWE-1427 applies.

**Remediation Required:** yes. Add raw-content scanning, taint provenance, a server-enforced human approval transition for outbound actions after external reads, and/or split read and write roles. Tracked in [#1134](https://github.com/ajhochy/Rhythm/issues/1134).

### Phase 3: Engraph Latency

**Status:** PASS

- Engraph integration present: **yes** (`engraph_client.ts`, `engraph_manager.ts`, hybrid retrieval in `memory_retrieval.ts`).
- Measured p95 latency: **not measured in this run** because the live manager is disabled and no Engraph service is running. The repository audit brief records historical 1–12 s p95, but that is not a fresh measurement.
- Live health probe: `ok=false`, category `health_check_failed`, message `no managed service is running`.
- Timeout gate: **yes**, **1,000 ms**, using `AbortSignal.timeout()` in both the client search and managed health probe. Failures return `[]`, preserving FTS results.
- Feature enabled in production/local shipping API: **no**. `GET /engraph-manager/status` returned `enabled=false`, `state=disabled`, and no configured executable. `AGENT_MEMORY_RETRIEVAL_MODE` defaults to `fts`; hybrid is opt-in only.
- Requested `/agent-capabilities` endpoint: **not present** in the shipping server (`404 Cannot GET /agent-capabilities`). The authoritative live status surface is `/engraph-manager/status`.
- Issue #1093 status: **RESOLVED** — GitHub reports CLOSED/COMPLETED as of 2026-07-18. It is not marked BLOCKED. The merged implementation added opt-in hybrid retrieval and the strict fallback/timeout behavior.

**Risk Assessment:** LOW. The slow semantic lane is disabled and not on the prompt hot path. If enabled later, its 1 s timeout fails closed to FTS rather than blocking the agent prompt indefinitely.

**Remediation Required:** no immediate security change. Before enabling, capture a representative memory-scoped p95 at or below 1 s and retain the timeout/fallback tests.

### Phase 4: Rogue Profile (UUID 1dd5f2e3)

**Status:** FAIL

- Profile found: **yes**, full id `1dd5f2e3-3267-4d91-960a-80a4e2ac6b09`, label `Rhythm Setup Agent v2`.
- Enabled in database: **no**.
- Hidden from picker: **yes**, `sessionSelectable=false`.
- Schedulable: **no**.
- Database model: **`anthropic/claude-sonnet-5`**, not the expected Gemini model.
- Projected engine file exists: **yes**.
- Live engine registry advertises it: **yes**, `mode=subagent`, model **`google/gemini-2.5-pro`**.
- Normal `POST /agent-sessions` re-checks the database and rejects disabled profiles: **yes**.
- Can be re-enabled through generic API PATCH: **yes**; the row is not a protected preset and has no audit lock.
- Can be re-enabled by database edit: **yes**.
- Can engine-level code discover the stale disabled profile: **yes**; the live registry already lists it.

The disabling transition calls `writeAgentProfileFile(updated)`, but that function immediately returns when `enabled=false`; it does not remove a previously projected file. `deleteAgentProfileFile()` is called only when deleting the entire database row. The result is split-brain state: the database says disabled and now names a Claude model, while the engine continues loading the old Gemini profile.

**Risk Assessment:** HIGH. The primary Rhythm session-create route blocks the disabled row, but the engine still exposes the stale profile as a subagent and retains stale model/prompt state. This fails the requirement that no workaround or alternate execution boundary can re-enable/use it. CWE-284 and CWE-672 apply.

**Remediation Required:** yes. Delete the projection on disable, reload the engine, filter the live agent registry against enabled database rows, add an explicit audit lock, reconcile stale files at startup, and prove via live behavioral tests that disabled profiles cannot be listed or invoked. Tracked in [#1135](https://github.com/ajhochy/Rhythm/issues/1135).

## Overall Risk Rating

**HIGH**

Three independent high-risk findings are present: canonical-path authorization bypass, untrusted email read-to-write capability, and a disabled security-sensitive profile still loaded by the live engine. No active exploitation was observed, so this audit does not elevate the rating to CRITICAL.

## Recommendations

1. **[HIGH]** Fix canonical path authorization before any further agent filesystem expansion; cover shell `workdir`, all core file tools, worktree routes, and the session file proxy ([#1133](https://github.com/ajhochy/Rhythm/issues/1133)).
2. **[HIGH]** Enforce taint-aware approval or role separation between Gmail/external reads and outbound email/shared writes ([#1134](https://github.com/ajhochy/Rhythm/issues/1134)).
3. **[HIGH]** Remove stale agent projections on disable and introduce an audit lock for `Rhythm Setup Agent v2` ([#1135](https://github.com/ajhochy/Rhythm/issues/1135)).
4. **[MEDIUM]** Extend prompt-injection scanning to session-history memory consolidation and generic model-facing MCP/tool responses; fences should supplement, not replace, enforcement.
5. **[LOW]** Keep Engraph disabled until a representative memory-scoped benchmark demonstrates p95 ≤1 s; preserve the 1 s fail-closed fallback.

## Checks Run

- Required grep/find inventory across `apps/api_server/src` and `apps/mcp_server/src`.
- GitNexus concept queries for path confinement, external-content prompt flow, Engraph retrieval, and agent-profile state.
- Read-only live API queries to `/agent-configs`, `/agent-sessions/agents`, `/engraph-manager/status`, and `/engraph-manager/check-health`.
- GitHub issue #1093 status lookup.
- Static trace of engine path tools, Gmail read/send flow, context-scanner call sites, Engraph timeout/fallback, and profile projection/disable behavior.

