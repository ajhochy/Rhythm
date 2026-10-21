import { defineConfig } from '@playwright/test';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runRoot = process.env.RHYTHM_HERMES_TURN_RUN_ROOT;
let outputDir;
let reporter = [['list']];

// Discovery may run without private inputs. A real execution requires the test's
// explicit owner-only run root, and all Playwright artifacts stay beneath it.
if (runRoot) {
  if (!runRoot.startsWith('/private/tmp/') || resolve(runRoot) !== runRoot) {
    throw new Error('unique canonical private Hermes run root required');
  }
  const st = lstatSync(runRoot);
  if (realpathSync(runRoot) !== runRoot || !st.isDirectory() || st.isSymbolicLink()
    || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o700) {
    throw new Error('private Hermes run root ownership/mode mismatch');
  }
  outputDir = join(runRoot, 'playwright-output');
  if (existsSync(outputDir)) {
    const outStat = lstatSync(outputDir);
    if (realpathSync(outputDir) !== outputDir || !outStat.isDirectory() || outStat.isSymbolicLink()
      || outStat.uid !== process.getuid?.() || (outStat.mode & 0o022) !== 0) {
      throw new Error('Playwright output directory ownership/mode mismatch');
    }
  }
  reporter = [['list'], ['json', { outputFile: join(runRoot, 'turn-report.json') }]];
}

export default defineConfig({
  testDir: here,
  testMatch: 'packaged-ai-private-hermes-openai-luna.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  ...(outputDir ? { outputDir } : {}),
  reporter,
  use: { actionTimeout: 20_000, navigationTimeout: 30_000, screenshot: 'off', trace: 'off', video: 'off' },
});
