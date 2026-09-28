import path from 'node:path';

export interface EngraphHit {
  file: string;
  /**
   * Engraph 1.7.2's final hybrid/RRF rank score. Useful for diagnostics, but
   * not a calibrated semantic confidence and therefore never sufficient by
   * itself for automatic injection.
   */
  score?: number | null;
  /** Explicit backend confidence/similarity, when a future schema supplies it. */
  confidence?: number | null;
  /** Raw backend distance, preserved for diagnostics only. */
  distance?: number | null;
}

export type EngraphSearchStatus =
  | 'ok'
  | 'backend_unavailable'
  | 'timeout'
  | 'http_error'
  | 'malformed'
  | 'no_hits';

export interface EngraphSearchResult {
  hits: EngraphHit[];
  status: EngraphSearchStatus;
}

export interface EngraphClient {
  search(query: string, topN: number): Promise<EngraphHit[]>;
  /** Optional diagnostic surface; legacy/test clients may keep search() only. */
  searchDetailed?(query: string, topN: number): Promise<EngraphSearchResult>;
  /** Result of the most recent search() on this short-lived retrieval client. */
  lastSearchResult?(): EngraphSearchResult | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Optional, loopback-only client for an operator-managed persistent Engraph
 * service. It deliberately does not start, index, or otherwise manage Engraph.
 */
export class EngraphHttpClient implements EngraphClient {
  private lastResult: EngraphSearchResult | null = null;

  constructor(
    private readonly baseUrl = process.env.ENGRAPH_MEMORY_URL ?? '',
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 1_000,
    /**
     * #1096 WP1 — bearer token for a Rhythm-managed Engraph service (which
     * requires API-key auth by default). Optional and additive: omitted
     * entirely for the pre-existing operator-managed-service contract (#1093/
     * #1095), which never sent an Authorization header.
     */
    private readonly authToken?: string,
  ) {}

  async search(query: string, topN: number): Promise<EngraphHit[]> {
    const result = await this.runSearch(query, topN);
    this.lastResult = result;
    return result.hits;
  }

  async searchDetailed(query: string, topN: number): Promise<EngraphSearchResult> {
    const hits = await this.search(query, topN);
    return this.lastResult ?? { hits, status: hits.length > 0 ? 'ok' : 'no_hits' };
  }

  lastSearchResult(): EngraphSearchResult | null {
    return this.lastResult;
  }

  private async runSearch(query: string, topN: number): Promise<EngraphSearchResult> {
    if (!query.trim()) return { hits: [], status: 'no_hits' };
    let url: URL;
    try {
      url = new URL('/api/search', this.baseUrl);
      if (url.protocol !== 'http:' || !['127.0.0.1', '::1'].includes(url.hostname)) {
        return { hits: [], status: 'backend_unavailable' };
      }
    } catch {
      return { hits: [], status: 'backend_unavailable' };
    }

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {}),
        },
        body: JSON.stringify({ query, top_n: topN }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return { hits: [], status: 'http_error' };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { hits: [], status: 'malformed' };
      }
      if (
        !Array.isArray(body)
        && !(body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results))
      ) {
        return { hits: [], status: 'malformed' };
      }
      const results = Array.isArray(body)
        ? body
        : (body as { results: unknown[] }).results;
      const hits = results.flatMap((result) => {
        if (!result || typeof result !== 'object') return [];
        const raw = result as {
          file_path?: unknown;
          score?: unknown;
          confidence?: unknown;
          similarity?: unknown;
          distance?: unknown;
        };
        const file = raw.file_path;
        if (typeof file !== 'string' || file.length === 0) return [];
        const finite = (value: unknown): number | null =>
          typeof value === 'number' && Number.isFinite(value) ? value : null;
        const explicitConfidence = finite(raw.confidence) ?? finite(raw.similarity);
        return [{
          file,
          score: finite(raw.score),
          confidence: explicitConfidence !== null
            && explicitConfidence >= 0
            && explicitConfidence <= 1
            ? explicitConfidence
            : null,
          distance: finite(raw.distance),
        }];
      });
      return { hits, status: hits.length > 0 ? 'ok' : 'no_hits' };
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      return {
        hits: [],
        status: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'http_error',
      };
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
