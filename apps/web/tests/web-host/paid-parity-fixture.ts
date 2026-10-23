import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page, Response as BrowserResponse } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { validatePaidReceipt } from '../../../../tools/testing/web_paid_custody.mjs';
import { responseFor, reloadJsonFor as reloadFromOrigin } from './parity-fixture';

export { expect, responseFor };
export type Row = Record<string, any> & { id: string; name?: string; title?: string };
const checkoutRoot = path.resolve(import.meta.dirname, '../../../..');
const requireApi = createRequire(path.join(checkoutRoot, 'apps/api_server/package.json'));
export const expectedRevision = process.env.RHYTHM_FEATURE_EXPECTED_REVISION ?? '';
export const API = process.env.RHYTHM_WEB_PUBLIC_ORIGIN ?? '';
export const ENGINE = process.env.RHYTHM_SANDBOX_ENGINE_PORT ? `http://127.0.0.1:${process.env.RHYTHM_SANDBOX_ENGINE_PORT}` : '';
let receiptCache: { path: string; sha256: string; receipt: ReturnType<typeof validatePaidReceipt> } | undefined;

function canonicalDirectory(directory: string, privateMode = false) {
  assert(path.isAbsolute(directory) && path.resolve(directory) === directory);
  const stat = fs.lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.());
  assert.equal(fs.realpathSync(directory), directory);
  assert.equal(stat.mode & (privateMode ? 0o777 : 0o022), privateMode ? 0o700 : 0);
  return directory;
}
export function fixtureRoot() {
  const root = process.env.RHYTHM_SANDBOX_DIR ?? '';
  assert(root.startsWith('/private/tmp/'), 'UNVERIFIED: canonical disposable paid sandbox required');
  return canonicalDirectory(root, true);
}

/** This validator reads only the runner's fixture projections through existing authority code.
 * No token, private signer or credential value is returned to a browser or printed by this helper. */
export function paidFixture(refreshReceipt = false) {
  assert.equal(process.env.RHYTHM_WEB_PAID_TEST, '1', 'UNVERIFIED: RHYTHM_WEB_PAID_TEST=1 required');
  assert.equal(process.env.RHYTHM_FEATURE_MODEL, '1', 'UNVERIFIED: RHYTHM_FEATURE_MODEL=1 required');
  assert.equal(process.env.RHYTHM_LIVE_E2E, '1');
  assert.match(expectedRevision, /^[a-f0-9]{40}$/);
  assert.equal(process.env.RHYTHM_EXPECTED_REVISION, expectedRevision);
  const root = fixtureRoot();
  const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
  assert.equal(manifestPath, path.join(root, 'manifest.json'));
  const receiptPath = process.env.RHYTHM_WEB_PAID_CUSTODY_RECEIPT;
  assert.equal(receiptPath, path.join(root, 'web-paid-custody.json'));
  const receiptStat = fs.lstatSync(receiptPath!);
  assert(receiptStat.isFile() && !receiptStat.isSymbolicLink() && receiptStat.uid === process.getuid?.()
    && receiptStat.nlink === 1 && (receiptStat.mode & 0o777) === 0o600 && fs.realpathSync(receiptPath!) === receiptPath);
  const receiptHash = createHash('sha256').update(fs.readFileSync(receiptPath!)).digest('hex');
  if (receiptCache) {
    assert.equal(receiptCache.path, receiptPath, 'Paid custody receipt path changed during this worker');
    assert.equal(receiptCache.sha256, receiptHash, 'Paid custody receipt changed during this worker');
  }
  if (refreshReceipt || !receiptCache) {
    const receipt = validatePaidReceipt(receiptPath!, { checkoutRoot, expectedRevision, now: Date.now() });
    receiptCache = { path: receiptPath!, sha256: receiptHash, receipt };
  }
  assert.equal(receiptCache.sha256, receiptHash, 'Paid custody receipt changed during the test');
  const receipt = receiptCache.receipt;
  const { manifest } = readQualificationFixture(manifestPath!, expectedRevision);
  assert.equal(manifest.fixtureRoot, root);
  assert.equal(manifest.dbPath, path.join(root, 'rhythm.db'));
  assert(manifest.syntheticActor?.modelLoan, 'UNVERIFIED: existing validated model loan required');
  const loan = manifest.syntheticActor.modelLoan;
  assert.equal(receipt.fixtureRoot, root);
  assert.equal(receipt.manifestPath, manifestPath);
  for (const key of ['issuedAt', 'stopAt', 'expires'] as const) assert.equal(receipt[key], loan[key]);
  const origin = new URL(API);
  assert.equal(origin.origin, API); assert.equal(origin.protocol, 'http:');
  assert.equal(origin.hostname, 'rhythm-web.test');
  const ports = ['RHYTHM_SANDBOX_API_PORT', 'RHYTHM_SANDBOX_ENGINE_PORT', 'RHYTHM_SANDBOX_GATEWAY_PORT'].map(key => Number(process.env[key]));
  assert.equal(Number(origin.port), ports[0]);
  assert.equal(new Set(ports).size, 3);
  for (const port of ports) assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && ![4001, 4002, 4096, 6996, 7097].includes(port));
  assert.equal(ENGINE, `http://127.0.0.1:${ports[1]}`);
  return { manifest, receipt, loan };
}

