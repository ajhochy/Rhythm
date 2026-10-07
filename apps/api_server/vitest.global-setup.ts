import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    rhythmTestRunRoot: string;
  }
}

export default function setup(project: TestProject) {
  if (process.env.RHYTHM_LIVE_E2E === '1') return;
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-vitest-'));
  project.provide('rhythmTestRunRoot', runRoot);
  // Vitest owns the run lifetime, including files whose tests are all skipped.
  return () => fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
