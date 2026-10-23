import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Already-installed headless shell in the reviewer environment (no download).
const CACHED_SHELL = '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell';

// Source-only fixture spec. It does NOT start a server: it targets the already
// running loopback fixture preview (owned by the reviewer) on 127.0.0.1:5495.
export default defineConfig({
  testDir: '.', testMatch: 'open-design-tools.sourcespec.ts', workers: 1,
  timeout: 20000, expect: { timeout: 3000 }, reporter: [['line']],
  outputDir: join(tmpdir(), 'rhythm-open-design-tools-results'),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5495',
    ...(existsSync(CACHED_SHELL) ? { launchOptions: { executablePath: CACHED_SHELL } } : {}),
  },
});
