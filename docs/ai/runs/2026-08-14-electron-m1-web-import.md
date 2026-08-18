---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [electron-m1-slice-1]
status: ready_for_verification
tags: [run, Rhythm]
---

# Electron M1 Slice 1 — external web import baseline

## Files

- Added the filtered external snapshot under `apps/web/`.
- Added `apps/web/.gitignore`, `apps/web/PROVENANCE.md`, and `apps/web/SHA256SUMS`.
- Added `docs/ai/contracts/web-import-baseline.md`.
- Adapted `apps/web/tests/dist-smoke.mjs` after failure triage to remove only the absent external Open Design launcher dependency; no product source changed.
- Updated provenance and the deterministic inventory for the adapted smoke file.
- After verification failed, added one active encoded traversal assertion and durable representative screenshot evidence; no app source or other test changed.
- No existing Rhythm symbol was edited, so the approved all-new-tree GitNexus impact waiver applied.

## Import evidence

- Source: `/Users/ajhochhalter/Library/Application Support/Open Design/namespaces/release-stable/data/projects/fc0be6da-6e7a-4650-aa68-3bd044a0712c/rhythm-desktop-agents`
- Project ID: `fc0be6da-6e7a-4650-aa68-3bd044a0712c`
- Source had no Git metadata; none was invented.
- Preflight confirmed `apps/web` was absent.
- Unfiltered snapshot: 6,415 regular files. Imported: 144 regular files. Excluded: 6,271 regular files.
- Exact copy command:

  ```bash
  rsync -a --exclude='.git/' --exclude='node_modules/' --exclude='dist/' --exclude='test-results/' --exclude='playwright-report/' --exclude='coverage/' --exclude='.cache/' --exclude='.vite/' --exclude='*.tsbuildinfo' --exclude='*.log' --exclude='*.tmp' --exclude='*.temp' --exclude='.DS_Store' --exclude='.env' --exclude='.env.*' --exclude='*.pem' --exclude='*.key' ./ "/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/web/"
  ```

- The same exclusions with `rsync -ani --delete` produced no differences before destination metadata was added.
- Original imported inventory root SHA-256: `e2add3807adc9643a41b25c6222931b87cc48df190698601fd63e1ad34ade237`.
- Original imported `tests/dist-smoke.mjs` SHA-256: `b972d4b210d32d4c588e9e249660e87cb201798dffb5919b47036961b6d21a1d`.
- Adapted `tests/dist-smoke.mjs` SHA-256: `167271fef47f9eede3420390f0029ff1228ade73fcd6fe80e5b8d5493a1effbe`.
- Adapted inventory root SHA-256: `acd7d9664e006d5027251dd6166d321f8d4f3c144d40dc943b452e0c574e8b97`.
- `shasum -a 256 -c SHA256SUMS` verified all 144 inventory entries; `shasum -a 256 SHA256SUMS` reproduced the adapted root digest.
- Verification-repair `tests/dist-smoke.mjs` SHA-256: `b72c5578f9c257b3d7e36e6ea4b1c24f61b921b7696a204e531aa27178e4c836`.
- Verification-repair inventory root SHA-256: `e0ceaf876bb347c82ea7a52aba31dedc67469d5a14a2984ba40b8962158b0e53`; inventory count remains 144.

## Checks

1. Acceptance red:

   ```bash
   test -f apps/web/PROVENANCE.md && test -f apps/web/SHA256SUMS || { printf '%s\n' 'FAIL: apps/web provenance and inventory are absent before import' >&2; exit 1; }
   ```

   **Expected FAIL observed** before import.

2. Locked install:

   ```bash
   npm ci
   ```

   **PASS:** 77 packages installed. npm reported two audit findings: one moderate and one high; no dependency changes were made.

3. TypeScript and production build:

   ```bash
   npm run build
   ```

   **PASS:** TypeScript project build and Vite build completed. Vite warned that the 707.93 kB JS chunk exceeds 500 kB; no baseline optimization was attempted.

