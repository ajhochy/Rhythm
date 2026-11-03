import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Frame, Page, Request, Response as BrowserResponse } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import { OwnedWebApprovals } from './owned-web-approval-fixture';

export { expect } from '@playwright/test';
export type Row = Record<string, any> & { id: string; name?: string; title?: string };

/** Status/body-preserving tokenless adapter. Callers MUST retain the full /cloud prefix. */
export class ObservedApi {
  constructor(readonly parity: ParitySandbox) {}
  static from(response: BrowserResponse, parity: ParitySandbox) {
    expect(new URL(response.url()).origin).toBe(parity.origin);
    expect(response.request().headers().authorization).toBeUndefined();
    expect(response.request().headers()['x-rhythm-human-approval']).toBeUndefined();
    return new ObservedApi(parity);
  }
  async fetch(route: string, init: RequestInit = {}): Promise<Response> {
    assert(route.startsWith('/') && !route.startsWith('//'));
    assert(init.body === undefined || init.body === null || typeof init.body === 'string', 'JSON request bodies only');
    const headers = new Headers(init.headers);
    for (const key of ['authorization', 'x-rhythm-human-approval', 'host', 'origin']) assert(!headers.has(key));
    if (init.body) JSON.parse(String(init.body)); // The adapter accepts JSON writes, but reads may be binary.
    const method = init.method ?? 'GET';
    return new Promise((resolve, reject) => {
      const outgoing = Object.fromEntries(headers.entries());
      const request = http.request({ hostname: '127.0.0.1', port: this.parity.isolation.apiPort,
        path: route, method, headers: { ...outgoing, Host: new URL(this.parity.origin).host,
          Origin: this.parity.origin, 'Content-Type': headers.get('content-type') ?? 'application/json' } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          const resultHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) resultHeaders.append(key, item);
          }
          const empty = method === 'HEAD' || [204, 205, 304].includes(response.statusCode!);
          resolve(new Response(empty ? null : new Uint8Array(Buffer.concat(chunks)), { status: response.statusCode!, headers: resultHeaders }));
        });
      });
      request.setTimeout(20_000, () => request.destroy(new Error('Owned API request timed out')));
      request.on('error', reject);
      request.end(init.body ?? undefined);
    });
  }
  request(method: string, route: string, body?: unknown) {
    return this.fetch(route, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async json<T>(route: string, init: RequestInit = {}, expectedStatus = 200): Promise<T> {
    const response = await this.fetch(route, init);
    expect(response.status, `${init.method ?? 'GET'} ${route}`).toBe(expectedStatus);
    return await response.json() as T;
  }
}

/** Reuse the frozen, live-qualified sandbox guard without changing its approval contract. */
export class ParitySandbox {
  readonly isolation = new OwnedWebApprovals();
  readonly api = new ObservedApi(this);
  private cleanup: { label: string; run: () => Promise<void> }[] = [];
  get prefix() { return this.isolation.prefix; }
  get cwd() { return this.isolation.cwd; }
  get dbPath() { return this.isolation.dbPath; }
  get sandbox() { return this.isolation.sandbox; }
  get origin() { return this.isolation.origin; }
  get enginePort() { return this.isolation.enginePort; }
  rows(sql: string, ...args: unknown[]): Row[] { return this.isolation.rows(sql, ...args); }
  deferCleanup(label: string, run: () => Promise<void>) { this.cleanup.push({ label, run }); }

  /** Only the validated engine, owned cwd descendants, or the exact synthetic API HOME cache. */
  async engineFetch(route: string, init: RequestInit = {}): Promise<Response> {
    assert(route.startsWith('/') && !route.startsWith('//'));
    const url = new URL(route, `http://127.0.0.1:${this.enginePort}`);
    const directory = url.searchParams.get('directory') ?? this.cwd;
    const apiHome = path.join(this.sandbox, 'home');
    assert(path.isAbsolute(directory) && (directory === this.cwd || directory.startsWith(this.cwd + path.sep) || directory === apiHome),
      'Engine requests require the owned cwd, its child directories, or the exact synthetic sandbox HOME');
    const stat = fs.lstatSync(directory);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.(),
      'Engine directory must be a nonsymlink directory owned by this OS user');
    assert.equal(fs.realpathSync(directory), directory, 'Engine directory must be canonical');
    url.searchParams.set('directory', directory);
    assert(init.body === undefined || init.body === null || typeof init.body === 'string');
    const headers = new Headers(init.headers);
    assert(!headers.has('authorization'));
    return new Promise((resolve, reject) => {
      const request = http.request(url, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json' } }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve(new Response([204, 205, 304].includes(response.statusCode!) ? null : text, {
          status: response.statusCode!, headers: { 'content-type': String(response.headers['content-type'] ?? 'application/json') },
        })));
      });
      request.setTimeout(20_000, () => request.destroy(new Error('Owned engine request timed out')));
      request.on('error', reject);
      request.end(init.body ?? undefined);
    });
  }

  async dispose() {
    const errors: unknown[] = [];
    for (const task of this.cleanup.splice(0).reverse()) {
      try { await task.run(); } catch (error) { errors.push(new Error(`${task.label}: ${String(error)}`, { cause: error })); }
    }
    try { await this.isolation.cleanup(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Owned browser parity cleanup failed');
  }
}

export function responseFor(page: Page, method: string, pathname: string) {
  const pending = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === pathname, { timeout: 20_000 });
  void pending.catch(() => {});
  return pending;
}

