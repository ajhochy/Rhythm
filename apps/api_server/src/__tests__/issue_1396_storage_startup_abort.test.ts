import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const builtServer = path.join(process.cwd(), 'dist', 'server.js');

async function runBuiltServer(storageDir: string, homeDir: string) {
  return await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [builtServer], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '4990',
        RHYTHM_OPENCODE_ENGINE_PORT: '4991',
        HOME: homeDir,
        DB_PATH: path.join(homeDir, 'rhythm-test.db'),
        LIVE_ARTIFACT_STORAGE_DIR: storageDir,
        RHYTHM_ROLE: 'cloud',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 8_000);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`server did not abort within 8s; output:\n${output}`));
        return;
      }
      resolve({ code, output });
    });
  });
}

describe('#1396 — built server aborts when live-artifact storage is unusable', () => {
  it.skipIf(!existsSync(builtServer))(
    'refuses read-only storage targets (requires npm run build)',
    async () => {
      // Regression caught: unit verification existed, but the real server booted without calling it.
      const root = await mkdtemp(path.join(tmpdir(), 'rhythm-1396-startup-'));
      const cases = [
        { label: 'missing child of read-only parent', target: path.join(root, 'readonly-parent', 'missing') },
        { label: 'existing read-only directory', target: path.join(root, 'readonly-existing') },
      ];
      await mkdir(path.dirname(cases[0].target), { recursive: true });
      await mkdir(cases[1].target);
      await chmod(path.dirname(cases[0].target), 0o500);
      await chmod(cases[1].target, 0o500);

      try {
        for (const testCase of cases) {
          const result = await runBuiltServer(testCase.target, root);
          expect(result.code, `${testCase.label}: ${result.output}`).not.toBe(0);
          expect(result.code, `${testCase.label}: terminated by signal`).not.toBeNull();
          expect(result.output).toContain('LIVE_ARTIFACT_STORAGE_DIR');
          expect(result.output).toContain(testCase.target);
          expect(result.output).not.toMatch(/Rhythm (API|mobile gateway) listening/);
          console.info(`#1396 ${testCase.label}: exit=${result.code}; ${result.output.trim()}`);
        }
      } finally {
        await chmod(path.dirname(cases[0].target), 0o700).catch(() => undefined);
        await chmod(cases[1].target, 0o700).catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
