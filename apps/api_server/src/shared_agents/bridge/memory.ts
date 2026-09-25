import type {
  Request,
  RequestHandler,
  Response,
  Router,
} from 'express';

import type { BridgeErrorResponse } from '../bridge_schema';
import {
  computeMemoryVaultId,
  MemorySearchService,
  MemoryVaultChangedError,
  type MemorySearchResponseV1,
} from '../memory_search_service';
import {
  BRIDGE_RATE_LIMITS,
  bridgeGrant,
  grantRateLimit,
  registrar,
  runtime,
  sendBridgeError,
} from './common';
import type { BridgeDeps } from './common';

interface MemorySearchRequest extends Record<string, unknown> {
  query?: unknown;
  limit?: unknown;
}

const memorySearchService = new MemorySearchService();
const memorySearchRateLimit = grantRateLimit(
  'memory.search',
  BRIDGE_RATE_LIMITS.memorySearchPerMinute,
);

function validMemorySearchBody(
  body: unknown,
): body is { query: string; limit?: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const record = body as MemorySearchRequest;
  if (Object.keys(record).some((key) => key !== 'query' && key !== 'limit')) {
    return false;
  }
  if (
    typeof record.query !== 'string'
    || record.query.length < 1
    || record.query.length > 256
  ) {
    return false;
  }
  return record.limit === undefined
    || (Number.isInteger(record.limit) && Number(record.limit) >= 1 && Number(record.limit) <= 10);
}

async function memoryVaultHandler(
  _req: Request,
  res: Response<{ memoryVaultId: string | null }>,
): Promise<void> {
  res.json({ memoryVaultId: await computeMemoryVaultId() });
}

async function memorySearchHandler(
  req: Request<Record<string, never>, MemorySearchResponseV1 | BridgeErrorResponse, MemorySearchRequest>,
  res: Response<MemorySearchResponseV1 | BridgeErrorResponse>,
): Promise<void> {
  if (!validMemorySearchBody(req.body)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }

  try {
    res.json(await memorySearchService.search(
      bridgeGrant(res),
      req.body.query,
      req.body.limit ?? 5,
    ));
  } catch (error) {
    if (error instanceof MemoryVaultChangedError) {
      sendBridgeError(res, 403, 'memory_vault_changed');
      return;
    }
    throw error;
  }
}

function createMemorySearchHandler(): RequestHandler<
  Record<string, never>,
  MemorySearchResponseV1 | BridgeErrorResponse,
  MemorySearchRequest
> {
  return function handleMemorySearch(req, res) {
    return memorySearchHandler(req, res);
  };
}

export function register(router: Router, _deps: BridgeDeps): void {
  router.get('/registrar/memory-vault', registrar, memoryVaultHandler);
  router.post(
    '/memory/search',
    runtime('memory.search'),
    memorySearchRateLimit,
    createMemorySearchHandler(),
  );
}
