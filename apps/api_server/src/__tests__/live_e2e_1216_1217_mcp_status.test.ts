/**
 * Live contracts for #1216/#1217. Runs only inside tools/dev/sandbox.sh.
 * Drives the real scheduler/API/engine and the real `rhythm doctor` CLI.
 */

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const API_URL = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4112';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest: T;
  do {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error(`condition not met within ${timeoutMs}ms: ${JSON.stringify(latest!)}`);
}

function runDoctor(apiUrl: string): Promise<{ output: string; elapsedMs: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), 'dist/cli/index.js'), 'doctor'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RHYTHM_API_URL: apiUrl,
          RHYTHM_DOCTOR_MCP_TIMEOUT_MS: '100',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.once('error', reject);
    child.once('close', () => resolve({ output, elapsedMs: Date.now() - started }));
  });
}

describe.skipIf(!LIVE)('#1216/#1217 live MCP behavior', () => {
  it(
    'issue-1216-live: a scheduled run with a missing required MCP fails fast with remediation',
    async () => {
      const missingServer = `missing-live-${randomUUID().slice(0, 8)}`;
      const schedule = await api<{ id: string }>('/agent-schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: `MCP preflight live ${missingServer}`,
          scheduleType: 'once',
          runAt: new Date(Date.now() + 86_400_000).toISOString(),
          timezone: 'America/Los_Angeles',
          prompt: 'This prompt must never reach the model.',
          agentKind: 'opencode',
          allowedMcps: [missingServer],
        }),
      });

      try {
        const started = Date.now();
        await api(`/agent-schedules/${schedule.id}/trigger-now`, {
          method: 'POST',
          body: '{}',
        });
        const terminal = await poll(
          () => api<{ lastRunStatus: string | null; lastError: string | null }>(
            `/agent-schedules/${schedule.id}`,
          ),
          (task) => task.lastRunStatus === 'error',
          70_000,
        );

        expect(terminal.lastError).toContain(missingServer);
        expect(terminal.lastError).toMatch(/missing.*add or configure/i);
        expect(Date.now() - started).toBeLessThan(70_000);
      } finally {
        await fetch(`${API_URL}/agent-schedules/${schedule.id}`, { method: 'DELETE' });
      }
    },
    80_000,
  );

  it('issue-1217-live: doctor labels live API and config-only fallback sources', async () => {
    const live = await runDoctor(API_URL);
    expect(live.output).toContain('MCP status (live API)');

    const fallback = await runDoctor('http://127.0.0.1:4113');
    expect(fallback.output).toContain('MCP status (config-only fallback)');
    expect(fallback.elapsedMs).toBeLessThan(5_000);
    expect(fallback.output).not.toMatch(/(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/i);
  });
});
