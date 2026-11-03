import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../../../..');
const requireApi = createRequire(path.join(root, 'apps/api_server/package.json'));
type Db = {
  prepare(sql: string): { all(...args: unknown[]): any[]; get(...args: unknown[]): any; run(...args: unknown[]): { changes: number } };
  pragma(sql: string): unknown; transaction<T>(fn: () => T): () => T; close(): void;
};
const Database = requireApi('better-sqlite3') as new (file: string, options: { readonly?: boolean; fileMustExist: true }) => Db;
export type WebApprovalCard = {
  id: string; sessionId: string; action: string; preview: string | null; consequence: string | null;
  status: 'pending'; createdAt: string; expiresAt: string | null;
  revision: string; cardHash: string; decisionMode: 'trusted-tailnet-web';
};
export type OwnedApproval = { id: string; sessionId: string; action: string; nonce: string };
type HttpResult = { status: number; body: any };
export type EngineMessage = { info: { id: string; sessionID: string; role: string; time?: { completed?: number } }; parts: { type: string; text?: string }[] };

function owned(file: string, directory = false): string {
  const resolved = fs.realpathSync(file);
  const stat = fs.lstatSync(file);
  assert.equal(resolved, file, 'Synthetic sandbox paths must be canonical and not symlinks');
  assert.equal(stat.uid, process.getuid?.(), 'Synthetic sandbox must belong to this OS user');
  assert(directory ? stat.isDirectory() : stat.isFile());
  return resolved;
}

async function request(port: number, route: string, headers: Record<string, string>, method = 'GET', body?: unknown): Promise<HttpResult> {
  assert(route.startsWith('/') && !route.startsWith('//'));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let body: unknown = text;
        try { body = text ? JSON.parse(text) : null; } catch { /* Preserve non-JSON failures. */ }
        resolve({ status: response.statusCode!, body });
      });
    });
    req.setTimeout(20_000, () => req.destroy(new Error('Synthetic sandbox request timed out')));
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** Only the canonical synthetic run-sandbox.sh fixture is accepted. No live-account fallback. */
export class OwnedWebApprovals {
  readonly prefix = `[smoke] web approvals ${randomUUID()}`;
  readonly sandbox: string;
  readonly dbPath: string;
  readonly cwd: string;
  readonly origin: string;
  readonly apiPort: number;
  readonly enginePort: number;

