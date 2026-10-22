import { afterAll, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { startTestServer } from '../__tests__/helpers/real_server';
vi.mock('../config/web_host', () => ({ webHostConfig: { hosts: ['owner.ts.net'], origins: ['https://owner.ts.net', 'http://rhythm-web.test:4098'], ownerUserId: 1, distDir: '' } }));
import { webHostConfig } from '../config/web_host';
import { initializeWebHost, createWebHostRouter } from './web_host';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-csp-contract-'));
const db = new Database(':memory:');
afterAll(() => { db.close(); fs.rmSync(root, { recursive: true }); });
it('A4 served index removes desktop connect sources and preserves every other CSP directive and source bytes', async () => {
  const source = fs.readFileSync(path.resolve('../web/index.html'), 'utf8');
  fs.writeFileSync(path.join(root, 'index.html'), source);
  db.exec("CREATE TABLE users (id INTEGER, name TEXT, email TEXT); INSERT INTO users VALUES (1, 'Synthetic Admin', 'test@example.invalid')");
  setDb(db);
  webHostConfig!.distDir = root;
  await initializeWebHost();
  const app = express(); app.use(createWebHostRouter());
  const server = await startTestServer(app);
  try {
    for (const route of ['/', '/index.html']) {
      const result = await fetch(`${server.baseUrl}${route}`);
      expect(result.status).toBe(200);
      const html = await result.text();
      expect(html.match(/connect-src [^;]+/)?.[0]).toBe("connect-src 'self' https://owner.ts.net wss://owner.ts.net http://rhythm-web.test:4098 ws://rhythm-web.test:4098");
      expect(html.replace(/connect-src [^;]+/, 'connect-src OMITTED')).toBe(source.replace(/connect-src [^;]+/, 'connect-src OMITTED'));
      expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toBe(source);
    }
  } finally { await server.close(); }
});
