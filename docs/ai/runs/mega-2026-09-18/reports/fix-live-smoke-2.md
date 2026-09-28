# Summary

- Implemented scoped repairs for the seven reported live-smoke failure paths without weakening the original issue contracts.
- The three splitter cases now clear layout preferences only on the first navigation, so the post-drag reload verifies the value the product persisted.
- Deep Research skips only when the sandbox presents a non-error zero-row state; Webhooks asserts its intentional live-unavailable panel.
- Agent Settings no longer creates duplicate Auto-promotion landmarks.
- The Agents project cycle uses the rail's real auto-selected project control, then retains the marked create/read-back/delete cleanup path.

# Files changed

- `apps/web/tests/live/mega-2026-09-18-smoke.spec.ts` — corrected live-state handling, selected-project lookup, and splitter reload setup.
- `apps/web/src/components/tools/AgentSettingsTool.tsx` — changed the nested Auto-promotion card from a labeled section landmark to a non-landmark container.
- `docs/ai/project-state.md` — appended the required coding-agent run record.
- `REPORT.md` — recorded this handoff.

# Checks run

- Branch/SHA — `mega/fix-live-smoke-2` at `7bbebaaf`.
- `cd apps/web && npm run typecheck` — passed (`tsc -b`, exit 0).
- `cd apps/web && ./node_modules/.bin/esbuild tests/live/mega-2026-09-18-smoke.spec.ts --bundle --platform=node --format=esm --external:@playwright/test --external:@axe-core/playwright --outfile=/tmp/mega-2026-09-18-smoke.mjs` — passed; 42.1 kB bundle.
- `cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_TOKEN=compile-only npx playwright test --config tests/live-smoke-playwright.config.ts --list` — passed; 34 tests discovered.
- `git diff --check` — passed.
- GitNexus impact for `AutoPromotionSettings` — LOW risk, one direct caller, zero affected processes.
- GitNexus `detect-changes --scope unstaged` — LOW risk, three tracked files, three indexed symbols, zero affected processes; the required ignored `REPORT.md` is present separately.
- Live sandbox suite — not run; the task explicitly prohibits opening sockets.
- Dev Dashboard publish — not run because the required publisher is network-backed and the task prohibits opening sockets.

# Decisions

- Kept `Splitter.tsx` unchanged because each failed trace showed the drag updated the rendered value; the live test itself erased `layout.*` during reload.
- Kept Deep Research gateway errors as failures. Only a visible non-error empty state with zero rows triggers the exact sandbox-data skip.
- Treated Webhooks' “Not available for live sessions yet” panel as the expected live contract and asserted that it performs no writes.
- Fixed the Agent Settings accessibility violation in product markup because axe identified a genuine duplicate-landmark defect.
- Used `Selected project <marker name>` with `aria-pressed="true"` because successful creation auto-selects the project before the test reaches the rail control.
- Preserved marker names and the create → UI read-back → DELETE `/projects/:id` → reload/absence cleanup policy.