  constructor() {
    assert.equal(process.env.RHYTHM_LIVE_E2E, '1', 'Explicit RHYTHM_LIVE_E2E=1 is required');
    assert(process.env.RHYTHM_SANDBOX_DIR, 'Use the canonical web-host run-sandbox.sh launcher');
    this.sandbox = owned(process.env.RHYTHM_SANDBOX_DIR, true);
    assert(/^\/private\/tmp\/.+/.test(this.sandbox), 'Only a disposable /private/tmp sandbox is allowed');
    assert.equal(fs.statSync(this.sandbox).mode & 0o777, 0o700);
    this.dbPath = owned(path.join(this.sandbox, 'rhythm.db'));
    this.origin = process.env.RHYTHM_WEB_PUBLIC_ORIGIN ?? 'http://rhythm-web.test:4098';
    const origin = new URL(this.origin);
    assert.equal(origin.protocol, 'http:');
    assert.equal(origin.origin, this.origin);
    assert.equal(origin.hostname, 'rhythm-web.test', 'Never address an actual tailnet host from this synthetic suite');
    this.apiPort = Number(process.env.RHYTHM_SANDBOX_API_PORT ?? 4098);
    this.enginePort = Number(process.env.RHYTHM_SANDBOX_ENGINE_PORT ?? 4097);
    const gatewayPort = Number(process.env.RHYTHM_SANDBOX_GATEWAY_PORT ?? 4099);
    assert.equal(Number(origin.port), this.apiPort);
    for (const port of [this.apiPort, this.enginePort, gatewayPort]) {
      assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && ![4001, 4002, 4096, 6996].includes(port));
    }
    assert.equal(new Set([this.apiPort, this.enginePort, gatewayPort]).size, 3);
    const apiPid = fs.readFileSync(owned(path.join(this.sandbox, 'api_server.pid')), 'utf8').trim();
    const enginePid = fs.readFileSync(owned(path.join(this.sandbox, 'opencode_engine.pid')), 'utf8').trim();
    for (const [port, pid] of [[this.apiPort, apiPid], [this.enginePort, enginePid]] as const) {
      assert(/^[1-9][0-9]*$/.test(pid));
      assert.equal(execFileSync('/usr/sbin/lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(), pid);
    }
    // Reuse the production read-only process-envelope guard; never signal or start a process.
    execFileSync(process.execPath, ['-e',
      'require(process.argv[1]).validateSandboxApiOwnership(process.argv[2], Number(process.argv[3]), Number(process.argv[4]))',
      path.join(root, 'apps/api_server/dist/services/sandbox_engine_attachment.js'), this.sandbox, String(this.enginePort), apiPid],
    { env: { PATH: process.env.PATH, PORT: String(this.apiPort), RHYTHM_MOBILE_GATEWAY_PORT: String(gatewayPort) }, stdio: 'pipe' });

    const sourceRoot = owned(process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '', true);
    assert.equal(sourceRoot, `${this.sandbox}-fixtures`);
    const sourceDb = owned(process.env.RHYTHM_LIVE_DB_PATH ?? '');
    assert.equal(sourceDb, path.join(sourceRoot, 'rhythm.db'));
    assert.equal(fs.statSync(sourceDb).mode & 0o222, 0);
    // Source stays preboot; server.ts runs the exact Obsidian scope backfill on the runtime copy.
    // This is an advertise grant only: both configs below must still contain no Obsidian server.
    for (const [file, allowedMcps] of [[sourceDb, '[]'], [this.dbPath, '["obsidian"]']] as const) this.withDb(db => {
      assert.deepEqual(db.prepare('SELECT id,name,email,role FROM users ORDER BY id').all(), [
        { id: 1, name: 'Synthetic Admin', email: 'admin@example.invalid', role: 'admin' },
        { id: 2, name: 'Synthetic Member', email: 'member@example.invalid', role: 'member' },
      ]);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token <> 'e02-synthetic-session-not-a-secret' OR user_id <> 1").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token = 'e02-synthetic-session-not-a-secret' AND user_id = 1").get().n, 1);
      assert.deepEqual(db.prepare("SELECT model_provider,model_id,allowed_mcps_json,allowed_skills_json,core_permissions_json FROM agent_configs WHERE id='local-lean'").get(),
        { model_provider: 'web-scripted', model_id: 's0-local', allowed_mcps_json: allowedMcps, allowed_skills_json: '[]', core_permissions_json: '{"*":"deny"}' });
    }, false, file);
    for (const [file, runtime] of [[path.join(sourceRoot, 'opencode.json'), false],
      [path.join(this.sandbox, 'home/.config/opencode/opencode.json'), true]] as const) {
      const config = JSON.parse(fs.readFileSync(owned(file), 'utf8'));
      assert.deepEqual(Object.keys(config.mcp), ['rhythm'], 'Synthetic config must not connect Obsidian or any additional MCP');
      // ensureGeminiProjectConfig adds only the public project identifier before engine startup.
      // Require its exact credential-free shape; arbitrary providers/options remain forbidden.
      assert.deepEqual(config.provider, {
        'web-scripted': { npm: '@ai-sdk/openai-compatible', name: 'Scripted loopback only',
          options: { baseURL: 'http://127.0.0.1:6996/v1', apiKey: 's0-local-synthetic-key' },
          models: { 's0-local': { name: 'Synthetic local' } } },
        ...(runtime ? { google: { options: { projectId: 'rhythm-491406' } } } : {}),
      });
    }
    this.cwd = path.join(this.sandbox, `approval-fixture-${randomUUID()}`);
    fs.mkdirSync(this.cwd, { mode: 0o700 });
  }

  private withDb<T>(fn: (db: Db) => T, writable = false, file = this.dbPath): T {
    owned(file);
    const db = new Database(file, { readonly: !writable, fileMustExist: true });
    try { db.pragma('foreign_keys = ON'); return fn(db); } finally { db.close(); }
  }

  rows(sql: string, ...args: unknown[]): any[] { return this.withDb(db => db.prepare(sql).all(...args)); }

  call(route: string, method = 'GET', body?: unknown): Promise<HttpResult> {
    return request(this.apiPort, route, { Host: new URL(this.origin).host, Origin: this.origin, 'Content-Type': 'application/json' }, method, body);
  }

  async bootstrap() {
    const result = await this.call('/web/bootstrap');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ mode: 'web', owner: { id: 1, displayName: 'Synthetic Admin' } });
    return result.body;
  }

  async pending(): Promise<WebApprovalCard[]> {
    const result = await this.call('/web/approvals?status=pending');
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    return result.body;
  }

  createInert(): OwnedApproval {
    const sessionId = randomUUID();
    this.withDb(db => db.prepare(`INSERT INTO agent_sessions
      (id,agent_kind,profile_id,mcp_role,status,cwd,name,owner_user_id,sdk_session_id)
      VALUES (?,'build','local-lean','local-lean','closed',?,?,1,NULL)`)
      .run(sessionId, this.cwd, `${this.prefix} inert`), true);
    return this.createApproval(sessionId);
  }

  createApproval(sessionId: string): OwnedApproval {
    const id = randomUUID();
    const action = `${this.prefix} ${id}`;
    const nonce = randomBytes(32).toString('base64url');
    this.withDb(db => {
      const session = db.prepare('SELECT owner_user_id,cwd,name FROM agent_sessions WHERE id=?').get(sessionId);
      assert(session?.owner_user_id === 1 && session.cwd === this.cwd && session.name.startsWith(this.prefix));
      db.prepare(`INSERT INTO agent_approvals
        (id,session_id,agent_config_id,action,preview,consequence,status,decision_nonce,created_at)
        VALUES (?,?,'local-lean',?,?,'No external action is performed.','pending',?,?)`)
        .run(id, sessionId, action, `${action}: harmless synthetic proposal`, nonce, new Date().toISOString());
    }, true);
    return { id, sessionId, action, nonce };
  }

  expire(row: OwnedApproval) {
    const changed = this.withDb(db => db.prepare(`UPDATE agent_approvals SET expires_at=?
      WHERE id=? AND action=? AND session_id=? AND decision_nonce=? AND status='pending' AND expires_at IS NULL`)
      .run(new Date(Date.now() - 2_000).toISOString(), row.id, row.action, row.sessionId, row.nonce).changes, true);
    expect(changed).toBe(1);
  }

  approval(row: OwnedApproval) {
    const rows = this.rows('SELECT * FROM agent_approvals WHERE id=? AND action=? AND session_id=?', row.id, row.action, row.sessionId);
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  async createLiveSession() {
    const result = await this.call('/agent-sessions', 'POST', {
      name: `${this.prefix} continuation`, cwd: this.cwd, profileId: 'local-lean', isolateWorktree: false,
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ id: expect.any(String), ownerUserId: 1, profileId: 'local-lean', sdkSessionId: expect.any(String), cwd: this.cwd });
    return result.body as { id: string; sdkSessionId: string; cwd: string };
  }

  async engineMessages(sessionId: string): Promise<EngineMessage[]> {
    const session = this.rows('SELECT sdk_session_id FROM agent_sessions WHERE id=? AND cwd=? AND owner_user_id=1', sessionId, this.cwd)[0];
    assert(session?.sdk_session_id);
    const result = await request(this.enginePort, `/session/${encodeURIComponent(session.sdk_session_id)}/message?directory=${encodeURIComponent(this.cwd)}&limit=100`, {});
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    return result.body;
  }

  async providerHits(): Promise<number> {
    const result = await request(6996, '/_s0/status', {});
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.hits)).toBe(true);
    return result.body.hits.length;
  }

  async cleanup() {
    // Exact nonce-bearing namespace and owned cwd recover even a lost create acknowledgement.
    const sessions = this.rows('SELECT id,name,sdk_session_id FROM agent_sessions WHERE cwd=? AND owner_user_id=1 AND name LIKE ?', this.cwd, `${this.prefix}%`);
    const approvals = this.rows('SELECT id,action,session_id FROM agent_approvals WHERE action LIKE ?', `${this.prefix}%`);
    for (const row of approvals) assert(sessions.some(session => session.id === row.session_id));
    this.withDb(db => db.transaction(() => {
      for (const row of approvals) assert.equal(db.prepare('DELETE FROM agent_approvals WHERE id=? AND action=? AND session_id=?').run(row.id, row.action, row.session_id).changes, 1);
    })(), true);
    for (const session of sessions) {
      const result = await this.call(`/agent-sessions/${session.id}/hard`, 'DELETE');
      expect(result.status, 'Owned session hard-delete must succeed').toBe(204);
      expect((await this.call(`/agent-sessions/${session.id}`)).status).toBe(404);
      expect(this.rows('SELECT id FROM agent_session_messages WHERE session_id=?', session.id)).toEqual([]);
      if (session.sdk_session_id) {
        const engine = await request(this.enginePort, `/session/${encodeURIComponent(session.sdk_session_id)}?directory=${encodeURIComponent(this.cwd)}`, {});
        expect(engine.status, 'Engine cleanup must be verified independently of best-effort API delete').toBe(404);
      }
    }
    expect(this.rows('SELECT id FROM agent_approvals WHERE action LIKE ?', `${this.prefix}%`)).toEqual([]);
    expect(this.rows('SELECT id FROM agent_sessions WHERE cwd=?', this.cwd)).toEqual([]);
    owned(this.cwd, true);
    fs.rmSync(this.cwd, { recursive: true });
    expect(fs.existsSync(this.cwd)).toBe(false);
  }
}
