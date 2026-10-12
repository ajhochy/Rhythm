import type { GatewayMode } from '.';

export interface RuntimeInfo {
  engine: {
    port: number;
    pid: number | null;
    bootId: string | null;
    version: string | null;
    status: 'ready' | 'unavailable';
    bridgeLive: boolean;
  };
  api: { port: number };
  remoteOverride: string | null;
}

export interface RuntimeBlocker {
  type: 'session' | 'permission' | 'restart';
  id?: string;
  name?: string;
  status?: string;
  sessionId?: string;
  permissionId?: string;
  summary?: string;
  message?: string;
}

export interface RuntimeRestartResult {
  status: 'ready';
  bootId: string;
  previousBootId: string | null;
}

export type SessionRetentionMode = 'off' | 'dry-run' | 'on';

/** GET/PUT /system/session-retention on the local API (docs/ai/decisions/2026-09-29-session-db-retention.md). */
export interface SessionRetentionState {
  mode: SessionRetentionMode;
  source: 'env' | 'setting' | 'default';
  setting: SessionRetentionMode | null;
  lastReport?: {
    mode: SessionRetentionMode;
    finishedAt: string;
    reclaimableBytes: { engine: number | null; rhythm: number | null };
    rowsWritten: { engine: number | null; rhythm: number | null };
  };
}

export interface RuntimeGateway {
  readonly mode: GatewayMode;
  get(): Promise<RuntimeInfo>;
  restartEngine(): Promise<RuntimeRestartResult>;
  sessionRetention(): Promise<SessionRetentionState>;
  setSessionRetention(mode: SessionRetentionMode): Promise<SessionRetentionState>;
}

export class RuntimeGatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly blockers: RuntimeBlocker[] = [],
  ) {
    super(message);
  }
}

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    const payload = await result.json().catch(() => ({})) as {
      statusMessage?: string;
      reason?: string;
      blockers?: RuntimeBlocker[];
      error?: { message?: string };
    };
    if (!result.ok) {
      throw new RuntimeGatewayError(
        result.status,
        payload.statusMessage ?? payload.error?.message ?? payload.reason ?? `${operation} failed (${result.status})`,
        payload.blockers ?? [],
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof RuntimeGatewayError) throw error;
    throw new RuntimeGatewayError(0, `${operation} service unavailable`);
  }
}

export function createLiveRuntimeGateway(apiBase: string, fetcher: typeof fetch = fetch): RuntimeGateway {
  return {
    mode: 'live',
    get: () => response<RuntimeInfo>('Load runtime', fetcher(`${apiBase}/opencode/runtime`, { method: 'GET' })),
    restartEngine: () => response<RuntimeRestartResult>('Restart engine', fetcher(`${apiBase}/system/restart-engine`, { method: 'POST' })),
    sessionRetention: () => response<SessionRetentionState>('Load session cleanup', fetcher(`${apiBase}/system/session-retention`, { method: 'GET' })),
    setSessionRetention: (mode) => response<SessionRetentionState>('Save session cleanup', fetcher(`${apiBase}/system/session-retention`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    })),
  };
}