4. Discovery:

   ```bash
   npm run test:list
   ```

   **PASS:** 239 tests in 32 files discovered. This supersedes the source README's stale 230-test claim. The env-gated `issue-0-live-mode.spec.ts` was absent from default discovery.

5. Complete fixture suite using installed Google Chrome, one worker, and loopback servers `127.0.0.1:4173`/`:4174`:

   ```bash
   npx playwright test --config "/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/web-import-installed-chrome.config.cjs" --workers=1
   ```

   **PASS:** 238 passed, 1 skipped, 0 failed (239 total; 6.7 minutes). The one skip is the `RHYTHM_SWEEP=1` screenshot sweep. The first attempt used temporary ports 4185/4186 and produced 237 passed, 1 skipped, 1 failed because the preserved sandbox test hard-codes the documented dist port 4174; rerunning on the baseline ports passed without source/test edits.

6. Dist smoke:

   ```bash
   npm run test:dist-smoke
   ```

   **Expected repair red observed:** before editing, `ENOENT` for `/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/rhythm-desktop-agents.html` proved the old host dependency was the blocker.

   Failure triage recommendation B authorized removing only `launcherPath`, the launcher read, and its URL assertion. The direct `dist/index.html#/agents` HTTP check, React root assertion, relative asset existence/non-empty assertions, path-traversal guard, and served-asset checks remain.

   **PASS after repair:** `dist smoke passed: index and 2 relative assets verified`.

7. Contract completion:

   ```bash
   test -f apps/web/PROVENANCE.md && test -f apps/web/SHA256SUMS
   ```

   **PASS.**

8. Focused repair validation from `apps/web`:

   - `npm run build` — **PASS:** 1,626 modules transformed; `dist/index.html` 0.78 kB, CSS 257.29 kB, JS 707.93 kB; the pre-existing >500 kB chunk warning remains.
   - `npm run test:dist-smoke` — **PASS:** index and 2 relative assets verified.
   - `shasum -a 256 -c SHA256SUMS` — **PASS:** all 144 entries reported `OK`.
   - `shasum -a 256 SHA256SUMS` — **PASS:** `acd7d9664e006d5027251dd6166d321f8d4f3c144d40dc943b452e0c574e8b97`.
   - `git status --short` — **PASS/scope observed:** `apps/web/`, this contract/run note, and the pre-existing Slice 0/provider evidence remain untracked; no generated build output appeared separately.
   - The 239-test Playwright suite was deliberately not rerun: its prior result remains 238 passed, one `RHYTHM_SWEEP` skip, and zero failures, and this repair changes no app code. The skipped sweep was run separately as the targeted evidence command below.

## Verification failure and focused repair

- Verification correctly failed after the first handoff: the run claimed path safety without exercising the guard, and the env-gated screenshot sweep had skipped with no durable artifact. See the unchanged retrospective at `docs/ai/runs/2026-08-14-retro-slice-1-evidence-acceptance.md`.
- Acceptance-contract handling for this evidence-and-test-only repair: `WAIVED: evidence-and-test-only repair with no application behavior change; verification is the encoded traversal assertion, targeted screenshot sweep, artifact validation, checksum verification, and dist-smoke pass.`
- Added exactly one meaningful request in the active dist server block: ``fetch(`${base}/%2e%2e%2fpackage.json`)``, asserted as `404` with an encoded-traversal failure message. `package.json` is immediately outside `dist`; without the existing guard the request resolves to it and returns `200`. All existing index/root/assets checks remain.
- Targeted evidence only, from `apps/web`:

  ```bash
  RHYTHM_SWEEP=1 npx playwright test tests/screenshot-sweep.spec.ts --workers=1
  ```

  **PASS:** 1 passed in 35.1 seconds. `RHYTHM_SWEEP=1` was enabled only for this targeted evidence run; the other 238 tests were not rerun.
