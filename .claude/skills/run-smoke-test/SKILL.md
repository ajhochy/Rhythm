---
name: run-smoke-test
description: Run Rhythm's smoke test — verify a change behaviorally against a running API server and record the result in the repo's smoke-test format. Use before requesting review on a behavioral/UI change, or when the user says "smoke test", "verify this works", "run the checklist".
---

# Run a Rhythm Smoke Test

Verifies a change end-to-end against a live server rather than trusting that it
compiles. Produces a findings record in the same shape as the repo's existing
`smoke-test.md`, so results are comparable across runs.

Reference material already in the repo:
- `smoke-test.md` — worked example of the findings + Checks-table format.
- `flutter-ui-smoke-checklist.md` — one testable action per screen (the manual UI pass).
- `docs/ai/contracts/*.json` — acceptance criteria per issue; use as the baseline when one exists.
- `docs/ai/testing-guide.md` — project testing conventions.

## 1. Scope it

Identify exactly what changed (the branch/PR and the affected feature) and pick
the acceptance baseline:
- If a contract exists in `docs/ai/contracts/` for this issue, its criteria (c1, c2, …)
  ARE the checklist. Exercise each one behaviorally.
- Otherwise derive checks from the diff and the relevant section of
  `flutter-ui-smoke-checklist.md`.

## 2. Get a server running

Two servers, per `CLAUDE.md` dual-endpoint architecture — target the right one.

- **Production-path features** → point at a running API server:
  ```bash
  cd apps/api_server && npm run dev        # :4000 locally (set PORT to match)
  curl --fail --silent http://localhost:4000/health
  ```
- **Agent features** → the local agent server on `:4001` (spawned by the running
  Flutter app with `AGENT_LOCAL=true`, so agent endpoints need no auth):
  ```bash
  curl --fail --silent http://localhost:4001/health
  ```
- If a `Rhythm.app` instance is already running it has likely already spawned the
  `:4001` server — check before spawning your own.

## 3. Exercise each check

Prefer real HTTP round-trips over reading code. For each criterion, capture:
**Area · Check · How to run (exact command) · Result (Success/Fail) · Reasoning (the observed evidence)**.

- Hit endpoints with `curl` and assert on the response body, not just status.
- Confirm persistence with a follow-up `GET` where relevant.
- Test the negative paths too (403/400 guards, empty input, depth/permission limits)
  — the existing `smoke-test.md` shows this is expected rigor.
- Pure-visual interactions that can't be driven headlessly: mark **Manual (visual)**
  and note which underlying path (test / API round-trip) already covers the logic,
  so the residual risk is only rendering.

## 4. Record the result

Write to `smoke-test.md` (or a run log under `docs/ai/runs/YYYY-MM-DD-<slug>.md`,
per the `CLAUDE.md` logging convention) with these sections:

- **Scope** — branch/PR, contract id, date.
- **Findings** — prose summary of what passed and any surprises.
- **Checks** — the Markdown table (Area / Check / How to run / Result / Reasoning).
- **Regressions found** — anything broken, with evidence; distinguish real bugs
  from misdiagnoses (the existing file has a good "corrected diagnosis" example).
- **Known Gaps** — what was NOT covered and why (e.g. the one genuine manual visual check).

## 5. Report

Summarize pass/fail counts and any blockers to the user. Do not mark the change
review-ready if a non-cosmetic check failed. This satisfies `REVIEW.md` §6.
