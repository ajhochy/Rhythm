import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';

vi.mock('../config/web_host', () => ({
  webHostConfig: {
    hosts: ['rhythm-web.example.ts.net'],
    origins: ['https://rhythm-web.example.ts.net'],
    ownerUserId: 1,
    distDir: '',
  },
}));

import { env } from '../config/env';
import { createApp } from '../app';
import { startTestServer } from '../__tests__/helpers/real_server';
import { isAllowedLocalAgentSurfaceRequest } from './local_agent_surface_guard';
import { initializeWebHost } from '../services/web_host';
import { webHostConfig } from '../config/web_host';

const original = { agentLocal: env.agentLocal, agentOriginGuardEnabled: env.agentOriginGuardEnabled, localRendererOrigins: env.localRendererOrigins };
describe('F1/F2 additive web-host contract (real guard and HTTP CORS)', () => {
  let root: string;
  let db: Database.Database;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-host-contract-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    webHostConfig!.distDir = root;
    db = new Database(':memory:');
    db.exec("CREATE TABLE users (id INTEGER, name TEXT, email TEXT); INSERT INTO users VALUES (1, 'Synthetic Admin', 'synthetic@example.invalid')");
    setDb(db);
    await initializeWebHost();
  });
  afterAll(() => { db.close(); fs.rmSync(root, { recursive: true }); });
  beforeEach(() => {
    env.agentLocal = true;
    env.agentOriginGuardEnabled = true;
    env.localRendererOrigins = ['rhythm://app'];
  });
  afterEach(() => Object.assign(env, original));

  const cases: [string, IncomingHttpHeaders, boolean][] = [
    ['loopback MCP without Origin', { host: '127.0.0.1:4098' }, true],
    ['loopback Electron', { host: '127.0.0.1:4098', origin: 'rhythm://app' }, true],
    ['web same-origin', { host: 'rhythm-web.example.ts.net', origin: 'https://rhythm-web.example.ts.net' }, true],
    ['web originless same-origin', { host: 'rhythm-web.example.ts.net', 'sec-fetch-site': 'same-origin' }, true],
    ['foreign Origin', { host: 'rhythm-web.example.ts.net', origin: 'https://evil.example' }, false],
    ['foreign Host', { host: 'evil.example', origin: 'https://rhythm-web.example.ts.net' }, false],
    ['cross-site metadata', { host: 'rhythm-web.example.ts.net', origin: 'https://rhythm-web.example.ts.net', 'sec-fetch-site': 'cross-site' }, false],
    ['loopback Origin on web Host', { host: 'rhythm-web.example.ts.net', origin: 'http://127.0.0.1:4098' }, false],
  ];
  it.each(cases)('F1 shared HTTP/WS guard: %s', (_name, headers, expected) => {
    expect(isAllowedLocalAgentSurfaceRequest(headers)).toBe(expected);
  });

  it('F2 preserves Electron CORS alongside web CORS', async () => {
    const server = await startTestServer(createApp());
    try {
      for (const [host, origin] of [
        [new URL(server.baseUrl).host, 'rhythm://app'],
        ['rhythm-web.example.ts.net', 'https://rhythm-web.example.ts.net'],
      ]) {
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request(`${server.baseUrl}/agent-sessions`, {
            method: 'OPTIONS',
            headers: { Host: host, Origin: origin, 'Access-Control-Request-Method': 'GET' },
          }, res => { res.resume(); resolve(res); });
          req.on('error', reject);
          req.end();
        });
        expect(response.statusCode).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
      }
    } finally { await server.close(); }
  });
});
