---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-002-profile-first-sessions
pr: 1266
issues: [MSP-002]
status: pushed-playwright-pending
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# MSP-002 foundation E2E repair

## Files changed

- `apps/mobile/tests/fake-opencode/fixtures.mjs` — add the safe Secretary
  profile expected by MSP-002's shared creation seam.
- `apps/mobile/tests/contract/msp-002-profile-first-sessions.test.mjs` — make
  c1 fail when the foundation harness omits the Secretary default.
- `apps/mobile/tests/fake-opencode/self-test.mjs` — make the safe-catalog
  assertion order-independent and cover every returned profile.
- `docs/ai/project-state.md` — record the repair status and remaining
  Playwright handoff.

## Checks run

- `cd apps/mobile && ./node_modules/.bin/tsc --noEmit` — passed.
- `cd apps/mobile && npm run lint` — passed.
- `cd apps/mobile && node --test tests/contract/msp-002-profile-first-sessions.test.mjs tests/contract/msp-001-session-profile-contract.test.mjs`
  — passed, 13/13.
- `cd apps/mobile && npm test -- --runInBand tests/chat/chat-composer.test.tsx`
  — passed, 4/4.
- `cd apps/mobile && node --test tests/contract/msp-002-profile-first-sessions.test.mjs tests/contract/msp-001-fake-gateway-contract.test.mjs`
  — passed, 10/10.
- `git diff --check` — passed.
- `cd apps/mobile && npm run test:fake-server:self` — environment-blocked
  before assertions because loopback bind fails with `listen EPERM`; a minimal
  standalone Node listener reproduced the same restriction.

## Notes

- All 28 stored Playwright error contexts stopped on the `New chat` sheet with
  “The Secretary profile is unavailable…” and a disabled `Create` button.
- The repaired MSP-001 fake gateway did serve `/mobile-gateway/profile-catalog`,
  but its fixture exposed only Build and General. MSP-002 correctly required
  Secretary, so no creation draft could be built.
- The MSP-002 c1 contract was first run red (6/7, missing Secretary), then
  green (7/7) after the fixture repair.
- Product behavior is unchanged: the shared creation sheet remains
  profile-first, Secretary is preselected, and profile/model search plus
  per-session configuration remain available.
- Full Playwright is intentionally pending for the orchestrator because it
  cannot run in this sandbox.
- The fake-server self-test must also be rerun by the orchestrator in its
  loopback-capable environment.
- Code commits: `c1ad4cd6b`, `3e66d526a`.
- The branch was pushed successfully. GitHub Actions status polling then hit a
  transient `api.github.com` connectivity failure, so the new Mobile CI run
  could not be watched from this sandbox.
