---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
issues: [AV-02]
status: repair-plan
priority: high
tags: [issue, api_server, live-artifacts, security]
---

# AV-02 repair attempt 1 — authorization, log disclosure, render policy, coverage

## Failure

Four verification-gate failures against AV-02 (`docs/ai/contracts/live-artifacts-av02.json`).
Three are product security defects (F1–F3); one is contract/coverage (F4).

| # | Failure | Invalidates |
|---|---|---|
| F1 | Shared collaborator stays authorized after workspace membership is revoked | c4, c8 |
| F2 | Missing stored state file logs the absolute storage path + stack to `api_server.log` | c3, c8 |
| F3 | Render CSP has no sandbox / navigation control | c6 |
| F4 | c9 `UNVERIFIED` while run note says READY; c1–c8 claims exceed test coverage | c1–c9 |

## Repro Command

```bash
cd apps/api_server
LIVE_ARTIFACT_STORAGE_DIR="$TMPDIR/av02-triage-probe" \
  npx vitest run src/__tests__/live_artifacts.test.ts --no-file-parallelism
```

Triage used a temporary probe file (`src/__tests__/av02_repro_tmp.test.ts`, since deleted)
that drove the three defects through the real Express app + in-memory SQLite. Results below
are observed output, not inference.

## Expected

F1 — after `DELETE FROM workspace_members`, the ex-member gets a non-disclosing `404` and the
artifact leaves their list.
F2 — no artifact-internal filesystem path and no stack frame reaches the log; operators still
learn which artifact, which operation, and the errno.
F3 — the rendered document may run its stored script but may not navigate or reach the network.

## Actual

```
PROBE F1 status after revocation = 200   list length = 1
PROBE F3 CSP = default-src 'none'; script-src 'nonce-…'; style-src 'nonce-…';
               connect-src 'none'; form-action 'none'; base-uri 'none';
               frame-src 'none'; object-src 'none'
PROBE F3 X-Frame-Options = null
```

F2 — public body is correctly sanitized, the log is not:

```
status=500
publicBody={"error":{"code":"INTERNAL_ERROR","message":"Internal server error","correlationId":"…"}}
[ERROR] Unhandled GET /live-artifacts/9fe5066e-… [cid=…] {"authUserId":1,"body":{},"params":{},
  "error":{"message":"ENOENT: no such file or directory, open
  '/var/folders/…/T/av02-triage-probe/9fe5066e-…/state/015abd7f…json'",
  "stack":"Error: ENOENT … at LiveArtifactStorage.readState (…/live_artifact_storage.ts:54:90)
           at LiveArtifactsController.get (…/live_artifacts_controller.ts:36:196)","name":"Error"}}
```

The leak is the storage root, the artifact/state content-address layout, **and** the api_server's
own source paths from the stack.

## Likely Cause

**F1 — root cause:** `LiveArtifactsRepository.canRead()` treats a `live_artifact_collaborators`
row as a standalone, permanent grant. The `organization` branch re-checks
`isWorkspaceMember()`; the `shared` branch does not. Membership is validated once at
`addCollaborator` time and never re-validated at read time, so revocation does not cascade.

**F2 — root cause:** raw `node:fs` errors escape `LiveArtifactStorage`. Node embeds the absolute
path in both `.message` and `.stack` by construction, so *any* handler that logs an unhandled
error discloses it. The defect is that the storage class lets the raw error out, not that the
shared handler logs too much.

**F3 — root cause:** the CSP is a *resource-loading* policy only. `default-src 'none'` restricts
fetching; it does not restrict navigation. Nothing in the current header stops
`location.href = …` from the nonced stored `app.js`, a `<meta http-equiv="refresh">` in the
stored HTML, or an `<a target="_top">`. The existing test uses `redirect: 'manual'` on an HTTP
fetch, which can only observe a 3xx from the server and is structurally incapable of observing
document-initiated navigation.

**F4 — root cause:** the contract asserts a behavior matrix (c8 enumerates ~16 behaviors) that
8 tests do not cover, and c9 is `UNVERIFIED` with no review record.

## Likely Files

| File | Change |
|---|---|
| `apps/api_server/src/repositories/live_artifacts_repository.ts` | F1 — `canRead()` shared branch |
| `apps/api_server/src/services/live_artifact_storage.ts` | F2 — contain fs errors at the class boundary |
| `apps/api_server/src/controllers/live_artifacts_controller.ts` | F3 — `render()` CSP + container escaping |
| `apps/api_server/src/__tests__/live_artifacts.test.ts` | F4 — coverage |
| `docs/ai/contracts/live-artifacts-av02.json` | F4 — c9 status, after behavior passes |
| `docs/ai/runs/2026-08-08-live-artifacts-av02.md` | F4 — c9 review record + evidence |