/** All read-only SQL is pinned to the one qualified synthetic database. */
export function localRows(sql: string, ...args: unknown[]): Row[] {
  const { manifest } = paidFixture();
  const Database = requireApi('better-sqlite3');
  const db = new Database(manifest.dbPath, { readonly: true, fileMustExist: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}

export class ObservedApi {
  constructor(readonly origin = API) { assert.equal(origin, API); }
  static from(response: BrowserResponse) {
    assert.equal(new URL(response.url()).origin, API);
    const headers = response.request().headers();
    assert.equal(headers.authorization, undefined); assert.equal(headers['x-rhythm-human-approval'], undefined);
    return new ObservedApi();
  }
  async fetch(route: string, init: RequestInit = {}): Promise<Response> {
    paidFixture();
    assert(route.startsWith('/') && !route.startsWith('//'));
    assert(init.body === undefined || init.body === null || typeof init.body === 'string');
    if (init.body) JSON.parse(String(init.body));
    const headers = new Headers(init.headers);
    for (const key of ['authorization', 'x-rhythm-human-approval', 'host', 'origin', 'cookie']) assert(!headers.has(key));
    const method = init.method ?? 'GET';
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: Number(new URL(API).port), path: route, method,
        headers: { ...Object.fromEntries(headers.entries()), Host: new URL(API).host, Origin: API,
          'Content-Type': headers.get('content-type') ?? 'application/json' } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('error', reject);
        response.on('end', () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, item);
          resolve(new Response(method === 'HEAD' || [204, 205, 304].includes(response.statusCode!) ? null : new Uint8Array(Buffer.concat(chunks)),
            { status: response.statusCode!, headers: responseHeaders }));
        });
      });
      req.setTimeout(20_000, () => req.destroy(new Error('Qualified owned API request timed out')));
      req.on('error', reject); req.end(init.body ?? undefined);
    });
  }
  async json<T>(route: string): Promise<T> {
    const response = await this.fetch(route); expect(response.status, `GET ${route}`).toBe(200);
    return await response.json() as T;
  }
}

export async function validatePaidOwner(api = new ObservedApi()) {
  const { manifest } = paidFixture();
  const seed = manifest.publicUserSeed;
  expect(localRows('SELECT id,name,email,google_sub,timezone FROM users ORDER BY id')).toEqual([
    { id: seed.id, name: seed.name, email: seed.email, google_sub: seed.googleSub, timezone: seed.timezone },
  ]);
  const bootstrap = await api.json<{ mode: string; owner: { id: number; displayName: string }; capabilities: Record<string, boolean> }>('/web/bootstrap');
  expect(bootstrap).toMatchObject({ mode: 'web', owner: { id: manifest.ownerUserId, displayName: seed.name }, capabilities: { localAgents: true, cloud: false } });
  return manifest.ownerUserId as number;
}

export function ownedWorkspace(directory: string) {
  const parent = fixtureRoot();
  assert(directory.startsWith(parent + path.sep), 'Workspace must remain inside the exact paid sandbox');
  return canonicalDirectory(directory);
}
export async function privateWorkspace(prefix: string) {
  paidFixture(); assert(prefix.startsWith('[smoke] '));
  const directory = await mkdtemp(path.join(fixtureRoot(), 'web-paid-workspace-'));
  fs.chmodSync(directory, 0o700);
  ownedWorkspace(directory);
  return directory;
}
export async function assertResponse(response: BrowserResponse, method: string, pathname: string, status: number) {
  expect(response.request().method()).toBe(method); expect(new URL(response.url()).pathname).toBe(pathname);
  expect(response.status(), `${method} ${pathname}`).toBe(status); ObservedApi.from(response);
}
export const reloadJsonFor = <T>(page: Page, pathname: string) => reloadFromOrigin<T>(page, pathname, API);
export async function selectSessionProfile(page: Page) {
  await page.getByTestId('advanced-profile').selectOption('coding-agent', { timeout: 10_000 });
  await expect(page.getByTestId('advanced-profile')).toHaveValue('coding-agent');
}

