import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';

const execFileAsync = promisify(execFile);

describe('issue-1479-c3: MCP tool grant drift operator CLI', () => {
  let dir: string;
  let dbPath: string;
  let engineUrl: string;
  let closeServer: () => Promise<void>;
  const profileId = `drift-cli-${randomUUID()}`;
  const phantom = `phantom_${randomUUID().replaceAll('-', '')}`;
  const secret = `must-not-leak-${randomUUID()}`;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rhythm-drift-cli-'));
    dbPath = join(dir, 'rhythm.db');
    const db = new Database(dbPath);
    runMigrations(db);
    db.prepare(
      `INSERT INTO agent_configs (id, label, icon, command, allowed_mcps_json)
       VALUES (?, ?, '', '', ?)`,
    ).run(
      profileId,
      secret,
      JSON.stringify({ obsidian: ['obsidian_simple_search', phantom] }),
    );
    db.close();

    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/mcp') {
        response.end(JSON.stringify({ obsidian: { status: 'connected' } }));
        return;
      }
      if (request.url === '/mcp/tools') {
        response.end(JSON.stringify(['obsidian_obsidian_simple_search']));
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind TCP');
    engineUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  });

  afterAll(async () => {
    await closeServer?.();
    await rm(dir, { recursive: true, force: true });
  });

  async function sha256(): Promise<string> {
    return createHash('sha256').update(await readFile(dbPath)).digest('hex');
  }

  it('prints only sanitized tool drift and leaves the SQLite bytes unchanged', async () => {
    // Regression caught: the report function existed only behind mocked tests,
    // leaving operators no callable, read-only one-time repair report.
    const before = await sha256();
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/cli/index.ts', 'mcp-tool-grant-drift', '--engine-url', engineUrl],
      {
        cwd: process.cwd(),
        env: { ...process.env, DB_CLIENT: 'sqlite', DB_PATH: dbPath },
      },
    );

    expect(JSON.parse(stdout)).toEqual([
      { profileId, serverName: 'obsidian', toolName: phantom },
    ]);
    expect(`${stdout}${stderr}`).not.toContain(secret);
    expect(`${stdout}${stderr}`).not.toContain(dbPath);
    expect(await sha256()).toBe(before);
  });

  it('returns nonzero on validation failure without emitting a report or mutating', async () => {
    const before = await sha256();
    const failure = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/cli/index.ts', 'mcp-tool-grant-drift', '--engine-url', engineUrl],
      {
        cwd: process.cwd(),
        env: { ...process.env, DB_CLIENT: 'postgres', DB_PATH: dbPath },
      },
    ).then(() => null, (error: { code?: number; stdout?: string; stderr?: string }) => error);

    expect(failure?.code).not.toBe(0);
    expect(failure?.stdout ?? '').toBe('');
    expect(failure?.stderr ?? '').toMatch(/SQLite|DB_CLIENT/i);
    expect(await sha256()).toBe(before);
  });
});