Explicitly **not** to be edited: `apps/api_server/src/middleware/error_handler.ts`,
`apps/api_server/src/utils/logger.ts` (see "Where the F2 fix belongs").

## Required Fix

### F1 — one line, in the shared authorization chokepoint

`canRead()`, between the `visibility !== 'shared'` guard and the collaborator lookup:

```ts
if (artifact.visibility !== 'shared') return false;
if (!await this.isWorkspaceMember(artifact.workspaceId, userId)) return false;
// ponytail: two queries per artifact in list(); fold into one JOIN if list latency matters.
```

All eight controller entry points reach authorization through `canRead` (`readable()` →
`owner()`, plus `list()`), so this is the shared boundary, not a caller patch. Do **not** patch
`readable()` or add checks in individual handlers.

### F2 — contain fs errors where they are created

Add one private helper to `LiveArtifactStorage` and route the four fs methods through it:

```ts
private fail(error: unknown, id: string, kind: 'bundle' | 'state', op: 'read' | 'write'): never {
  if (error instanceof AppError) throw error;            // never swallow validation errors
  const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
  // ponytail: node fs errors embed the storage root in BOTH message and stack.
  // Log the operational facts, drop the path.
  logger.error('live-artifact storage operation failed', { artifactId: id, kind, op, code });
  throw AppError.internal('Live artifact content unavailable');
}
```

Wrap the bodies of `readBundle`, `readState`, `publishBundle`, `publishState` in
`try { … } catch (error) { this.fail(error, id, kind, op); }`. Keep `publishBundle`'s existing
internal `EEXIST` handling — only the outer boundary changes.

Result: the public response stays a sanitized 500 (`AppError.internal` → `INTERNAL_ERROR`,
message `Live artifact content unavailable`), the log line becomes
`Handled INTERNAL_ERROR GET /live-artifacts/<uuid> — Live artifact content unavailable` plus
our own `{artifactId, kind, op, code}` line. No path, no stack, and operators keep more signal
than before (which artifact, read vs write, `ENOENT` vs `EACCES` vs `ENOSPC`).

#### Where the F2 fix belongs — narrow, **not** the shared error logger

- `errorHandler` (`middleware/error_handler.ts:21`) is the single terminal error boundary for
  the entire api_server (`app.ts:272`). 143 `logger.error` call sites across 25 files depend on
  today's diagnostic detail. Redacting message/stack there would hide operational errors
  app-wide — the one outcome the acceptance criterion forbids.
- A path-scrubbing regex in the shared logger is a whack-a-mole trust boundary: it must know
  every secret-bearing path, and it would still leak api_server source paths via stack frames.
- The leak is created inside `LiveArtifactStorage`; containing it there fixes all four callers
  at once with zero cross-subsystem risk.

### F3 — safe render policy (WKWebView-compatible)

Replace the `Content-Security-Policy` value in `render()` with:

```
sandbox allow-scripts; default-src 'none'; script-src 'nonce-<n>'; style-src 'nonce-<n>';
connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none';
frame-ancestors 'none'
```

`sandbox allow-scripts` and nothing else is the whole fix:

| Capability | Result |
|---|---|
| stored `app.js` runs | **allowed** (`allow-scripts`) — required by the AV-03+ bridge |
| `location.href = …`, `<meta http-equiv="refresh">`, `<a target="_top">` | blocked (no `allow-top-navigation*`) |
| `window.open` | blocked (no `allow-popups`) |
| cookies / `localStorage` / credentialed fetch | blocked (opaque origin — no `allow-same-origin`) |
| network | blocked (`default-src`/`connect-src 'none'`) |
| form posts, modals, downloads, pointer lock | blocked |
| embedding the render in another page | blocked (`frame-ancestors 'none'`) |

**Never add `allow-same-origin`.** On a same-origin top-level document it neuters the sandbox and
hands stored script the API origin's cookies. If a future WKWebView bridge needs same-origin,
serve artifacts from a dedicated origin instead. `window.webkit.messageHandlers` is injected by
`WKUserContentController` into the JS context and is not gated by CSP, so the opaque origin does
not break the planned bridge.

Also escape the container terminators in the template (defense in depth):

```ts
const css = bundle.css.replace(/<\/style/gi, '\\3c /style');
const js  = bundle.js.replace(/<\/script/gi, '<\\/script');
// ponytail: a smuggled tag cannot obtain the per-response nonce anyway; this just
// stops stored content from reshaping the document.
```

The existing render assertion (`live_artifacts.test.ts:112`) stays green — its regex is
unanchored and the required directives keep their relative order.

## Required Tests / Evaluation

All in `apps/api_server/src/__tests__/live_artifacts.test.ts`. Each must fail before the fix and
pass after.

**Verified to fail today (measured, not assumed):**

