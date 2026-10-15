---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: null
issues: []
status: unverified
tags: [run, Rhythm]
---

### E1 empty-session approval banner repair

- After the API CORS repair and root-owned sandbox restart, the real E1 browser run showed all three synthetic pending cards in the queue, but timed out after 15 seconds waiting for `pending-approval-banner`. Its retained trace showed the intended bound session selected in the rail and active pane, with an empty transcript.
- `apps/web/src/components/Transcript.tsx:428` returned the empty-state panel before the bound-only `PendingApprovalBanner` at line 446. The selected session and approval ID were correct. GitNexus upstream `impact(renderContent)` returned LOW: one direct caller, five indexed dependents, zero processes, one module; the index warned it was six commits behind this worktree.
- The empty-state panel now includes the same read-only `PendingApprovalBanner` for live sessions. The full transcript path remains unchanged. The live test config sets `actionTimeout: 15_000` to bound interaction failures.
- Exact live command from `apps/web`: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-delivery-recovery-sandbox-20261001 DB_PATH=/private/tmp/rhythm-delivery-recovery-sandbox-20261001/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_E1_PUBLIC_FIXTURE=1 npx playwright test --config=tests/e1-approval-queue-live-playwright.config.ts` — 1 passed in 8.7 seconds. It observed real API-created global, bound and unrelated rows after mount, then focus, offline/online reconnect and reload, with only the bound row in the selected-session banner and no PATCH decision.
- `cd apps/web && npm run typecheck` exited 0. `npx playwright test --config=tests/e1-approval-queue-playwright.config.ts` passed 17/17 in 1.2 minutes. `git diff --check` exited 0. Playwright shut down its Vite listener; `lsof -nP -iTCP:4175 -sTCP:LISTEN` returned no listener.
- This synthetic browser read gate does not qualify native decision signing, an installed package, or a production deployment. No API/engine lifecycle or real approval decision was performed by this repair.
