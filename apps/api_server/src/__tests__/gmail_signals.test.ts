/**
 * C2 — GET /integrations/gmail-signals route tests
 *
 * Criteria covered:
 *   - Returns [] (200) on empty DB (not 500)
 *   - Returns recent signals when records exist
 *   - Returns 401 when unauthenticated
 *
 * Also validates the email-assistant.mcp.json role file parses and scopes
 * only the rhythm server's listed email tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { GmailSignalsRepository } from '../repositories/gmail_signals_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ── email-assistant.mcp.json role-file validation ─────────────────────────

describe('C2 — email-assistant.mcp.json role file', () => {
  it('parses without error and contains required shape', () => {
    const rolePath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '.mcp-roles',
      'email-assistant.mcp.json',
    );
    expect(fs.existsSync(rolePath)).toBe(true);

    const raw = fs.readFileSync(rolePath, 'utf8');
    const role = JSON.parse(raw) as {
      role: string;
      mcpServers: Record<string, { allowedTools?: string[] }>;
      disabledMcpServers: string[];
    };

    expect(role.role).toBe('email-assistant');

    // Must contain exactly the rhythm server (no third-party gmail MCP).
    expect(Object.keys(role.mcpServers)).toContain('rhythm');
    expect(Object.keys(role.mcpServers)).not.toContain('gmail');

    // rhythm server must scope email tools.
    const rhythmTools = role.mcpServers.rhythm?.allowedTools ?? [];
    expect(rhythmTools).toContain('rhythm_search_gmail');
    expect(rhythmTools).toContain('rhythm_read_email');
    expect(rhythmTools).toContain('rhythm_send_email');

    // disabledMcpServers must include the four dangerous server types.
    const disabled = role.disabledMcpServers;
    expect(disabled).toContain('bash');
    expect(disabled).toContain('computer');
    expect(disabled).toContain('editor');
    expect(disabled).toContain('filesystem');
  });
});

// ── /integrations/gmail-signals HTTP route ────────────────────────────────

describe('C2 — GET /integrations/gmail-signals', () => {
  let baseUrl: string;
  let authHeader: Record<string, string>;
  let userId: number;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Signal Test', email: 'signals@example.com' });
    userId = user.id;
    const session = await sessionsRepo.createAsync(user.id);
    authHeader = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns [] (200) on empty DB — not 500', async () => {
    const res = await fetch(`${baseUrl}/integrations/gmail-signals`, {
      headers: authHeader,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  it('returns recent signals when records exist', async () => {
    // Seed a signal directly via the repository.
    const signalsRepo = new GmailSignalsRepository();
    signalsRepo.replaceForOwner(userId, [
      {
        ownerId: userId,
        externalId: 'ext-001',
        threadId: 'thread-001',
        fromName: 'Alice',
        fromEmail: 'alice@example.com',
        subject: 'Hello',
        snippet: 'Hi there',
        receivedAt: new Date().toISOString(),
        isUnread: true,
      },
    ]);

    const res = await fetch(`${baseUrl}/integrations/gmail-signals`, {
      headers: authHeader,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject: string; fromEmail: string }[];
    expect(body.length).toBe(1);
    expect(body[0].subject).toBe('Hello');
    expect(body[0].fromEmail).toBe('alice@example.com');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/integrations/gmail-signals`);
    expect(res.status).toBe(401);
  });
});
