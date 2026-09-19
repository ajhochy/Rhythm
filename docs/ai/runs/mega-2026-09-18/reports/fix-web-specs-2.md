# Summary

- Repaired the three failing Splitter persistence/reset specs without weakening their behavioral assertions. The test initializer previously removed every `layout.*` key on every document load, including the reloads intended to prove persistence and stored-value clamping. It now clears layout storage once per isolated test page and preserves it across reloads.
- Repaired the failing Electron E16 policy round-trip spec. The redesigned Profiles editor intentionally places the raw policy textarea inside the collapsed `Advanced (JSON)` disclosure, so the test now opens that user-visible disclosure before editing the canonical policy.
- Left `ToolWorkspace.tsx`, `tools.spec.ts`, and `bucket-a-rendered-repair.spec.ts` unchanged: the supplied recheck reports all 11 non-Splitter default-config cases passing.
- No commits, stashes, checkouts, servers, sockets, Playwright runs, Vite dev servers, or Electron launches were performed.

# Files changed

- `apps/web/tests/splitter.spec.ts` — use a `sessionStorage` sentinel so per-test layout cleanup runs once and reload assertions can observe persisted/clamped values.
- `apps/web/tests/electron-e16-agents-safety.spec.ts` — expand `Advanced (JSON)` before filling the policy textarea.
- `REPORT.md` — this handoff report (git-ignored by the checkout's local exclude file).

# Checks run

- Worktree preflight (`pwd`, branch, write probe) — pass: `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-web-specs-2`, branch `mega/fix-web-specs-2`.
- `cd apps/web && node_modules/.bin/tsc --noEmit --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 --jsx react-jsx --types node,@playwright/test tests/tools.spec.ts tests/splitter.spec.ts tests/bucket-a-rendered-repair.spec.ts tests/electron-e16-agents-safety.spec.ts` — pass, exit 0 with no diagnostics.
- `cd apps/web && npm run typecheck && npm run build` — pass, exit 0; Vite transformed 1,695 modules and built in 4.34s. The existing large-chunk warning remains.
- `git diff --check` — pass, exit 0 with no output.
- GitNexus impact lookup for the shared Splitter symbols — unavailable because the fresh integration index's Ladybug checkpoint is permission-locked; risk reported `UNKNOWN`. No product symbol was changed.
- Rendered Playwright and Electron-slice reruns — not run, as explicitly required by the no-sockets/no-Playwright/no-Electron constraint. Runtime confirmation remains for the socket-capable orchestrator.

# Decisions

- Treated the existing #1524 and E16 assertions as the acceptance contract; changed harness interaction/setup rather than product behavior or expected outcomes.
- Used `sessionStorage` only as a per-page initialization guard. Playwright creates an isolated browser context for each test, so test-to-test cleanup remains intact while same-page reload persistence is testable.
- Opened the existing advanced-policy disclosure through the rendered UI before editing; did not force the control visible or bypass actionability.
- Made no speculative ToolWorkspace changes because its flows passed in the supplied gate output.
