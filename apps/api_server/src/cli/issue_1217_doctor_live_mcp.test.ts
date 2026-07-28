/**
 * Contract for #1217. Regressions caught here:
 * - doctor must prefer the local API's live engine status;
 * - API failure must be bounded and explicitly labeled config-only;
 * - response/config secret values must never reach rendered output.
 */

import { describe, expect, it, vi } from 'vitest';

import { formatDoctorReport, runDoctor } from './doctor';

const baseDeps = {
  apiKeys: () => [],
  nodeVersion: () => ({ label: 'Node.js version', pass: true }),
  pythonVersion: async () => ({ label: 'Python version', pass: true }),
  configValidity: async () => [],
  mcpServers: () => [
    { id: 'rhythm', name: 'rhythm', type: 'local' as const, command: ['node', 'server.js'] },
  ],
  rhythmConfig: () => ({ capabilities: {}, disabledMcpServers: [], enabledSkills: null }),
};

describe('#1217 doctor live MCP status', () => {
  it('issue-1217-c1: reports live failed/disabled/connected statuses from the local API', async () => {
    const report = await runDoctor({
      env: { RHYTHM_API_URL: 'http://127.0.0.1:4112' },
      deps: {
        ...baseDeps,
        mcpLiveStatus: async () => ({
          source: 'live',
          entries: [
            { name: 'rhythm', status: 'connected' },
            { name: 'pco-services', status: 'failed', error: 'spawn failed' },
            { name: 'optional-mail', status: 'disabled' },
          ],
        }),
      },
    });

    const text = formatDoctorReport(report);
    expect(text).toContain('MCP status (live API)');
    expect(text).toMatch(/pco-services.*failed/i);
    expect(text).toMatch(/optional-mail.*disabled/i);
    expect(report.exitCode).toBe(1);
  });

  it('issue-1217-c2: falls back within a timeout and labels results config-only when the API is down', async () => {
    const report = await runDoctor({
      env: { RHYTHM_API_URL: 'http://127.0.0.1:4112' },
      deps: {
        ...baseDeps,
        mcpLiveStatus: async () => ({ source: 'config-only', entries: [] }),
        mcpReachability: async () => [{ label: 'MCP server: rhythm', pass: true }],
      },
    });

    const text = formatDoctorReport(report);
    expect(text).toContain('MCP status (config-only fallback)');
  });

  it('issue-1217-c3: never renders secret values returned by the API', async () => {
    const secret = 'sk-live-secret-must-not-render';
    const report = await runDoctor({
      deps: {
        ...baseDeps,
        mcpLiveStatus: async () => ({
          source: 'live',
          entries: [{
            name: 'dangerous',
            status: 'failed',
            error: `could not launch with token ${secret}`,
            environment: { API_KEY: secret },
          }],
        }),
      },
    });

    expect(formatDoctorReport(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it('issue-1217-c4: the default local API read is timeout-bounded', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      () => new Promise<{ ok: boolean; json: () => Promise<unknown> }>(() => {}),
    );
    const promise = runDoctor({
      env: { RHYTHM_API_URL: 'http://127.0.0.1:4112', RHYTHM_DOCTOR_MCP_TIMEOUT_MS: '25' },
      deps: {
        ...baseDeps,
        fetchImpl,
        mcpReachability: async () => [],
      },
    });

    await vi.advanceTimersByTimeAsync(26);
    const report = await promise;
    vi.useRealTimers();

    expect(formatDoctorReport(report)).toContain('config-only fallback');
  });
});
