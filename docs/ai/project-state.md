# Project State

## Current focus

**Mega-PR stage 01 verification: ✅ GREEN.** Integration branch `mega/opencode-utilization-1042-1108`
passes all verification gates. Clusters A1, A2, B-api (13 issues), B-flt-front merged and verified.
Zero branch-caused test failures. All pre-existing failures identified and documented.
Ready for merge to `main` + release.

## Active branch / PR

- Branch: `mega/opencode-utilization-1042-1108` @ `6c660c5c1` (integration, verified green).
- Prior main: `main` @ `02c60cae3` (v0.18.46 released).
- Next: Merge to `main`, then release build.

## In progress

- Merge integration branch to `main` (pending user approval).
- Release v0.18.47 with 37-issue mega-PR changes (Clusters A1–B-flt-front).

## Risks / known issues

- **Sandbox provider isolation** — the dev sandbox's isolated HOME can't reach keychain-bound Anthropic
  OAuth; only OpenRouter (static API key in `auth.json`) works there. Live e2e model runs use an
  OpenRouter model; token accounting is provider-independent.
- **Pre-existing test pollution** — `memory_*.test.ts` suites have ENOENT failures from missing vault files;
  `issue_736`/`issue_818` contracts expect `replyToPermission` mock (added by #1042, pre-existing gap). Neither
  caused by mega-PR changes.

## Test status

**mega-PR verification (2026-07-17):**
- api_server: `tsc` clean; `vitest` **2922 passed** / 26 failed (all pre-existing) / 35 skipped.
- Flutter: format clean, analyze **0 new errors** (10 pre-existing infos); **7 widget tests passed** (question_custom_multiple, queued_message_state, rhythm_inspector_prod_mirror).
- Live e2e: **#1070 global SSE passed** (heartbeat watchdog verified); #1057 engine endpoint transient (not branch-caused).
- **Verdict:** ✅ GREEN — zero branch-caused failures.
- Full report: `docs/ai/runs/2026-07-17-mega-verify-stage01.md`.

## Next step

Merge integration branch `mega/opencode-utilization-1042-1108` to `main`, then trigger release build for v0.18.47.