/** Packaged-compatible nonce ledger with stricter sandbox, actor, cwd and engine cleanup. */
export class OwnedRecords {
  readonly prefix: string;
  readonly api = new ObservedApi();
  directory?: string;
  private ids = new Set<string>();
  private cwdById = new Map<string, string>();
  private pending = new Set<Promise<void>>();
  private listener: (response: BrowserResponse) => void;
  constructor(readonly page: Page, readonly kind: 'sessions' | 'tasks' = 'sessions', feature: string = kind) {
    this.prefix = `[smoke] ${feature} ${randomUUID()}`;
    this.listener = response => {
      if (new URL(response.url()).origin !== API || new URL(response.url()).pathname !== this.collection
        || response.request().method() !== 'POST' || !response.ok()) return;
      const input = response.request().postDataJSON();
      if (!this.owns(input?.title ?? input?.name)) return;
      const pending = response.json().then(row => { if (row.id) this.remember(row); }).catch(() => {});
      this.pending.add(pending); void pending.finally(() => this.pending.delete(pending));
    };
    page.on('response', this.listener);
  }
  get collection() { return this.kind === 'sessions' ? '/agent-sessions' : '/tasks'; }
  owns(name: unknown) { return typeof name === 'string' && (name === this.prefix || name.startsWith(this.prefix + ' ')); }
  remember(row: Row) {
    const owner = paidFixture().manifest.ownerUserId;
    expect(this.owns(row.title ?? row.name), 'Refuse foreign record adoption').toBe(true);
    expect(this.kind === 'tasks' ? row.ownerId : row.ownerUserId).toBe(owner);
    if (this.kind === 'sessions') { ownedWorkspace(String(row.cwd)); this.cwdById.set(row.id, String(row.cwd)); }
    this.ids.add(row.id);
  }
  async list(): Promise<Row[]> {
    if (this.kind === 'tasks') return this.api.json<Row[]>('/tasks?status=all');
    return (await this.api.json<{ sessions: Row[] }>(`/agent-sessions?scope=chats&includeArchived=true&limit=100&search=${encodeURIComponent(this.prefix)}`)).sessions;
  }
  async read(id: string): Promise<Row> {
    const body = await this.api.json<Row>(`${this.collection}/${encodeURIComponent(id)}`);
    return this.kind === 'sessions' ? body.session : body;
  }
  async open() {
    await this.page.goto(`/#/${this.kind === 'sessions' ? 'agents' : 'tasks'}`);
    const { response } = await reloadJsonFor(this.page, this.collection);
    await assertResponse(response, 'GET', this.collection, 200);
    return response;
  }
  async prepare(suffix = '') {
    if (this.kind === 'tasks') {
      const empty = this.page.getByTestId('tasks-empty-create');
      await (await empty.isVisible() ? empty : this.page.getByTestId('tasks-header-add-task')).click();
      await this.page.getByTestId('task-create-title').fill(this.prefix + suffix); return;
    }
    this.directory ??= await privateWorkspace(this.prefix); ownedWorkspace(this.directory);
    await this.page.getByTestId('new-session-advanced').click(); await selectSessionProfile(this.page);
    await this.page.getByTestId('advanced-name').fill(this.prefix + suffix);
    await this.page.getByTestId('advanced-cwd').fill(''); await this.page.getByTestId('advanced-cwd').fill(this.directory);
    await this.page.getByTestId('advanced-isolate-worktree').uncheck();
    await expect(this.page.getByTestId('advanced-branch')).toHaveValue('');
  }
  async create(suffix = ''): Promise<Row> {
    await this.prepare(suffix);
    const submit = this.page.getByTestId(this.kind === 'tasks' ? 'task-create-submit' : 'advanced-create');
    await expect(submit).toBeEnabled(); const pending = responseFor(this.page, 'POST', this.collection); await submit.click();
    const response = await pending; const row = await response.json() as Row;
    if (row.id && this.owns(row.title ?? row.name)) this.remember(row);
    await assertResponse(response, 'POST', this.collection, 201);
    if (this.kind === 'sessions') {
      expect(response.request().postDataJSON()).toMatchObject({ cwd: this.directory, isolateWorktree: false, profileId: 'coding-agent' });
      expect(response.request().postDataJSON().stash).toBeUndefined();
    }
    expect(row).toMatchObject(this.kind === 'tasks' ? { title: this.prefix + suffix } : { name: this.prefix + suffix, cwd: this.directory, profileId: 'coding-agent' });
    return row;
  }
  async cleanup(options: { keepDirectory?: boolean } = {}) {
    this.page.off('response', this.listener); await Promise.all(this.pending);
    for (const row of await this.list()) if (this.owns(row.title ?? row.name)) this.remember(row);
    const errors: unknown[] = [];
    for (const id of this.ids) {
      try {
        const response = await this.api.fetch(`${this.collection}/${encodeURIComponent(id)}`);
        if (response.status === 404) continue;
        expect(response.status).toBe(200); const value = await response.json();
        const row = (this.kind === 'sessions' ? value.session : value) as Row;
        expect(this.owns(row.title ?? row.name)).toBe(true);
        expect(this.kind === 'tasks' ? row.ownerId : row.ownerUserId).toBe(paidFixture().manifest.ownerUserId);
        if (this.kind === 'sessions') { expect(row.cwd).toBe(this.cwdById.get(id)); ownedWorkspace(row.cwd); }
        expect((await this.api.fetch(`${this.collection}/${encodeURIComponent(id)}${this.kind === 'sessions' ? '/hard' : ''}`, { method: 'DELETE' })).status).toBe(204);
        expect((await this.api.fetch(`${this.collection}/${encodeURIComponent(id)}`)).status).toBe(404);
        if (this.kind === 'sessions') {
          expect(localRows('SELECT id FROM agent_sessions WHERE id=?', id)).toEqual([]);
          expect(localRows('SELECT id FROM agent_session_messages WHERE session_id=?', id)).toEqual([]);
          if (row.sdkSessionId) expect((await fetch(`${ENGINE}/session/${encodeURIComponent(row.sdkSessionId)}?directory=${encodeURIComponent(row.cwd)}`, { signal: AbortSignal.timeout(20_000) })).status).toBe(404);
        }
      } catch (error) { errors.push(new Error(`Owned cleanup ${id}: ${String(error)}`, { cause: error })); }
    }
    expect((await this.list()).filter(row => this.owns(row.title ?? row.name))).toEqual([]);
    if (errors.length) throw new AggregateError(errors, 'Paid owned-record cleanup failed');
    if (this.directory && !options.keepDirectory) { ownedWorkspace(this.directory); await rm(this.directory, { recursive: true }); }
  }
}

