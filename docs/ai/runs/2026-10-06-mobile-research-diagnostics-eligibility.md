---
date: 2026-10-06
repo: rhythm
branch: n/a (isolated owned source copy, not a git checkout)
pr: none
issues: none
status: Checkpoint A source authored; unverified (no tests, typecheck, lint or hashes run by the author)
tags: [run, rhythm]
---

# Mobile Research: error diagnostics and server-owned retry eligibility (Checkpoint A)

## Files
- `apps/mobile/lib/transport/api-error.ts`: `normalizeApiError` also reads the known plain nested `{ error: { code, message } }`.
- `apps/mobile/providers/services/rhythm-tools-service.ts`: `ResearchRecord.canRetry?: boolean`; `canRetry` added to the research `CACHE_FIELDS`; `sanitizeToolCache` drops a non-boolean `canRetry` for research.
- `apps/mobile/providers/rhythm-tools-provider.tsx`: a rejected explicit `research:retry` rereads that exact job once.
- `apps/mobile/app/tools/[tool].tsx`: the Retry button needs `status === 'error'` and `canRetry === true`, and is disabled while offline or submitting.
- Tests: `tests/transport-clients.test.mjs`, `tests/issue-1173-tools-service.test.mjs`, `tests/tools/route-integration.test.tsx`, and new `tests/tools/research-retry-provider.test.tsx`.
- This note.

## Behavior
- **Parser:**
  - Top-level `code` and `message` keep their existing precedence and behavior.
  - Only when a top-level field is absent is the nested object read, one level deep, with no recursion.
  - Nested fields are scrubbed of the token first, then bounded. The code must be identifier-like (`[A-Za-z0-9_.:-]`, up to 64 characters) or it falls back to `HTTP_<status>`. The message is trimmed to 200 characters, and HTML or empty text falls back to the generic message.
  - Status, source and retryability logic, the paired 503 offline errors and the malformed, HTML and non-JSON fallbacks are unchanged. No raw body is logged and the transport request is unchanged.
- **Eligibility:** `canRetry` is server-owned and optional for older backends. A strict `true` is the only value that shows Retry. Missing, `false` and non-boolean values never do, and retryability is not inferred from status or origin.
- **Rejected retry:**
  - The provider rereads the submitted id once with the existing `service.getResearch(id)`.
  - It updates only that row in memory, sanitized with the research cache rules.
  - The service, cache scope and per-tool generation are captured in `perform` BEFORE the action is awaited (the original request's snapshot) and passed unchanged to the reread helper, which never recaptures them after the rejection. That original snapshot must be current before the GET, after the GET, and again when the functional state update executes. A scope or service replacement, or a refresh that bumped the generation, at any of those points means the reread is not issued or its result is dropped, and the replacement's rows stay untouched.
  - A missing row is not created or guessed.
  - Any reread failure is swallowed. The original action error is always rethrown and the UI shows it.
  - There is no automatic redispatch, replacement job, broad refresh or history reset. A successful retry keeps the existing `refresh` path.
- Checkpoint B (density, project and run controls) is not implemented, and no API or allowlist change was made.

## Tests added
- Parser: nested code and message, redaction, bounds, HTML and odd-code fallbacks, top-level precedence, a string `error` and a doubly nested `error`, paired offline, and the malformed, `null`, `[]`, empty and HTML fallbacks.
- Cache: strict-boolean `canRetry` for true, false, missing, string, number and null; other tools never gain it.
- Screen: a mixed list shows exactly one Retry, for the `canRetry: true` error row, and pressing it dispatches the exact id.
- Provider (real `RhythmToolsProvider`, real `RhythmToolsService` and sanitizer, transport mock only):
  - a failed retry rereads the exact id once, updates only its row, makes no second POST and no list reload, and rethrows the same error object
  - a failed reread still rethrows the same error and changes nothing
  - a successful retry takes the normal refresh and no reread
  - a reread resolving after a service and cache-scope replacement cannot overwrite the replacement's same-id row

## Correction (provider original-request snapshot)
Sol reproduced two failures against the first version: with the retry POST still pending, a cache-scope replacement plus a refreshed replacement row was followed by a rejected POST, and the helper then recaptured the NEW scope and generation inside the catch. It issued one stale GET (expected zero) and overwrote the replacement row with the old request's response. The fix is confined to `rhythm-tools-provider.tsx`: `perform` captures `{ service, cacheScope, generation }` before awaiting `runAction`, `rereadRejectedResearchRetry` receives that snapshot instead of capturing its own, and the check also runs inside the functional state updater (returning an empty patch when stale). The exact-id single reread, sanitization and rethrow of the original error on every branch are unchanged. No test file was edited; Sol's two regression tests and the four owner provider cases are untouched.

Impact: `RhythmToolsProvider` and `perform` upstream analysis was LOW. A lookup for the new helper was UNKNOWN because the index lacks the fresh symbol; a manual source check shows `rereadRejectedResearchRetry` has one caller, `perform`. No index was rebuilt and no impact result was fabricated.

## Checks
Not run (no shell). Preimage SHAs from the reservation were not hashed here. Pending for an independent run: the four affected test files, mobile typecheck and targeted lint.

## Uncertainty
- The real parser transpile harness in `transport-clients.test.mjs` strips types, and the provider test's wiring of `RhythmToolsService` with a mock transport relies on the service calling `transport.request(path, init)` with the original method. Both are unexecuted.
- The user's actual 400 target and cause remain UNKNOWN. This change surfaces a nested server reason and removes Retry for ineligible rows, but cannot show why the server returned 400.
- The Retry condition is `canRetry === true`, so against an older backend that omits the field Retry disappears until the backend supplies it.
