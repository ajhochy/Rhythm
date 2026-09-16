---
date: 2026-09-12
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [E31, E34B]
status: FIXED
tags: [run, Rhythm, failure-triage]
---

# Phase3 checkpoint bucket1 — test harness repair

## Files

- `apps/web/tests/gateway/post-m1-phase-8-html-import.live.redspec.ts`: add intercepted GET `/workspaces/me` response `{ id: 8 }`; preserve original exact import POST and stable-ID/preferences assertions.
- `apps/web/tests/electron-e15-facilities-safety.spec.ts`: replace immediate POST field read with awaited `expect.poll` over exact method/path/full body. No timeout change.
- `docs/ai/contracts/electron-phase3-checkpoint-bucket1-repair.json` and this run record.

## Checks

Worktree `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`, HEAD `2028a7d1`; branch `feature/electron-flutter-retirement`. Commands ran serialized from `apps/web`, each using this exact wrapper:

```sh
env -i HOME=/private/tmp/rhythm-electron-phase3/home \
  TMPDIR=/private/tmp/rhythm-electron-phase3/tmp \
  PATH=/private/tmp/rhythm-electron-phase3/bin:/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  PLAYWRIGHT_BROWSERS_PATH=/Users/ajhochhalter/Library/Caches/ms-playwright \
  /bin/zsh -f -c '<command>'
```

| Stage | Exact command | Observed output |
|---|---|---|
| Before fix | `npm exec -- playwright test --config tests/post-m1-phase-8-fixture-playwright.config.ts --grep post-m1-p8-c5b` | 1 failed; line62 expected full POST `/live-artifacts` body with workspaceId8, received `[]`; predicate timed out at unchanged 5000ms |
| Before fix | `npm exec -- playwright test --config tests/electron-e15-playwright.config.ts --grep E31 --trace on --repeat-each=3` | 3 passed (3.8s); original intermittent failure did not recur |
| After fix | `npm exec -- playwright test --config tests/post-m1-phase-8-fixture-playwright.config.ts --grep post-m1-p8-c5b` | 1 passed (2.4s) |
| After fix | `npm exec -- playwright test --config tests/electron-e15-playwright.config.ts --grep E31 --trace on --repeat-each=3` | 3 passed (3.9s) |

After-fix commands were chained with `&&`; combined exit0. No build or full suite ran. No service start/stop/restart, product changes, E52A changes, baseline repairs, commits, pushes, PRs or peers.

## Notes

Classification: two test-harness defects. Import deterministically failed because the older interceptor returned404 for the new authoritative workspace prerequisite, preventing creation. The one-line fixture response fixes that prerequisite without weakening any assertion. E31's recorded checkpoint failure read undefined immediately after Save, before the asynchronous route callback necessarily recorded the POST. Focused pre-fix repetitions passed again: this is intermittent, not a newly reproduced product defect. Awaiting the exact request/body removes that assertion race and strengthens the prior facility-IDs-only check.

GitNexus upstream impact attempted for both test files: target not found, risk UNKNOWN; no claim of zero blast radius. Manual scope is two isolated test callbacks and two repair records. Existing worktree dirt and generated evidence were not cleaned or staged. The original checkpoint report remains intact; these results close only the two assigned harness failures, not other Phase3 acceptance gaps or deployed behavior.