export async function assertResponse(response: BrowserResponse, method: string, pathname: string, status: number) {
  expect(response.request().method()).toBe(method);
  expect(new URL(response.url()).pathname).toBe(pathname);
  expect(response.status(), `${method} ${pathname}`).toBe(status);
  expect(response.request().headers().authorization).toBeUndefined();
}

/** Match only a request from the new document; consume its body before another navigation. */
export async function reloadJsonFor<T>(page: Page, pathname: string, origin: string): Promise<{ response: BrowserResponse; body: T }> {
  const requests = new Set<Request>();
  let committed = false;
  const markDocument = (frame: Frame) => { if (frame === page.mainFrame()) committed = true; };
  const capture = (request: Request) => {
    const url = new URL(request.url());
    if (committed && request.method() === 'GET' && url.origin === origin && url.pathname === pathname) requests.add(request);
  };
  page.on('framenavigated', markDocument);
  page.on('request', capture);
  try {
    const pending = page.waitForResponse(response => requests.has(response.request()), { timeout: 20_000 });
    void pending.catch(() => {});
    await page.reload();
    const response = await pending;
    return { response, body: await response.json() as T };
  } finally {
    page.off('framenavigated', markDocument);
    page.off('request', capture);
  }
}

export async function selectSessionProfile(page: Page) {
  await page.getByTestId('advanced-profile').selectOption('local-lean', { timeout: 10_000 });
  await expect(page.getByTestId('advanced-profile')).toHaveValue('local-lean');
}

