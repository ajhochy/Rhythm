# Summary

- Replaced the owned Hermes child command with `hermes dashboard --port <port> --host 127.0.0.1 --no-open`; `--skip-build` is now conditional on `<install-dir>/hermes_cli/web_dist/index.html`.
- Added a fresh 32-byte base64url dashboard token per child start. It is held only in the main process, passed only in the dashboard child's environment, redacted from diagnostics, omitted from `Status`, IPC, preload, and URLs, and cleared on stop/failure/exit.
- Readiness now polls `/api/health`. Existing fixed-port, absent/failed/install, consent, owned-child SIGTERM/SIGKILL, and never-global-`--stop` behavior remains intact.
- Bound the supervisor to the B3 native view. Attachment requires both `ready` status and the current main-only token generation, loads the clean `status.url`, and is revoked when the origin or token generation changes.
- Completed B2/B3 packaging, closed bridge receipts, test registration, combined contract, and the small E44 fixture-ordering repair. Also repaired the merged preload's missing Hermes-object closing delimiter.
- No commit was created. The Dev Dashboard run receipt published successfully.

# Files changed

- Supervisor/view wiring: `apps/electron/src/hermes-server.mjs`, `hermes-view.mjs`, `main.mjs`, and `preload.cjs`.
- Packaging/security: `apps/electron/scripts/package-mac.mjs`, `package.json`, and `src/security-smoke-receipt.mjs`.
- Tests: `hermes-server.test.mjs`, `hermes-view.test.mjs`, `security-smoke-receipt.test.mjs`, `electron-shell.test.mjs`, `electron-unsigned-package.test.mjs`, and `e12a-auth-boundary.test.mjs`.
- Contracts/state: `docs/ai/contracts/hermes-electron-contract.md`, `docs/ai/contracts/issue-1542.json`, `docs/ai/project-state.md`, and `docs/ai/runs/2026-09-18-hermes-dashboard-supervisor-view.md`.
- Handoff: `REPORT.md`.

# Checks run

- Launch discipline passed: exact worktree, branch `mega/ws-hermes-integration`, and write probe. `git diff --check` passed.
- Focused self-check passed: Electron typecheck plus `hermes-server.test.mjs` and `e12a-auth-boundary.test.mjs`; 49/49 tests passed.
- Extended socket-free core passed: Electron typecheck plus Hermes server/view/protocol/security receipt suites; 73/73 tests passed.
- Non-launching `electron-shell.test.mjs` subset passed: all `interactive-runtime`, `directory-picker`, `slice-5-c1`, and `slice-5-c2` cases; 10/10 tests passed.
- Web typecheck passed. The web fixture build also passed when needed by `slice-5-c1`.
- Acceptance contract reports 12/12 criteria passed. The contract-first pre-implementation run was red as expected and exposed the old command/path plus the merged preload delimiter defect.
- Per the explicit restriction, no socket, Hermes process, Electron process, or packaged app was launched. Skipped Electron-launch cases: `slice-5-c3`, `slice-5-c4`, `production repair: alternate local ports`, `slice-5-c5`, and `production repair: actual Electron artifact protocol`. The packaged security smoke in `electron-unsigned-package.test.mjs` was updated but not executed because it launches a packaged Electron app.
- GitNexus impact checks produced no HIGH/CRITICAL warning. A fresh index and final compare-scope detection were unavailable: the native analyzer failed under the installed Node runtime and this worktree is not a registered index target.

# Decisions

- Used Hermes's own HTML bootstrap: Rhythm never copies the token into a renderer surface. `getSessionToken()` is a main-process generation handle that gates view attachment while the clean dashboard URL lets Hermes inject its token into its own HTML.
- Removed inherited `HERMES_DASHBOARD_SESSION_TOKEN` from all ordinary child environments before supplying the newly minted value only to the dashboard child.
- Treated token rotation as a supervisor-generation change and destroyed any attached view from the prior generation.
- Added `hermes-server.mjs` to packaging in addition to the five requested B3 support files because packaged `main.mjs` imports the supervisor directly.
- Fixed E44 by waiting for the created window's bridge rather than only the window object; no broader fixture rewrite was needed.
- Preserved the no-commit instruction and did not broaden verification into prohibited runtime launches.

# Follow-ups

- In an authorized environment, run the five real-Electron shell cases, the packaged security smoke, and a real Hermes dashboard/view bootstrap against the installed assets before any release-readiness claim.
- Refresh/register the GitNexus index under a compatible runtime, then rerun compare-scope change detection.
- Human review remains required before commit or draft PR; no merge is authorized.