1. `revoked workspace member loses shared access` — add collaborator, `DELETE FROM
   workspace_members`, then `GET /:id` → `404` and list length `0`.
   *Currently: `200`, list length `1`.*
2. `render policy sandboxes navigation and network` — CSP contains `sandbox` and
   `frame-ancestors 'none'`; and **negative** assertions that it contains none of
   `allow-same-origin`, `allow-top-navigation`, `allow-popups`, `allow-forms`, `allow-modals`,
   `unsafe-inline`, `unsafe-eval`. *Currently: no `sandbox` token at all.*
3. `missing stored content leaks no path or stack` — spy `console.error`, `rm -rf` the artifact
   dir, `GET /:id`; assert the public body is the sanitized 500 **and** the captured log matches
   none of `/\/state\//`, `/\/bundles\//`, `/ENOENT/`, `/\n\s+at\s/`.
   *Currently: log contains all four.*

   ⚠️ **Do not assert `expect(log).not.toContain(env.liveArtifactStorageDir)`.** Triage tried
   exactly that and got a **false PASS**: `$TMPDIR` carries a trailing slash, so the configured
   value and the path Node reports differ by a `//` and `includes()` misses a real leak. Assert
   on path *shapes*, as above.

**Coverage gaps to close (F4) — one test each:**

4. stored markup cannot obtain the render nonce — bundle containing `<script nonce="` and
   `</script><script>`; assert the nonce appears only on the two product-injected tags.
5. bundle and state revisions advance independently, each appending an audit row with actor,
   hash, and timestamp (c2/c5 — only state CAS is exercised today).
6. content-addressed layout on disk: `<id>/bundles/<hash>/{index.html,styles.css,app.js}` and
   `<id>/state/<hash>.json`, hash equal to sha256 of the canonical JSON (c3).
7. soft delete retains stored content on disk (c4 "retention" — currently unasserted).
8. traversal ids are rejected without disclosure: `GET /live-artifacts/..%2f..%2fetc%2fpasswd`
   → `404`, body free of any path.
9. unauthenticated `401` across all ten routes/methods, table-driven (c1 — only `GET /` today).
10. cross-org user cannot read an `organization` artifact (c4 — untested today).
11. stale CAS returns `409` **and** leaves the pointer and revision table unchanged (c5).
12. `list` honours `search` and rejects a non-`html` `type` (c1/c2).

**Fix a false positive while there:** `keeps immutable server-derived storage and rejects
oversized state` (line 79) passes because of the 512 KiB check; the `path: '../../secret'` key in
the same body proves nothing about traversal. Split it into a size test and a real traversal test
so c3's claim is not backed by an accidental pass.

**Contract / evidence (only after the above are green):**

- Perform the c9 code-scope review, record it under a `## c9 code-scope review` heading in
  `docs/ai/runs/2026-08-08-live-artifacts-av02.md`, then set c9 to
  `{"status":"pass","mode":"manual","evidence":"docs/ai/runs/2026-08-08-live-artifacts-av02.md#c9-code-scope-review"}`
  and drop `"not_tested": ["av02-c9"]`.
  The review should note that `WorkspaceRepository.findMember` is **SQLite-only** (no Postgres
  branch), so the dual-dialect `LiveArtifactsRepository.isWorkspaceMember` is the correct reuse
  point — reusing `findMember` would silently break Postgres.
- Re-run the full AV-02 command set from the run note (focused suite, tasks permissions, `tsc`,
  `npm run build`, sandbox live E2E via `tools/dev/sandbox.sh`, `git diff --check`) and record
  actual output.
- Leave the run note at `READY_FOR_VERIFICATION`; do not bump any status until behavior passes.

## Blast radius — AJ warnings

1. ⚠️ **`errorHandler` — GitNexus reports LOW / 0 upstream dependents. That reading is wrong.**
   Express registers middleware by value, so the graph has no CALLS edge; the true runtime blast
   radius is *every route in the api_server*. Do not let the LOW reading authorize an edit here.
   This plan deliberately routes the F2 fix away from it.
2. ⚠️ **`LiveArtifactsRepository.canRead` is the authorization chokepoint** for GET, render,
   PATCH, collaborator GET/POST/DELETE, PUT bundle, PUT state, DELETE, and `list`. `context()`
   returns "Symbol not found" — the GitNexus index predates this uncommitted branch, so **no
   AV-02 symbol can be impact-analyzed today**. Manual blast radius: 8 controller entry points.
3. Before the coding agent claims impact analysis on AV-02 symbols it must run
   `node .gitnexus/run.cjs analyze`, or state explicitly in the run note that impact was
   assessed manually because the index is stale.

## Scope guard

In scope: the four files above. Out of scope for this repair: AV-03/04/05 (blocked), the
documented order-dependent api_server suite flake, and any change to the shared error handler or
logger.