/** Exact nonce ledger. Cloud callers must pass their actual /cloud collection explicitly. */
export class OwnedRecords {
  readonly prefix: string;
  readonly directory: string;
  readonly api: ObservedApi;
  readonly collection: string;
  private ids = new Set<string>();
  private owners = new Map<string, number>();
  private pending = new Set<Promise<void>>();
  private listener: (response: BrowserResponse) => void;
  constructor(readonly page: Page, readonly parity: ParitySandbox, readonly kind: 'tasks' | 'sessions' = 'sessions', feature: string = kind, collection?: string) {
    this.prefix = `${parity.prefix} ${feature}`;
    this.directory = parity.cwd;
    this.api = parity.api;
    this.collection = collection ?? (kind === 'tasks' ? '/cloud/tasks' : '/agent-sessions');
    assert(this.collection === '/agent-sessions' || this.collection === '/cloud/tasks');
    this.listener = response => {
      const url = new URL(response.url());
      if (url.origin !== parity.origin || url.pathname !== this.collection || response.request().method() !== 'POST' || !response.ok()) return;
      const body = response.request().postDataJSON() as Row | null;
      if (!this.owns(body?.title ?? body?.name)) return;
      const pending = response.json().then((row: Row) => { if (row.id) this.remember(row); }).catch(() => { /* Exact-name list recovers a lost acknowledgement. */ });
      this.pending.add(pending);
      void pending.finally(() => this.pending.delete(pending));
    };
    page.on('response', this.listener);
    parity.deferCleanup(`records ${feature}`, () => this.cleanup());
  }
  owns(name: unknown) { return typeof name === 'string' && (name === this.prefix || name.startsWith(`${this.prefix} `)); }
  remember(row: Row) {
    expect(this.owns(row.title ?? row.name), 'Refuse foreign record adoption').toBe(true);
    const owner = this.kind === 'tasks' ? row.ownerId : row.ownerUserId;
    expect(Number.isSafeInteger(owner), 'Record owner must be explicit').toBe(true);
    if (this.kind === 'sessions') { expect(owner).toBe(1); expect(row.cwd).toBe(this.directory); }
    this.ids.add(String(row.id));
    this.owners.set(String(row.id), Number(owner));
  }
  async list(): Promise<Row[]> {
    if (this.kind === 'tasks') return this.api.json<Row[]>(`${this.collection}?status=all`);
    return (await this.api.json<{ sessions: Row[] }>(`${this.collection}?scope=chats&includeArchived=true&limit=100&search=${encodeURIComponent(this.prefix)}`)).sessions;
  }
  async read(id: string): Promise<Row> {
    const body = await this.api.json<Row | { session: Row }>(`${this.collection}/${encodeURIComponent(id)}`);
    return ('session' in body ? body.session : body) as Row;
  }
  async open() {
    const pending = responseFor(this.page, 'GET', this.collection);
    await this.page.goto(`/#/${this.kind === 'tasks' ? 'tasks' : 'agents'}`);
    await this.page.reload();
    const response = await pending;
    await assertResponse(response, 'GET', this.collection, 200);
    ObservedApi.from(response, this.parity);
    return response;
  }
  async prepare(suffix = '') {
    if (this.kind === 'tasks') {
      const empty = this.page.getByTestId('tasks-empty-create');
      await (await empty.isVisible() ? empty : this.page.getByTestId('tasks-header-add-task')).click();
      await this.page.getByTestId('task-create-title').fill(this.prefix + suffix);
      return;
    }
    await this.page.getByTestId('new-session-advanced').click();
    await selectSessionProfile(this.page);
    await this.page.getByTestId('advanced-name').fill(this.prefix + suffix);
    await this.page.getByTestId('advanced-cwd').fill('');
    await this.page.getByTestId('advanced-cwd').fill(this.directory);
    await this.page.getByTestId('advanced-isolate-worktree').uncheck();
    await expect(this.page.getByTestId('advanced-branch')).toHaveValue('');
  }
  async create(suffix = ''): Promise<Row> {
    await this.prepare(suffix);
    const submit = this.page.getByTestId(this.kind === 'tasks' ? 'task-create-submit' : 'advanced-create');
    await expect(submit).toBeEnabled();
    const pending = responseFor(this.page, 'POST', this.collection);
    await submit.click();
    const response = await pending;
    if (this.kind === 'sessions') {
      expect(response.request().postDataJSON()).toMatchObject({ cwd: this.directory, isolateWorktree: false, profileId: 'local-lean' });
      expect(response.request().postDataJSON().stash).toBeUndefined();
    }
    const row = await response.json() as Row;
    if (row.id && this.owns(row.title ?? row.name)) this.remember(row);
    await assertResponse(response, 'POST', this.collection, 201);
    expect(row).toMatchObject(this.kind === 'tasks' ? { title: this.prefix + suffix } : { name: this.prefix + suffix, cwd: this.directory, profileId: 'local-lean' });
    return row;
  }
  async cleanup(_options: { keepDirectory?: boolean } = {}) {
    this.page.off('response', this.listener);
    await Promise.all(this.pending);
    for (const row of await this.list()) if (this.owns(row.title ?? row.name)) this.remember(row);
    for (const id of this.ids) {
      const detail = await this.api.fetch(`${this.collection}/${encodeURIComponent(id)}`);
      if (detail.status === 404) continue;
      expect(detail.status).toBe(200);
      const body = await detail.json();
      const row = (this.kind === 'sessions' ? body.session : body) as Row;
      expect(this.owns(row.title ?? row.name), 'Refuse foreign deletion').toBe(true);
      expect(this.kind === 'tasks' ? row.ownerId : row.ownerUserId).toBe(this.owners.get(id));
      if (this.kind === 'sessions') expect(row.cwd).toBe(this.directory);
      expect((await this.api.fetch(`${this.collection}/${encodeURIComponent(id)}${this.kind === 'sessions' ? '/hard' : ''}`, { method: 'DELETE' })).status).toBe(204);
      expect((await this.api.fetch(`${this.collection}/${encodeURIComponent(id)}`)).status).toBe(404);
      if (this.kind === 'sessions') {
        expect(this.parity.rows('SELECT id FROM agent_sessions WHERE id=?', id)).toEqual([]);
        expect(this.parity.rows('SELECT id FROM agent_session_messages WHERE session_id=?', id)).toEqual([]);
        if (typeof row.sdkSessionId === 'string') expect((await this.parity.engineFetch(`/session/${encodeURIComponent(row.sdkSessionId)}`)).status).toBe(404);
      }
    }
    expect((await this.list()).filter(row => this.owns(row.title ?? row.name))).toEqual([]);
    // The shared guard owns the directory until every entity/engine cleanup readback finishes.
  }
}

export const test = base.extend<{ parity: ParitySandbox; sessions: OwnedRecords }>({
  parity: async ({}, use) => {
    base.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires RHYTHM_LIVE_E2E=1 and canonical synthetic web sandbox');
    const parity = new ParitySandbox();
    try { await parity.isolation.bootstrap(); await use(parity); } finally { await parity.dispose(); }
  },
  sessions: async ({ page, parity }, use) => { await use(new OwnedRecords(page, parity)); },
});
