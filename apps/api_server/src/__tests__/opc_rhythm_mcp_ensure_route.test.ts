import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';
import express from 'express';
import { opencodeMcpRouter } from '../routes/opencode_mcp_routes';
import { AppError } from '../errors/app_error';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/opencode/mcp', opencodeMcpRouter);
  // Minimal error handler mirroring the app's AppError -> status mapping.
  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      const status = err instanceof AppError ? err.statusCode : (err.status ?? 500);
      res.status(status).json({ error: err.message });
    },
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /opencode/mcp/rhythm/ensure', () => {
  it('400s when apiToken is missing', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiUrl: 'https://api.vcrcapps.com' }),
    });
    expect(res.status).toBe(400);
  });
});
