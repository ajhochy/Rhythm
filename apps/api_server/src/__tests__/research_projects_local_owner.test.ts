import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The Electron desktop calls its loopback API without a token. Research Projects resolve the
// owner the same way tokenless local session creation does: the sole user in the pairing history.

async function start(pairedUserIds: number[]) {
  vi.resetModules();
  vi.stubEnv('AGENT_LOCAL', 'true');
  vi.stubEnv('RHYTHM_RESEARCH_PROJECTS_ENABLED', 'true');
  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  const { UsersRepository } = await import('../repositories/users_repository');
  const users = pairedUserIds.map(() => new UsersRepository().create({ name: 'Owner', email: `o-${randomUUID()}@example.com` }));
  const { initializeMobilePairingSchema } = await import('../repositories/mobile_devices_repository');
  initializeMobilePairingSchema(db);
  const insert = db.prepare(
    `INSERT INTO mobile_devices (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
     VALUES (?, 'host', ?, 'phone', 'v', NULL, ?)`,
  );
  users.forEach((user) => insert.run(randomUUID(), user.id, new Date().toISOString()));
  const express = (await import('express')).default;
  const router = (await import('../routes/agentResearchRoutes')).default;
  const { errorHandler } = await import('../middleware/error_handler');
  const app = express();
  app.use(express.json());
  app.use('/agent-research', router);
  app.use(errorHandler);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}/agent-research/projects` };
}

afterEach(() => vi.unstubAllEnvs());

describe('research projects on the tokenless local desktop', () => {
  it.each([
    [[1], 200],
    [[], 401],
    [[1, 2], 401],
  ])('paired users %j -> HTTP %i', async (paired, status) => {
    const { server, url } = await start(paired);
    try {
      expect((await fetch(url)).status).toBe(status);
    } finally {
      server.close();
    }
  });
});
