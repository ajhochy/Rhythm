## 2026-08-13 — Issue 2006 — Thread rename and delete

- **Result**: smoke PASS (verification not yet claimed)
- **Category**: none — no behavior divergence found
- **Criteria affected**: issue-2006-c13
- **Root cause**: The new interaction passed the live smoke; automated Playwright remained blocked before assertions by managed Chrome Crashpad permissions.
- **Suggested fix**: Run the installed-Chrome contract outside the managed Crashpad restriction or provide a sandbox-compatible browser profile.

## 2026-08-13 — Issues 2007–2009 — Shared list and inspector layout

- **Result**: smoke PASS (verification not yet claimed)
- **Category**: none — no behavior divergence found
- **Criteria affected**: issue-2007-visual, manual-visual-parity-2008, manual-visual-parity-2009
- **Root cause**: The live pages retained their domain controls while the new split composition kept selection and details synchronized.
- **Suggested fix**: Keep split-view selection and responsive collapse covered by route-level visual smoke checks.

## 2026-08-13 — Session controls — Remove duplicate run controls

- **Result**: smoke PASS (verification not yet claimed)
- **Category**: none — no behavior divergence found
- **Criteria affected**: session-control-deduplication
- **Root cause**: Stop, model, reasoning, and Fast were exposed in both the session header and the composer despite representing the same run controls.
- **Suggested fix**: Keep run controls in the composer and reserve the header for session context and actions without composer equivalents.
