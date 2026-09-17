---
date: 2026-09-16
repo: Rhythm
branch: fix/mobile-1506-stale-prompt-error
pr: 1507
issues: [1506]
status: pending
tags: [run, rhythm]
---

# Mobile #1506 — stale global prompt error blocked every chat

## Files

- `apps/mobile/lib/transport/api-error.ts` — added `summarizeError(value, fallback)`:
  prefers a status (`ApiError`, or `status` / `statusCode` / `cause.status` /
  `response.status` on a thrown payload) and otherwise refuses any body that is
  empty, starts with `<`, or exceeds 200 chars.
- `apps/mobile/providers/opencode-provider-selectors.ts` — added the pure
  `clearSessionlessPromptError` predicate.
- `apps/mobile/providers/opencode-provider.tsx` — bootstrap effect replays the
  idempotent `ensureActiveSession` once after 1.5 s before surfacing anything, and
  retracts a session-less `promptError` on success; all three `setPromptError`
  sites now go through `summarizeError`.
- `apps/mobile/components/chat/chat-view.tsx` — error-card text capped at
  `numberOfLines={6}`; the twelve `error instanceof Error ? error.message : '…'`
  sites that feed the same card now use `summarizeError`.
- `apps/mobile/tests/issue-1506-prompt-error.test.ts` — new; 10 assertions.

## Checks

| Command (in `apps/mobile`) | Result |
|---|---|
| `npx jest tests/issue-1506-prompt-error.test.ts` (fix stashed) | 10 failed / 10 — red before |
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` | 0 errors, 3 pre-existing warnings in untouched files |
| `npm test` | 32 suites / 132 tests passed |
| `npm run test:e2e:labels` | 3/3 pass |

Full Playwright was skipped deliberately: no spec under `tests/e2e/` references the
error card ("Action failed" / "Copy details").

## Notes

- The SDK client is built with `throwOnError: true`, and the generated hey-api
  client rethrows `await response.text()` verbatim for a non-JSON error body — so a
  Cloudflare 502 page arrives as a thrown *string*, not an `Error`. Every consumer
  used `error instanceof Error ? error.message : '<generic>'`, which both let long
  payloads through where the value did carry a `message` and threw away the useful
  status where it did not. `summarizeError` is the single chokepoint for both.
- Error state was deliberately not restructured (per the issue's "smallest fix"):
  "Copy details" still copies whatever text the card holds. When the summarizer
  substitutes a fallback, the discarded original was an HTML page with no
  diagnostic value beyond its status, which the summary keeps.
- No RN component test renders `ChatView` (it needs the whole provider), so the
  `numberOfLines` cap has no unit assertion — it is a one-line JSX prop.
- GitNexus `impact` upstream: `ensureActiveSession` → 1 direct caller, LOW.
  `summarizeError` and `clearSessionlessPromptError` are new, so the index has no
  entry for them. The CRITICAL rating on `normalizeApiError` (21 upstream) belongs
  to a neighbour in the same file that this change does not touch.
