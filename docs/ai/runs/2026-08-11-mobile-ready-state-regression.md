---
date: 2026-08-11
repo: Rhythm
branch: mega-ws/mobile
pr: null
issues: [1364, 1366]
status: awaiting-playwright
tags: [run, Rhythm]
---

# Mobile ready-state regression

## Files

- `apps/mobile/providers/opencode-provider.tsx`
- `apps/mobile/providers/services/session-service.ts`
- `apps/mobile/tests/session-lifecycle-tier.test.ts`
- `apps/mobile/tests/session-service.test.ts`

## Checks

- `npm test -- --runInBand tests/session-service.test.ts tests/session-lifecycle-tier.test.ts tests/open-session-cache-first.test.ts tests/session-refresh-pinning.test.ts tests/session-discovery.test.ts` — 5 suites, 17 tests passed.
- `npm test -- --runInBand` — 16 suites, 61 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed with two pre-existing warnings.
- `EXPO_APP_VARIANT=development NODE_ENV=development npx expo export --clear --platform web --output-dir /tmp/rhythm-mobile-verification-6286658d` — passed; 15 static routes exported.
- `gitnexus detect-changes --scope unstaged --repo Rhythm --limit 100` — LOW risk; no affected indexed processes.
- Playwright — not run because the sandbox cannot bind localhost (`EPERM`); mega orchestrator verification pending.

## Notes

The #1364 controller guard treated any normally completed exact lookup miss as authoritative. The provider supplied only the owner-unscoped discovery lookup, whose contract excludes registered project sessions, so a newly created project session became `missing-session` before scoped state could load. Exact resolution now checks the scoped session endpoint first and retains owner discovery as the projectless-session fallback. Background discovery and scope-generation fencing are unchanged.
