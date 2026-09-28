# Summary

Built and validated the Rhythm package on `mega/2026-09-18-rhythm-plugin-finish` at base `c2133cc47720f8465c7419f8060bca1841cc2ee0`, with all changes left uncommitted. **277 tests passed.** No live install, server, browser, or Electron launch was performed. Operator steps are in [LIVE-GATE.md](/Users/ajhochhalter/Documents/hermes-rhythm-plugin/.worktrees/mega-b1-fork/plugins/rhythm/packaging/LIVE-GATE.md).

Artifacts:

- [Install tree](/Users/ajhochhalter/Documents/hermes-rhythm-plugin/.worktrees/mega-b1-fork/dist/rhythm-feature-pack/): validated 30-file package.
- [Install archive](/Users/ajhochhalter/Documents/hermes-rhythm-plugin/.worktrees/mega-b1-fork/dist/rhythm-feature-pack-20260918.tar.gz): **129,682 bytes**, SHA-256 `22f01f9ca10ea663f28d697b085f16d4dae1b4e3262cf689971751dd347ba33f`.
- Desktop ESM: **437,037 bytes**, SHA-256 `12bc2190eaad01aad593e7a73b8178929054f401efa746c61248201c340d7bf4`.
- Dashboard bundle: **70 bytes**, SHA-256 `e1ede86468902fbf8b1325f4d46a404be53f6b4f809d26253181a19b567e27b0`.

Allowed externals: `@hermes/plugin-sdk`, `react`, `react-dom`, `react/jsx-runtime`, `react-dom/client`. Actual desktop imports: SDK, React, JSX runtime. Dashboard has no imports. The build checks its dependency graph and both bundles for unexpected imports, embedded React, development JSX, source maps, and `.env` references.

The backend now pins `https://api.vcrcapps.com`. Stored credentials must carry that origin binding; unbound Aug 22 records are preserved but require explicit reconnection before reuse.

# Files changed

Paths are relative to this worktree. Nine existing tests were relocated, not discarded.

| Path | Change |
| --- | --- |
| `plugins/rhythm/packaging/build.py` | Rebuild both bundles; check Bun graph; production/no-map/no-env options; CLI; refuse destructive output cleanup. |
| `plugins/rhythm/packaging/validate.py` | Enforce host-only imports and safe production code in both bundles. |
| `plugins/rhythm/packaging/cutover.py` | Correct hosted fixture origin and use fresh temporary build staging. |
| `plugins/rhythm/packaging/package-manifest.json` | Include the live-gate guide in the closed package. |
| `plugins/rhythm/packaging/install-local.sh` | Operator entry point using existing Python 3.11+; prints enable/doctor commands. |
| `plugins/rhythm/packaging/install_local.py` | Validate, back up once, stage both installs, reject symlinks, and restore on replacement failure. |
| `plugins/rhythm/packaging/LIVE-GATE.md` | Exact lifecycle commands, credential flow, hosted method audit, approval/read-back checks, and automated evidence mapping. |
| `plugins/rhythm/dashboard/src/index.js` | Build source for the existing API-only dashboard registration. |
| `plugins/rhythm/backend/client.py` | Pin hosted data requests to `https://api.vcrcapps.com`. |
| `plugins/rhythm/backend/store.py` | Bind saved credentials to the approved origin; reject legacy/other-origin records. |
| `plugins/rhythm/PROVENANCE.md` | Record build base and production packaging transformation. |
| `tests/plugins/rhythm/test_rhythm_backend.py` | Relocate existing tests, correct host fixtures, add origin/reconnection coverage. |
| `tests/plugins/rhythm/test_rhythm_contracts.py` | Relocate and correct repository-root lookup. |
| `tests/plugins/rhythm/test_rhythm_issue_10_contract.py` | Relocate and correct host fixtures. |
| `tests/plugins/rhythm/test_rhythm_m10_cutover.py` | Relocate and correct repository-root lookup. |
| `tests/plugins/rhythm/test_rhythm_m5_contract.py` | Relocate; correct host fixtures and repository-root lookup. |
| `tests/plugins/rhythm/test_rhythm_m7_contract.py` | Relocate and correct repository-root lookup. |
| `tests/plugins/rhythm/test_rhythm_m8_native_tools.py` | Relocate and correct repository-root lookup. |
| `tests/plugins/rhythm/test_rhythm_mounted_oauth.py` | Relocate existing mounted callback tests. |
| `tests/plugins/rhythm/test_rhythm_packaging_scaffold.py` | Relocate; add adversarial bundle/build checks and live-guide declaration. |
| `tests/plugins/rhythm/test_rhythm_install_local.py` | Temporary-home installer, immutable backup, rollback, and tamper/symlink tests. |
| `REPORT.md` | This handoff. |
| `dist/rhythm-feature-pack/`, `dist/rhythm-feature-pack-20260918.tar.gz` | Generated artifacts; untracked and left for the orchestrator (exclude from the source commit). |

