import type { CheckResult } from './types';

export interface LiveMcpEntry {
  name: string;
  status: string;
}

export interface LiveMcpStatus {
  source: 'live' | 'config-only';
  entries: LiveMcpEntry[];
}

export type LiveMcpFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface ReadLiveMcpStatusOptions {
  apiUrl: string;
  fetchImpl?: LiveMcpFetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1500;

/**
 * Read only the non-sensitive name/status fields exposed by the local API.
 * Any failure falls back to config-only inspection; doctor is diagnostic and
 * must remain useful while the API itself is down.
 */
export async function readLiveMcpStatus(
  options: ReadLiveMcpStatusOptions,
): Promise<LiveMcpStatus> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as LiveMcpFetch);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('local API timeout'));
      }, timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(`${options.apiUrl.replace(/\/$/, '')}/opencode/mcp`, {
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!response.ok) return { source: 'config-only', entries: [] };

    const body = await response.json();
    if (!Array.isArray(body)) return { source: 'config-only', entries: [] };

    const entries = body.flatMap((raw): LiveMcpEntry[] => {
      if (typeof raw !== 'object' || raw === null) return [];
      const entry = raw as Record<string, unknown>;
      if (typeof entry.name !== 'string' || typeof entry.status !== 'string') return [];
      return [{ name: entry.name, status: entry.status }];
    });
    return { source: 'live', entries };
  } catch {
    return { source: 'config-only', entries: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function liveMcpStatusResults(status: LiveMcpStatus): CheckResult[] {
  if (status.source !== 'live') {
    return [{ label: 'MCP status (config-only fallback)', pass: true }];
  }

  return [
    { label: 'MCP status (live API)', pass: true },
    ...status.entries.map((entry): CheckResult => {
      const label = `MCP server: ${entry.name} — ${entry.status}`;
      if (entry.status === 'connected') return { label, pass: true };
      if (entry.status === 'disabled') {
        return { label, pass: true, status: 'disabled' };
      }
      const remediation =
        entry.status === 'needs_auth'
          ? `Connect ${entry.name} in Integrations.`
          : entry.status === 'failed'
            ? `Check ${entry.name}'s server configuration and restart it.`
            : `Check ${entry.name} in MCP settings and confirm the server is available.`;
      return { label, pass: false, remediation };
    }),
  ];
}
