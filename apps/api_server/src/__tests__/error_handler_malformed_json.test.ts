import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorHandler } from '../middleware/error_handler';

let baseUrl: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post('/agent-sessions', (_req, res) => res.status(201).json({ id: 'unused' }));
  app.use(errorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
});

afterAll(async () => {
  await closeServer();
});

describe('general API malformed JSON handling', () => {
  it('returns the standard 400 envelope without leaking a stack trace', async () => {
    const response = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":',
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Malformed JSON request body',
      },
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain('stack');
  });
});
