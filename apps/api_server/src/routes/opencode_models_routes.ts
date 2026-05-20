/**
 * Issue #609 — GET /opencode/models?provider=openrouter
 *
 * Server-side proxy for the OpenRouter public model catalog.
 * Fetches https://openrouter.ai/api/v1/models, caches results in memory
 * for 1 hour, and returns trimmed rows suitable for the curation UI.
 *
 * Response shape per row:
 *   { id: string; name: string; context_length: number | null; pricing: { prompt: string; completion: string } | null }
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';

export const opencodeModelsRouter = Router();

if (!env.agentLocal) opencodeModelsRouter.use(requireAuth);

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string } | null;
}

interface CachedCatalog {
  fetchedAt: number;
  models: OpenRouterModel[];
}

let _cache: CachedCatalog | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.models;
  }

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter catalog fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: unknown[] };
  const raw = Array.isArray(json.data) ? json.data : [];

  const models: OpenRouterModel[] = raw.map((m) => {
    const item = m as Record<string, unknown>;
    return {
      id: String(item.id ?? ''),
      name: String(item.name ?? item.id ?? ''),
      context_length: typeof item.context_length === 'number' ? item.context_length : null,
      pricing: item.pricing && typeof item.pricing === 'object'
        ? {
            prompt: String((item.pricing as Record<string, unknown>).prompt ?? ''),
            completion: String((item.pricing as Record<string, unknown>).completion ?? ''),
          }
        : null,
    };
  }).filter((m) => m.id.length > 0);

  _cache = { fetchedAt: now, models };
  return models;
}

opencodeModelsRouter.get('/', async (req: Request, res: Response) => {
  const provider = (req.query.provider as string | undefined)?.trim();
  // Only openrouter is supported for now; other providers stay out of scope.
  if (provider !== 'openrouter') {
    res.json([]);
    return;
  }
  try {
    const models = await fetchOpenRouterModels();
    res.json(models);
  } catch (err) {
    console.error('[opencode/models] catalog fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch OpenRouter model catalog', detail: String(err) });
  }
});
