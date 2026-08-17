import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'post-m1-phase-6-files-diffs-search-worktrees.redspec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  // post-m1-phase-6: measured — createLiveSession awaits `stableEngineRef` (store.tsx), a fixed
  // ~2.2s `setTimeout` debounce before the create POST fires at all (profile/auth changes bounce
  // the supervised engine; the wait absorbs that). c3a/c3b drive the advanced-create dialog with
  // instant scripted clicks, so the 2000ms default let `expect.poll` give up ~200ms before the
  // request was ever sent. Confirmed by observation: both failed at exactly the create-POST/
  // context-panel assertions with a 2000ms timeout and passed once raised past the debounce.
  expect: { timeout: 4_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4176',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_LIVE_TOKEN=phase6-contract-token npm run dev -- --host 127.0.0.1 --port 4176',
    url: 'http://127.0.0.1:4176',
    // post-m1-phase-6: measured — a spec whose locator never resolves (the redspec's mocked
    // find-files/list/diff routes return `{ok:true}`, not real path data, for two assertions
    // that expect literal file content) runs its `.click()`/`.toContainText()` out to the full
    // 20s test timeout. With `false`, that full-timeout hang reproducibly kills the webServer
    // child Playwright itself spawned, cascading ECONNREFUSED onto every later test in the same
    // run. Reproduced the fix: pointing this config at an independently pre-started server on
    // :4176 (so Playwright only reuses it, never owns its lifecycle) let the identical test
    // sequence run through the same full-timeout hang with zero cascading failures. `true` still
    // spawns its own server when none is running — this is strictly more lenient, never masks a
    // real assertion failure.
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
