import { execFile } from 'node:child_process';

import {
  acceptedMobileGatewayServeTargets,
  mobileGatewayServeTarget,
} from '../mobile_gateway_config';

const COMMAND_TIMEOUT_MS = 8_000;

export type TailscaleServeState =
  | 'missing'
  | 'loggedOut'
  | 'wrongTarget'
  | 'healthy';

export interface TailscaleServeDiagnostic {
  state: TailscaleServeState;
  gatewayUrl: string | null;
  message: string;
  canConfigure: boolean;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
) => Promise<CommandResult>;

function defaultCommandRunner(
  executable: string,
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        encoding: 'utf8',
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && 'code' in error && error.code === 'ENOENT') {
          reject(error);
          return;
        }
        resolve({
          exitCode:
            error && typeof error.code === 'number'
              ? error.code
              : error
                ? 1
                : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

function cleanDnsName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hostname = value.trim().replace(/\.$/, '').toLowerCase();
  if (!hostname || !/^[a-z0-9.-]+$/.test(hostname)) return null;
  return hostname;
}

function hasExpectedPrivateRoot(value: unknown, hostname: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as {
    Web?: Record<string, {
      Handlers?: Record<string, { Proxy?: unknown }>;
    }>;
    AllowFunnel?: Record<string, unknown>;
  };
  const authority = `${hostname}:443`;
  if (payload.AllowFunnel?.[authority]) return false;
  const proxy = payload.Web?.[authority]?.Handlers?.['/']?.Proxy;
  if (typeof proxy !== 'string') return false;
  const normalized = proxy.trim().toLowerCase().replace(/\/$/, '');
  return acceptedMobileGatewayServeTargets().has(normalized);
}

function missingDiagnostic(): TailscaleServeDiagnostic {
  return {
    state: 'missing',
    gatewayUrl: null,
    message: 'Tailscale is not installed on this Mac.',
    canConfigure: false,
  };
}

function loggedOutDiagnostic(): TailscaleServeDiagnostic {
  return {
    state: 'loggedOut',
    gatewayUrl: null,
    message: 'Sign in to Tailscale on this Mac, then try again.',
    canConfigure: false,
  };
}

export class TailscaleServeService {
  constructor(
    private readonly runCommand: CommandRunner = defaultCommandRunner,
    private readonly executable =
      process.env.RHYTHM_TAILSCALE_BIN?.trim() || 'tailscale',
  ) {}

  async diagnose(): Promise<TailscaleServeDiagnostic> {
    let status: CommandResult;
    try {
      status = await this.runCommand(this.executable, ['status', '--json']);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return missingDiagnostic();
      }
      return {
        state: 'wrongTarget',
        gatewayUrl: null,
        message: 'Tailscale diagnostics are temporarily unavailable.',
        canConfigure: false,
      };
    }

    if (status.exitCode !== 0) return loggedOutDiagnostic();

    let statusPayload: unknown;
    try {
      statusPayload = JSON.parse(status.stdout);
    } catch {
      return {
        state: 'wrongTarget',
        gatewayUrl: null,
        message: 'Tailscale returned an unreadable status.',
        canConfigure: false,
      };
    }

    const record = statusPayload as {
      BackendState?: unknown;
      Self?: { DNSName?: unknown };
    };
    if (record.BackendState !== 'Running') return loggedOutDiagnostic();
    const hostname = cleanDnsName(record.Self?.DNSName);
    if (!hostname) {
      return {
        state: 'wrongTarget',
        gatewayUrl: null,
        message: 'Tailscale did not report a usable tailnet hostname.',
        canConfigure: false,
      };
    }
    const gatewayUrl = `https://${hostname}`;

    let serveStatus: CommandResult;
    try {
      serveStatus = await this.runCommand(this.executable, [
        'serve',
        'status',
        '--json',
      ]);
    } catch {
      return {
        state: 'wrongTarget',
        gatewayUrl,
        message: 'Mobile access is not configured for Rhythm.',
        canConfigure: true,
      };
    }
    if (serveStatus.exitCode !== 0) {
      return {
        state: 'wrongTarget',
        gatewayUrl,
        message: 'Mobile access is not configured for Rhythm.',
        canConfigure: true,
      };
    }

    let servePayload: unknown;
    try {
      servePayload = JSON.parse(serveStatus.stdout);
    } catch {
      servePayload = null;
    }
    if (!hasExpectedPrivateRoot(servePayload, hostname)) {
      return {
        state: 'wrongTarget',
        gatewayUrl,
        message: 'Tailscale Serve points somewhere other than Rhythm.',
        canConfigure: true,
      };
    }

    return {
      state: 'healthy',
      gatewayUrl,
      message: 'Mobile access is available on your private tailnet.',
      canConfigure: false,
    };
  }

  async ensureConfigured(): Promise<TailscaleServeDiagnostic> {
    const before = await this.diagnose();
    if (before.state !== 'wrongTarget' || !before.canConfigure) return before;

    const configured = await this.runCommand(this.executable, [
      'serve',
      '--bg',
      mobileGatewayServeTarget(),
    ]);
    if (configured.exitCode !== 0) {
      return {
        ...before,
        message: 'Tailscale could not enable private mobile access.',
      };
    }
    return this.diagnose();
  }
}
