/**
 * OCU-09 (#1050) — /opencode/commands Playbooks CRUD contract tests.
 *
 * Mirrors opencode_skills_routes.test.ts: verifies POST→GET round-trip, the
 * managed flag on list, collision with a built-in → 409, PUT preserves unknown
 * frontmatter, DELETE refuses a non-managed command with 400, and every
 * mutation triggers a config reload.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

// Redirect the managed commands dir to a throwaway tmp dir BEFORE the app is
// imported so writes never touch the real ~/.config/opencode tree.
const MANAGED_DIR = mkdtempSync(join(tmpdir(), 'rhythm-managed-commands-'));
process.env.RHYTHM_MANAGED_COMMANDS_DIR = MANAGED_DIR;

const reloadConfig = vi.fn().mockResolvedValue(true);
// Engine command list: built-ins (init/review) + any managed files discovered.
// Default: just the built-ins so a fresh managed create never collides.
const listCommands = vi.fn().mockResolvedValue([
  { name: 'init', description: 'Initialize', source: 'command' },
  { name: 'review', description: 'Review', source: 'command' },
]);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listCommands: (...args: unknown[]) => listCommands(...args),
    reloadConfig: (...args: unknown[]) => reloadConfig(...args),
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('/opencode/commands (OCU-09 #1050)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    const { createApp } = await import('../app');
    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    close = started.close;
  });

  afterEach(async () => {
    await close();
    vi.clearAllMocks();
    // Reset the default engine list between tests.
    listCommands.mockResolvedValue([
      { name: 'init', description: 'Initialize', source: 'command' },
      { name: 'review', description: 'Review', source: 'command' },
    ]);
  });

  it('POST then GET round-trips a command and reloads config', async () => {
    const postRes = await fetch(`${baseUrl}/opencode/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'deploy-notes',
        description: 'Draft deploy notes',
        template: 'Summarize the changes: $ARGUMENTS',
      }),
    });
    expect(postRes.status).toBe(200);
    expect(reloadConfig).toHaveBeenCalledTimes(1);

    const getRes = await fetch(`${baseUrl}/opencode/commands/deploy-notes/content`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { name: string; template: string; frontmatter: Record<string, unknown> };
    expect(body.name).toBe('deploy-notes');
    expect(body.template).toContain('$ARGUMENTS');
    expect(body.frontmatter.description).toBe('Draft deploy notes');
  });

  it('GET / flags managed commands and leaves built-ins unmanaged', async () => {
    await fetch(`${baseUrl}/opencode/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'my-cmd', template: 'do $1' }),
    });
    // Engine now reports the managed file too.
    listCommands.mockResolvedValue([
      { name: 'init', source: 'command' },
      { name: 'my-cmd', source: 'command' },
    ]);
    const res = await fetch(`${baseUrl}/opencode/commands`);
    const list = (await res.json()) as Array<{ name: string; managed: boolean }>;
    expect(list.find((c) => c.name === 'my-cmd')!.managed).toBe(true);
    expect(list.find((c) => c.name === 'init')!.managed).toBe(false);
  });

  it('POST collision with a built-in name → 409', async () => {
    const res = await fetch(`${baseUrl}/opencode/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review', template: 'x' }),
    });
    expect(res.status).toBe(409);
    expect(reloadConfig).not.toHaveBeenCalled();
  });

  it('rejects a non-kebab-case name with 400', async () => {
    const res = await fetch(`${baseUrl}/opencode/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad_Name', template: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT preserves unknown frontmatter keys', async () => {
    // Seed a managed file that carries an unmodeled frontmatter key.
    const { writeManagedCommand, readManagedCommand } = await import(
      '../services/rhythm_managed_commands'
    );
    writeManagedCommand(
      { name: 'keeper', description: 'v1', template: 'body v1' },
      { customKey: 'preserve-me' },
    );
    listCommands.mockResolvedValue([{ name: 'keeper', source: 'command' }]);

    const res = await fetch(`${baseUrl}/opencode/commands/keeper`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'v2', template: 'body v2' }),
    });
    expect(res.status).toBe(200);
    expect(reloadConfig).toHaveBeenCalledTimes(1);

    const entry = readManagedCommand('keeper')!;
    expect(entry.frontmatter.description).toBe('v2');
    expect(entry.frontmatter.customKey).toBe('preserve-me');
    expect(entry.template).toBe('body v2');
  });

  it('DELETE refuses a non-managed command with 400', async () => {
    const res = await fetch(`${baseUrl}/opencode/commands/review`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(reloadConfig).not.toHaveBeenCalled();
  });

  it('DELETE removes a managed command and reloads', async () => {
    await fetch(`${baseUrl}/opencode/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'temp-cmd', template: 'x' }),
    });
    reloadConfig.mockClear();
    const res = await fetch(`${baseUrl}/opencode/commands/temp-cmd`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
  });
});