- Copied `apps/web/test-results/sweep/dashboard-1440.png` to `docs/ai/runs/evidence/electron-m1-slice1-dashboard-1440.png`.
- Artifact decode/dimensions: `sips -g pixelWidth -g pixelHeight ...` — **PASS**, `1440 × 900`.
- Artifact SHA-256: `1ccc81fcfb344dc63ad0b3d08f8d6cbe5e00a38e2f3e4f07fdb75a4304c9f231`.
- Visual reviewer/date/result: `coding-agent`, 2026-08-14, **PASS for baseline artifact validity only**. The dashboard is populated and legible with no obvious blank page, error state, unintended overlay, corruption, or unintended clipping in visible content. The next section begins at the viewport fold behind the fixed request-log footer; this is normal continuation. This does not claim product-design approval.

### Focused verification-repair checks

- `npm run test:dist-smoke` — **PASS:** `dist smoke passed: index and 2 relative assets verified`; this includes the active encoded traversal `404` assertion.
- `shasum tests/dist-smoke.mjs` — **PASS:** SHA-1 `b8f7243ac4707ba21375c3351c47673e4e409b11`.
- `shasum -a 256 tests/dist-smoke.mjs` — **PASS:** SHA-256 `b72c5578f9c257b3d7e36e6ea4b1c24f61b921b7696a204e531aa27178e4c836`.
- `shasum -c SHA256SUMS` — **PASS:** all 144 entries reported `OK`.
- `shasum SHA256SUMS` — **PASS:** SHA-1 `795f7bcf0adfdfc4ac2ecf6ca2c49803b9a3e8d5`.
- `shasum -a 256 SHA256SUMS` — **PASS:** SHA-256 root `e0ceaf876bb347c82ea7a52aba31dedc67469d5a14a2984ba40b8962158b0e53`.
- `git diff --no-index --check /dev/null <owned-text-file>` over all five owned text files — **PASS:** no whitespace errors after removing three pre-existing Markdown hard-break spaces from this contract's header.

## Isolation and scope

- `RHYTHM_LIVE_E2E` was not enabled. `RHYTHM_SWEEP=1` was enabled only for the targeted one-test evidence run after verification failed.
- Both Playwright configs preserve `issue-0-live-mode.spec.ts` only when `RHYTHM_LIVE_E2E=1`; default discovery did not include it.
- `tests/helpers.ts` aborts every request whose hostname is not `127.0.0.1`; destination contracts for Dashboard, Planner, Tasks, Rhythms, Projects, Messages, Facilities, Automations, and Integrations independently asserted loopback-only behavior and passed.
- Source inspection found no `fetch`, `XMLHttpRequest`, or `WebSocket` call in `src/`. Two `http://localhost:4001` strings are display-only webhook fixtures; no request API consumes them. The only test target for `:4001` is the excluded paused-live contract. No `:4096` runtime target exists outside historical documentation/contracts.
- Evidence gap: no OS-level packet capture wrapped the full browser run; the claim is supported by the suite's route aborts, per-page request assertions, static source inspection, and passing fixture contracts.
- Final `git status --short` contained untracked `apps/web/`, this contract/run note, the new screenshot artifact, and the untouched pre-existing provider contract/run note and Slice 1 retrospective. No out-of-scope tracked file was modified.
- `git status --ignored --short apps/web` showed `dist/`, `node_modules/`, `test-results/`, and both generated `*.tsbuildinfo` files ignored. No report/build/dependency output is tracked.
- `gitnexus_detect_changes(scope=all, worktree=...)` reported zero changed symbols/processes and risk `none`, as expected because this slice adds only untracked files and edits no indexed Rhythm symbol.
- The healthy sandbox on ports 4098/4097/4099 was neither stopped nor started. Ports 4001/4096 were not contacted by the fixture run.

## Outcome

`READY_FOR_VERIFICATION`: the first focused repair adds executed encoded-traversal evidence and a decoded, reviewed, hashed dashboard baseline artifact. Direct dist smoke and all 144 repaired inventory checks pass; the prior build and 238-pass baseline remain valid, and only the targeted one-test screenshot sweep was rerun.
