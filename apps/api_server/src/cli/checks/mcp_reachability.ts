import type { CheckResult } from './types';

export interface McpServerSpec {
  id: string;
  name: string;
  type: 'local' | 'remote';
  url?: string;
  command?: string[];
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export interface McpReachabilityDeps {
  servers: McpServerSpec[];
  fetchImpl?: FetchLike;
  /** Per-server timeout. Default 3000ms — keeps `doctor` fast even when a remote MCP is down. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

async function checkOne(
  server: McpServerSpec,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<CheckResult> {
  const label = `MCP server: ${server.name}`;

  // Local (stdio) servers are launched on demand by the engine; there is no
  // standing network endpoint to probe. Report informational-pass — actual
  // launch failures surface at use time, not here (this check is read-only
  // and must not spawn processes).
  if (server.type === 'local') {
    return { label, pass: true };
  }

  if (!server.url) {
    return {
      label,
      pass: false,
      remediation: `${server.name} is configured as a remote MCP server but has no URL. Check its opencode.json entry.`,
    };
  }

  const controller = new AbortController();

  // Race the fetch against an independent timeout — a mocked or
  // misbehaving `fetchImpl` that never settles (and never honors the abort
  // signal) must not hang `rhythm doctor` forever.
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error(`timed out after ${timeoutMs}ms`), { name: 'AbortError' }));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(server.url, { signal: controller.signal }),
      timeoutPromise,
    ]);
    if (!response.ok) {
      return {
        label,
        pass: false,
        remediation: `${server.name} responded with status ${response.status}. Check that the server is running and reachable.`,
      };
    }
    return { label, pass: true };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      label,
      pass: false,
      remediation: isAbort
        ? `${server.name} timed out after ${timeoutMs}ms. It may be unreachable or slow to respond.`
        : `${server.name} is unreachable (${
            err instanceof Error ? err.message : String(err)
          }). Check the URL and your network connection.`,
    };
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * #871 — checks that each configured MCP server is reachable. Local (stdio)
 * servers are reported informational-pass without a network call. Remote
 * (HTTP) servers are probed with a bounded timeout; any failure mode (bad
 * status, network error, timeout) resolves to a graceful `CheckResult` —
 * this function NEVER throws, matching the "no crash on unreachable MCP"
 * acceptance criterion.
 */
export async function checkMcpReachability(
  deps: McpReachabilityDeps,
): Promise<CheckResult[]> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return Promise.all(deps.servers.map((server) => checkOne(server, fetchImpl, timeoutMs)));
}