export const test = base.extend<{ sessions: OwnedRecords; paid: void }>({
  paid: [async ({ page }, use, info) => {
    base.skip(process.env.RHYTHM_WEB_PAID_TEST !== '1' || process.env.RHYTHM_FEATURE_MODEL !== '1',
      'Explicit private paid browser qualification and model opt-in required');
    const { manifest, receipt } = paidFixture(true);
    const id = Number(info.title.match(/#(\d+)\b|\[web-parity-(\d+)\]/)?.slice(1).find(Boolean));
    expect(receipt.caseIds, 'Case must be explicitly authorized by this bounded custody run').toContain(id);
    const root = fixtureRoot();
    for (const [file, port] of [['api_server.pid', Number(new URL(API).port)], ['opencode_engine.pid', Number(new URL(ENGINE).port)]] as const) {
      const pidFile = path.join(root, file); const stat = fs.lstatSync(pidFile);
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && fs.realpathSync(pidFile) === pidFile);
      const pid = fs.readFileSync(pidFile, 'utf8').trim(); assert.match(pid, /^[1-9][0-9]*$/);
      assert.equal(execFileSync('/usr/sbin/lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(), pid);
    }
    execFileSync(process.execPath, ['-e', 'require(process.argv[1]).validateSandboxApiOwnership(process.argv[2], Number(process.argv[3]), Number(process.argv[4]))',
      path.join(checkoutRoot, 'apps/api_server/dist/services/sandbox_engine_attachment.js'), root,
      String(new URL(ENGINE).port), fs.readFileSync(path.join(root, 'api_server.pid'), 'utf8').trim()],
    { env: { PATH: process.env.PATH, PORT: new URL(API).port, RHYTHM_MOBILE_GATEWAY_PORT: process.env.RHYTHM_SANDBOX_GATEWAY_PORT }, stdio: 'pipe' });
    await validatePaidOwner();
    const engine = await fetch(`${ENGINE}/global/health`, { signal: AbortSignal.timeout(20_000) });
    expect(engine.status).toBe(200); expect(await engine.json()).toMatchObject({ healthy: true, version: `0.0.0-rhythm-${expectedRevision}` });
    const errors: string[] = [];
    const pageError = (error: Error) => errors.push(error.message);
    const headers = (request: import('@playwright/test').Request) => {
      if (new URL(request.url()).origin === API && (request.headers().authorization || request.headers()['x-rhythm-human-approval'])) errors.push('Browser attempted a bearer/native-capability request');
    };
    page.on('pageerror', pageError); page.on('request', headers);
    try { await use(); }
    finally {
      page.off('pageerror', pageError); page.off('request', headers);
      try { expect(errors).toEqual([]); }
      finally { expect(manifest.ownerUserId).toBe(paidFixture(true).manifest.ownerUserId); }
    }
  }, { auto: true }],
  sessions: async ({ page, paid }, use) => { void paid; const records = new OwnedRecords(page); try { await use(records); } finally { await records.cleanup(); } },
});