# Checks run

All commands ran from the worktree unless a subshell is explicitly shown. Python was the existing Hermes venv, **3.11.15**; Node **22.23.0**; Bun **1.3.14**. No dependencies were installed.

| Exact command | Result / output tail |
| --- | --- |
| `scripts/run_tests.sh -j 2 tests/plugins/test_rhythm_backend.py tests/plugins/test_rhythm_contracts.py tests/plugins/test_rhythm_issue_10_contract.py tests/plugins/test_rhythm_m5_contract.py tests/plugins/test_rhythm_m7_contract.py tests/plugins/test_rhythm_m8_native_tools.py tests/plugins/test_rhythm_m10_cutover.py tests/plugins/test_rhythm_mounted_oauth.py tests/plugins/test_rhythm_packaging_scaffold.py` | Baseline PASS: `9 files, 252 tests passed, 0 failed`. |
| `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m pytest tests/plugins/test_rhythm_packaging_scaffold.py -q` | Baseline PASS: `43 passed in 3.71s`. |
| `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m pytest tests/plugins/rhythm -q` | First run FAIL: `1 failed, 276 passed`; M10 reused a nonempty staging directory. After fixing the caller, final PASS: **`277 passed in 50.74s`**. |
| `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m pytest tests/plugins/rhythm/test_rhythm_m10_cutover.py::test_issue_14_c2_ledger_rejects_missing_proof_secret_leaks_or_unapproved_writes -q` | Reproduced staging failure; after repair PASS: `1 passed in 5.74s`. |
| `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m plugins.rhythm.packaging.build --output dist/rhythm-feature-pack` | PASS: `desktop/dist/rhythm.mjs: 437037 bytes`, `dashboard/dist/index.js: 70 bytes`, `Validated package: …/dist/rhythm-feature-pack`. |
| `bash -n plugins/rhythm/packaging/install-local.sh` | PASS, exit 0. Installer itself was not run against the live home. |
| `git diff --check` | PASS, exit 0. |
| `shasum -a 256 dist/rhythm-feature-pack/desktop/dist/rhythm.mjs dist/rhythm-feature-pack/dashboard/dist/index.js dist/rhythm-feature-pack-20260918.tar.gz` | PASS; hashes recorded above. |
| `if [ -d apps/desktop/node_modules ]; then (cd apps/desktop && npm run typecheck && npm run lint); else echo 'SKIP: apps/desktop/node_modules absent; no dependencies installed'; fi` | SKIPPED: directory absent. |
| `node --version` / `bun --version` | PASS: `v22.23.0` / `1.3.14`. |

Additional socket-free checks: all three Python command snippets in LIVE-GATE compiled without execution; the generated archive was extracted into a temporary directory and passed `validate_package_tree` (`Archive round-trip: validated 30-file closed package`). Full pytest output: `/tmp/rhythm-b1-pytest-final.log`.

# Acceptance criteria

| Criterion | Status and evidence |
| --- | --- |
| 1. Unified package, one desktop ESM plus rebuilt dashboard; safe externals/production JSX/no maps or environment references | **Done locally.** Build output and adversarial packaging tests pass; actual import sets and hashes above. |
| 2. Plugin pytest; conditional desktop typecheck/lint | **Done under the brief's condition.** 277 tests pass at the requested path. Desktop dependency directory is absent, so its checks were skipped. |
| 3. Install artifact and operator script; dated backups and exact destinations; do not install | **Done locally.** Artifact produced; both destination copies, backup preservation, and rollback tested in temporary homes only. Script prints exact doctor/enable/reload commands. |
| 4. LIVE-GATE with lifecycle, credential, read-only network, draft, approval/read-back, and test mappings | **Done as documentation.** Credentialed/installed execution is **not done**, assigned to the orchestrator/AJ by the brief. |
| 5. Preserve excluded plugins and plan files | **Done.** No changes under `plugins/hermes-achievements/**`, `plugins/kanban/**`, or `.hermes/plans/**`. No commit, stash, checkout, or rebase. |

Fork issue evidence below names tests under `tests/plugins/rhythm/` unless another path is shown. “Covered” means local evidence, not authorization to claim a live or signed release. The full issue bodies were not fetched; #4's milestone association is inferred from the campaign sequence.

