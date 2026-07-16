import path from 'node:path';

export interface EngraphHit {
  file: string;
}

export interface EngraphClient {
  search(query: string, topN: number): Promise<EngraphHit[]>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Optional, loopback-only client for an operator-managed persistent Engraph
 * service. It deliberately does not start, index, or otherwise manage Engraph.
 */
export class EngraphHttpClient implements EngraphClient {
  constructor(
    private readonly baseUrl = process.env.ENGRAPH_MEMORY_URL ?? '',
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 1_000,
  ) {}

  async search(query: string, topN: number): Promise<EngraphHit[]> {
    if (!query.trim()) return [];
    let url: URL;
    try {
      url = new URL('/api/search', this.baseUrl);
      if (url.protocol !== 'http:' || !['127.0.0.1', '::1'].includes(url.hostname)) return [];
    } catch {
      return [];
    }

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, top_n: topN }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return [];
      const body: unknown = await response.json();
      const results = Array.isArray(body)
        ? body
        : body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)
          ? (body as { results: unknown[] }).results
          : [];
      return results.flatMap((result) => {
        const file = result && typeof result === 'object'
          ? (result as { file_path?: unknown }).file_path
          : null;
        return typeof file === 'string' && file.length > 0 ? [{ file }] : [];
      });
    } catch {
      return [];
    }
  }
}

/** Convert an Engraph vault-relative hit to the exact index sourceId or reject it. */
export function mapEngraphFileToSourceId(
  file: string,
  memoryRoot: string,
  engraphVaultRoot: string,
): string | null {
  if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) return null;
  const vaultRoot = path.resolve(engraphVaultRoot);
  const absoluteHit = path.resolve(vaultRoot, file);
  const relativeToVault = path.relative(vaultRoot, absoluteHit);
  if (relativeToVault === '' || relativeToVault === '..' || relativeToVault.startsWith(`..${path.sep}`)) return null;

  const root = path.resolve(memoryRoot);
  const sourceId = path.relative(root, absoluteHit);
  if (sourceId === '' || sourceId === '..' || sourceId.startsWith(`..${path.sep}`)) return null;
  return sourceId.split(path.sep).join('/');
}
