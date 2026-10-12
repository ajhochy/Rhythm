/** Mounted router boundary only: no Dayflow process, journal, vault, or native writer. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { request as httpRequest, type Server } from 'node:http';

import { env } from '../config/env';
import type { DayflowManagementService } from '../integrations/dayflow/public_contract';
import { localAgentSurfaceGuard } from '../middleware/local_agent_surface_guard';
import { createDayflowIntegrationRouter } from '../routes/dayflow_integration_routes';

let server: Server | undefined;
let previousLocal: boolean;
let previousGuard: boolean;
let previousOrigins: string[];

const service: DayflowManagementService = {
  status: () => { throw new Error('SENTINEL_DO_NOT_SERIALIZE_/private/secret'); },
  readiness: () => ({ state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' }),
  checkReadiness: () => ({ state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' }),
  getConfig: () => ({ enabled: false, automaticImport: false, timezone: null, rolloverHour: 4, exclusions: [], maxRecordsPerRun: 100, source: null }),
  updateConfig: () => ({ enabled: false, automaticImport: false, timezone: null, rolloverHour: 4, exclusions: [], maxRecordsPerRun: 100, source: null }),
  preview: () => { throw new Error('SENTINEL_PREVIEW_STDERR=/private/raw'); },
  commit: () => ({ items: [] }),
  listOwnedNotes: () => ({ items: [], nextCursor: null, total: 0 }),
  forget: (input) => ({ memoryId: input.memoryId, state: 'forgotten' }),
  disable: () => ({ enabled: false, automaticImport: false, readiness: { state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' }, canPreview: false, importedCount: 0, pendingCreateCount: 0, pendingDeleteCount: 0 }),
};

async function mount(): Promise<string> {
  const app = express();
  app.use(localAgentSurfaceGuard);
  app.use('/dayflow-integration', createDayflowIntegrationRouter(service));
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing loopback address');
  return `http://127.0.0.1:${address.port}`;
}

function send(base: string, path: string, body?: string, headers: Record<string, string> = {}, chunked = false) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const request = httpRequest(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    if (body === undefined) { request.end(); return; }
    if (chunked) {
      request.flushHeaders();
      for (let offset = 0; offset < body.length; offset += 997) request.write(body.slice(offset, offset + 997));
      request.end();
      return;
    }
    request.end(body);
  });
}

beforeEach(() => {
  previousLocal = env.agentLocal;
  previousGuard = env.agentOriginGuardEnabled;
  previousOrigins = env.localRendererOrigins;
  env.agentLocal = true;
  env.agentOriginGuardEnabled = true;
  env.localRendererOrigins = ['rhythm://app'];
});

afterEach(async () => {
  env.agentLocal = previousLocal;
  env.agentOriginGuardEnabled = previousGuard;
  env.localRendererOrigins = previousOrigins;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('Dayflow management HTTP boundary', () => {
  it('returns only the static Dayflow envelope for sentinel service failures', async () => {
    const response = await send(await mount(), '/dayflow-integration/status');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR', message: 'Dayflow is unavailable.', retryable: true, recovery: 'retry' } });
    expect(JSON.stringify(response.body)).not.toContain('SENTINEL');
    expect(JSON.stringify(response.body)).not.toContain('/private');
  });

  it('rejects scalar and malformed JSON as INVALID_REQUEST', async () => {
    const base = await mount();
    for (const body of ['"scalar"', '{']) {
      const response = await send(base, '/dayflow-integration/preview', body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    }
  });

  it('rejects a chunked body over the route-scoped 16 KiB bound', async () => {
    const response = await send(await mount(), '/dayflow-integration/preview', `${' '.repeat(16_384)}{"date":"2026-10-02"}`, { 'transfer-encoding': 'chunked' }, true);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('uses the public envelope when the earlier global Host/Origin guard rejects', async () => {
    const response = await send(await mount(), '/dayflow-integration/config', undefined, { host: 'attacker.invalid' });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Dayflow request is forbidden.', retryable: false, recovery: 'none' } });
  });
});