| Fork issue | Evidence | Remaining closure gate |
| --- | --- | --- |
| #3 — M0 contracts/runtime safety | `test_rhythm_contracts.py`: ownership, permission, bounded operation, renderer credential, port/proxy and sibling-root adversarial checks. | Core reload/ACP suites in `tests/hermes_cli/test_plugins*.py` and `tests/acp/` were not rerun in this scoped worker. |
| #4 — M1/shared UI (inferred) | Vendored `@ajhochy/rhythm-workspace-ui` 0.2.0 provenance at `d676faae…`; actual artifact rebundled with external React. | No #4 commit appears in the 42 fork commits; shared-package React 18/19 tests require their owning repository's evidence. |
| #5 — M2 host seams/sidebar | Contract architecture checks; existing `apps/desktop/src/contrib/rhythm-shell.test.ts` covers one route/sidebar, disposal and duplicate-free reload. | Desktop rendered suite and installed sidebar check pending. |
| #6 — M3 connection | `test_rhythm_backend.py` connection/privacy/PKCE/origin tests; `test_rhythm_mounted_oauth.py` public callback and disabled/replay/origin gates. | AJ credential and actual hosted authentication/provider verification. |
| #7 — M4a Dashboard/Tasks reads | Backend sanitized dashboard/task reads and denied broad writes; existing `rhythm-workspace-ui.test.tsx` mounted read-only/error/draft tests. | Rendered live reads and zero-write trace pending. |
| #8 — M4b task operations | Backend confirmation identity/profile/payload binding, one-use receipts, one PATCH, canonical read-back, conflict and ambiguous transport tests. | Disposable-task approval/read-back live gate pending. |
| #9 — M5 Planner/Rhythms/Projects | `test_rhythm_m5_contract.py`: exact registry, canonical projections, reauthorization, payload discrimination, read-back and receipt concurrency. | Installed rendered/live parity pending. |
| #10 — M6 Messages/Facilities | `test_rhythm_issue_10_contract.py`: pinned reads, no send/create, exact receipt mutation, authorization and bulk-delete absence proof. | Installed rendered/live parity pending. |
| #11 — M7 Automations/Integrations/Artifacts | `test_rhythm_m7_contract.py`: classified reads, opaque-origin artifact runtime and session/conflict-bound capabilities. | Installed artifact/renderer boundary check pending. |
| #12 — M8 native tools | `test_rhythm_m8_native_tools.py`: exact three-tool discovery, bounded untrusted reads, denied/missing ACP, allow-once scope, stale state and uncertain result. | Real ACP approval client and hosted read-back pending. |
| #13 — M9 packaging/lifecycle | `test_rhythm_packaging_scaffold.py`, `test_rhythm_install_local.py`, repeated builds, unsigned macOS fixture and validated archive. | Real install/doctor/disable/remove; signing remains a separate release gate. |
| #14 — M10 cutover | `test_rhythm_m10_cutover.py`: all destination GET traces, exact tools, lifecycle, disabled actions, uncertainty and ledger validation. | Current credentialed/rendered cutover pending; historical ledger labels are not a new renderer run. |

# Decisions

- Moved the nine flat Rhythm test files into the brief's requested test directory instead of creating a duplicate collection wrapper.
- Used checked-in contracts/provenance because the named plan is absent; did not alter or invent plan status.
- Corrected the hosted origin and required explicit reconnection for unbound credentials instead of silently forwarding an old token to a different host.
- Kept the existing hidden API-only dashboard design instead of adding a second workspace UI.
- Stored dated backups as inert `backup.tar` snapshots instead of discoverable plugin copies.
- Used the loader's existing `plugin.js` entry and separate Desktop opt-in; did not invent `ACTIVATION.json`.
- Refused nonempty build output and isolated M10 staging instead of recursively deleting arbitrary caller output.

# Follow-ups

- Orchestrator: run the documented real install, doctor, reload, disable/remove, rendered/axe/zoom/RTL, read-only trace, and ACP completion gates before closing their live acceptance criteria.
- Supply the missing plan and shared-package #4 evidence when reconciling final issue closure.
- Verify the existing M3 Google OAuth registration and hosted API schema; fixture tests do not establish production compatibility.
- Desktop typecheck/lint and existing rendered tests remain unexecuted because dependencies are absent.
- Dev Dashboard recording is deferred to the orchestrator: this worker's later brief restricts writes and directory changes to its worktree, so the external tracker publisher was not run.

# Needs a human

- AJ's hosted Rhythm credential or approved authentication flow; old unbound credentials require explicit revalidation.
- Hermes Desktop/browser interaction and a real interactive ACP approval client with a disposable task.
- Signing/notarization credentials only if proceeding to an actual signed application release.
