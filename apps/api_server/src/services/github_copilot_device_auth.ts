import { logger } from '../utils/logger';
import { opencodeClient } from './opencode_engine';

const CLIENT_ID = 'Ov23li8tweQw6odWQebz';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const SAFETY_MARGIN_MS = 1000;

export type DeviceFlowStart = {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  // We keep deviceCode internal — don't return it to clients.
};

type ActiveFlow = {
  deviceCode: string;
  interval: number;
  expiresAt: number;
  status: 'pending' | 'success' | 'failed' | 'expired';
  reason?: string;
};

export class GithubCopilotDeviceAuth {
  // Single active flow per process — Settings UI doesn't support concurrent
  // device flows and the user would only have one happening at a time.
  private active: ActiveFlow | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  /** Begin a new device flow. Returns the user-facing code and URL. */
  async start(): Promise<DeviceFlowStart> {
    // Cancel any existing flow.
    this.cancel();

    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'rhythm-api-server',
      },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: 'read:user' }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `GitHub /login/device/code returned ${res.status}: ${text.slice(0, 120)}`,
      );
    }
    const data = (await res.json()) as {
      verification_uri: string;
      user_code: string;
      device_code: string;
      interval: number;
      expires_in: number;
    };
    this.active = {
      deviceCode: data.device_code,
      interval: data.interval,
      expiresAt: Date.now() + data.expires_in * 1000,
      status: 'pending',
    };
    this.schedulePoll(data.interval);
    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
    };
  }

  /** Snapshot of the current flow's status. UI polls this. */
  status(): { status: ActiveFlow['status']; reason?: string } | null {
    if (!this.active) return null;
    return { status: this.active.status, reason: this.active.reason };
  }

  cancel(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.active = null;
  }

  private schedulePoll(intervalSeconds: number): void {
    const delay = intervalSeconds * 1000 + SAFETY_MARGIN_MS;
    this.pollTimer = setTimeout(() => this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (!this.active || this.active.status !== 'pending') return;
    if (Date.now() > this.active.expiresAt) {
      this.active.status = 'expired';
      this.active.reason = 'Device code expired before user completed entry.';
      return;
    }

    let response: Response;
    try {
      response = await fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'rhythm-api-server',
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: this.active.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
    } catch (err) {
      logger.error('[GithubCopilotDeviceAuth] poll fetch threw:', err);
      this.schedulePoll(this.active.interval);
      return;
    }

    if (!response.ok) {
      this.active.status = 'failed';
      this.active.reason = `GitHub returned HTTP ${response.status}`;
      return;
    }

    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      interval?: number;
    };

    if (data.access_token) {
      // Persist via the SDK so it lands in ~/.local/share/opencode/auth.json.
      const ok = await opencodeClient.setOAuthCredentials('github-copilot', {
        access: data.access_token,
        refresh: data.access_token,
        expires: 0, // GitHub Copilot tokens don't expire on this flow.
      });
      if (ok) {
        this.active.status = 'success';
      } else {
        this.active.status = 'failed';
        this.active.reason = 'auth.set rejected the GitHub access token';
      }
      return;
    }

    if (data.error === 'authorization_pending') {
      this.schedulePoll(this.active.interval);
      return;
    }
    if (data.error === 'slow_down') {
      const bump = (data.interval ?? this.active.interval + 5) * 1000;
      this.pollTimer = setTimeout(() => this.poll(), bump + SAFETY_MARGIN_MS);
      return;
    }
    if (data.error) {
      this.active.status = 'failed';
      this.active.reason = data.error;
      return;
    }

    // No token, no recognized error — keep polling.
    this.schedulePoll(this.active.interval);
  }
}

export const githubCopilotDeviceAuth = new GithubCopilotDeviceAuth();
