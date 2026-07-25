import { describe, expect, it, vi } from 'vitest';

import {
  TailscaleServeService,
  type CommandResult,
  type CommandRunner,
} from '../tailscale_serve_service';

const result = (
  stdout: string,
  exitCode = 0,
  stderr = '',
): CommandResult => ({ exitCode, stdout, stderr });

const runningStatus = JSON.stringify({
  BackendState: 'Running',
  Self: { DNSName: 'rhythm-mac.tail1234.ts.net.' },
});

describe('issue-1171-c1: Tailscale Serve diagnostics', () => {
  it('reports missing without leaking the command error', async () => {
    const runner: CommandRunner = vi.fn().mockRejectedValue(
      Object.assign(new Error('spawn tailscale ENOENT /private/path'), {
        code: 'ENOENT',
      }),
    );
    await expect(new TailscaleServeService(runner).diagnose()).resolves.toEqual({
      state: 'missing',
      gatewayUrl: null,
      message: 'Tailscale is not installed on this Mac.',
      canConfigure: false,
    });
  });

  it('reports logged-out from both an exit failure and a non-running backend', async () => {
    const exited: CommandRunner = vi.fn().mockResolvedValue(
      result('', 1, 'Logged out as private-user@example.com'),
    );
    await expect(new TailscaleServeService(exited).diagnose()).resolves.toMatchObject({
      state: 'loggedOut',
      gatewayUrl: null,
    });

    const stopped: CommandRunner = vi.fn().mockResolvedValue(
      result(JSON.stringify({ BackendState: 'Stopped' })),
    );
    await expect(new TailscaleServeService(stopped).diagnose()).resolves.toMatchObject({
      state: 'loggedOut',
    });
  });

  it('reports an actionable wrong target without exposing that target', async () => {
    const runner: CommandRunner = vi
      .fn()
      .mockResolvedValueOnce(result(runningStatus))
      .mockResolvedValueOnce(
        result(JSON.stringify({
          Web: { 'rhythm-mac.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:9999/private' } } } },
        })),
      );
    const diagnostic = await new TailscaleServeService(runner).diagnose();
    expect(diagnostic).toEqual({
      state: 'wrongTarget',
      gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
      message: 'Tailscale Serve points somewhere other than Rhythm.',
      canConfigure: true,
    });
    expect(JSON.stringify(diagnostic)).not.toContain('9999');
  });

  it('reports healthy for the normalized Rhythm target', async () => {
    const runner: CommandRunner = vi
      .fn()
      .mockResolvedValueOnce(result(runningStatus))
      .mockResolvedValueOnce(
        result(JSON.stringify({
          Web: { 'rhythm-mac.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'https://localhost:4001' } } } },
        })),
      );
    await expect(new TailscaleServeService(runner).diagnose()).resolves.toEqual({
      state: 'healthy',
      gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
      message: 'Mobile access is available on your private tailnet.',
      canConfigure: false,
    });
  });

  it('configures with an argument array, then verifies the resulting target', async () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const runner: CommandRunner = vi.fn(async (executable, args) => {
      calls.push({ executable, args });
      if (calls.length === 1 || calls.length === 4) return result(runningStatus);
      if (calls.length === 2) return result(JSON.stringify({ Web: {} }));
      if (calls.length === 3) return result('');
      return result(JSON.stringify({ Web: { host: { Handlers: { '/': { Proxy: 'https+insecure://localhost:4001' } } } } }));
    });

    const diagnostic = await new TailscaleServeService(
      runner,
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    ).ensureConfigured();

    expect(diagnostic.state).toBe('healthy');
    expect(calls[2]).toEqual({
      executable: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      args: ['serve', '--bg', 'https+insecure://localhost:4001'],
    });
    expect(calls.flatMap((call) => call.args).join(' ')).not.toContain(';');
  });

  it('is idempotent and never runs configure when Serve is already healthy', async () => {
    const runner: CommandRunner = vi
      .fn()
      .mockResolvedValueOnce(result(runningStatus))
      .mockResolvedValueOnce(
        result(JSON.stringify({ Web: { host: { Handlers: { '/': { Proxy: 'https://localhost:4001' } } } } })),
      );
    await expect(new TailscaleServeService(runner).ensureConfigured()).resolves.toMatchObject({
      state: 'healthy',
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
