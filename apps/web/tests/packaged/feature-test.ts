import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { Page, Response } from '@playwright/test';
import { test as packagedTest, expect, waitForSignedIn } from './packaged-app';

export { expect } from '@playwright/test';
export const API = 'http://127.0.0.1:4001';
export const ENGINE = 'http://127.0.0.1:4096';
// These precise 404s are the deletion proof, not a service outage. Never allow arbitrary ERROR lines.
const deletedOwnSessions = new Set<string>();
export const expectedRevision = process.env.RHYTHM_FEATURE_EXPECTED_REVISION
  ?? execFileSync('git', ['rev-parse', 'mega/2026-09-29-consolidation'], { encoding: 'utf8' }).trim();
process.env.RHYTHM_FEATURE_EXPECTED_REVISION ??= expectedRevision;
export type Row = Record<string, unknown> & { id: string; name?: string; title?: string };

/** Credentials stay in memory; readback follows the UI's actual service, never a guessed local DB. */
export class ObservedApi {
  constructor(readonly origin: string, private readonly headers: Record<string, string>) {}
  static from(response: Response) {
    const headers = response.request().headers();
    return new ObservedApi(new URL(response.url()).origin, Object.fromEntries(
      ['authorization', 'x-rhythm-human-approval'].filter(key => headers[key]).map(key => [key, headers[key]]),
    ));
  }
  fetch(route: string, init: RequestInit = {}) {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Readback requires a relative service path');
    return fetch(`${this.origin}${route}`, { ...init, headers: { ...this.headers, ...init.headers }, signal: AbortSignal.timeout(20_000) });
  }
  async json<T>(route: string): Promise<T> {
    const response = await this.fetch(route);
    expect(response.status, `GET ${route}`).toBe(200);
    return await response.json() as T;
  }
}

export async function navigate(page: Page, key: string) {
  const direct = page.getByTestId(`nav-${key}`);
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByTestId('nav-more').click();
    await page.getByTestId(`nav-${key}-overflow`).click();
  }
  await expect(page).toHaveURL(new RegExp(`#/${key}(\\?.*)?$`));
}

export function responseFor(page: Page, method: string, pathname: string) {
  const pending = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === pathname, { timeout: 20_000 });
  // An action can fail before its response is awaited; retain the rejection for the caller without an orphan rejection.
  void pending.catch(() => {});
  return pending;
}

export async function selectSessionProfile(page: Page) {
  // Advanced can open before its catalog arrives. Choose explicitly instead of assuming a default hydrated in time.
  const profileId = process.env.RHYTHM_FEATURE_PROFILE_ID ?? 'coding-agent';
  await page.getByTestId('advanced-profile').selectOption(profileId, { timeout: 10_000 });
  await expect(page.getByTestId('advanced-profile')).toHaveValue(profileId);
}

export async function openTaskDialog(page: Page) {
  const empty = page.getByTestId('tasks-empty-create');
  await (await empty.isVisible() ? empty : page.getByTestId('tasks-header-add-task')).click();
}

export async function assertResponse(response: Response, method: string, pathname: string, status: number) {
  expect(response.request().method()).toBe(method);
  expect(new URL(response.url()).pathname).toBe(pathname);
  expect(response.status(), `${method} ${pathname}`).toBe(status);
}

/** A per-test ledger; only this nonce's records may ever be deleted. List fallback catches lost acknowledgements. */
export class OwnedRecords {
  readonly prefix: string;
  private ids = new Set<string>();
  private pending = new Set<Promise<void>>();
  private listener: (response: Response) => void;
  private onRequest: (request: import('@playwright/test').Request) => void;
  api?: ObservedApi;
  directory?: string;
  constructor(readonly page: Page, readonly kind: 'tasks' | 'sessions', feature: string = kind) {
    this.prefix = `[smoke] ${feature} ${randomUUID().slice(0, 8)}`;
    this.onRequest = request => {
      const match = new URL(request.url()).pathname.match(/^\/agent-sessions\/([^/]+)\/hard$/);
      if (request.method() === 'DELETE' && match && this.ids.has(match[1])) deletedOwnSessions.add(match[1]);
    };
    page.on('request', this.onRequest);
    const collection = kind === 'tasks' ? '/tasks' : '/agent-sessions';
    this.listener = response => {
      if (new URL(response.url()).pathname !== collection) return;
      this.api = ObservedApi.from(response);
      if (response.request().method() !== 'POST' || !response.ok()) return;
      const input = response.request().postDataJSON() as Row | null;
      if (!this.owns(input?.title ?? input?.name)) return;
      const pending = response.json().then((row: Row) => { if (row.id) this.ids.add(String(row.id)); }).catch(() => { /* Cleanup's exact-nonce list recovers lost acknowledgements. */ });
      this.pending.add(pending);
      void pending.finally(() => this.pending.delete(pending));
    };
    page.on('response', this.listener);
  }
  owns(name: unknown) { return typeof name === 'string' && (name === this.prefix || name.startsWith(`${this.prefix} `)); }
  remember(row: Row) { expect(this.owns(row.title ?? row.name), 'refuse to adopt a foreign record').toBe(true); this.ids.add(String(row.id)); }
  async list(): Promise<Row[]> {
    expect(this.api, 'the real UI collection request must establish the API and auth').toBeDefined();
    if (this.kind === 'tasks') return this.api!.json<Row[]>('/tasks?status=all');
    // Search narrows readback, while includeArchived keeps cleanup independent of view filters.
    const body = await this.api!.json<{ sessions: Row[] }>('/agent-sessions?scope=chats&includeArchived=true&limit=100&search=' + encodeURIComponent(this.prefix));
    return body.sessions;
  }
  async read(id: string): Promise<Row> {
    const body = await this.api!.json<Row | { session: Row }>(`${this.kind === 'tasks' ? '/tasks' : '/agent-sessions'}/${encodeURIComponent(id)}`);
    return ('session' in body ? body.session : body) as Row;
  }
  async open() {
    const collection = this.kind === 'tasks' ? '/tasks' : '/agent-sessions';
    const pending = responseFor(this.page, 'GET', collection);
    await this.page.goto(`rhythm://app/index.html#/${this.kind === 'tasks' ? 'tasks' : 'agents'}`);
    // Chromium may treat an unchanged hash route as same-document navigation, with no collection request.
    await this.page.reload();
    await waitForSignedIn(this.page);
    const response = await pending;
    await assertResponse(response, 'GET', collection, 200);
    this.api = ObservedApi.from(response);
    return response;
  }
  async prepare(suffix = '') {
    const name = this.prefix + suffix;
    if (this.kind === 'tasks') {
      await openTaskDialog(this.page);
      await this.page.getByTestId('task-create-title').fill(name);
    } else {
      this.directory ??= await mkdtemp(path.join('/private/tmp', `${this.prefix} `));
      await this.page.getByTestId('new-session-advanced').click();
      await selectSessionProfile(this.page);
      await this.page.getByTestId('advanced-name').fill(name);
      // Filling the same cwd twice may emit no change event and retain the previous session's branch.
      await this.page.getByTestId('advanced-cwd').fill('');
      await this.page.getByTestId('advanced-cwd').fill(this.directory);
      await this.page.getByTestId('advanced-isolate-worktree').uncheck();
      await expect(this.page.getByTestId('advanced-branch')).toHaveValue('');
    }
  }
  async create(suffix = ''): Promise<Row> {
    const name = this.prefix + suffix;
    await this.prepare(suffix);
    const collection = this.kind === 'tasks' ? '/tasks' : '/agent-sessions';
    await expect(this.page.getByTestId(this.kind === 'tasks' ? 'task-create-submit' : 'advanced-create')).toBeEnabled();
    const pending = responseFor(this.page, 'POST', collection);
    await this.page.getByTestId(this.kind === 'tasks' ? 'task-create-submit' : 'advanced-create').click();
    const response = await pending;
    if (this.kind === 'sessions') {
      expect(response.request().postDataJSON()).toMatchObject({ cwd: this.directory, isolateWorktree: false });
      expect(response.request().postDataJSON().stash).toBeUndefined();
    }
    const row = await response.json() as Row;
    if (row.id && this.owns(row.title ?? row.name)) this.remember(row);
    await assertResponse(response, 'POST', collection, 201);
    expect(row).toMatchObject(this.kind === 'tasks' ? { title: name } : { name, cwd: this.directory });
    return row;
  }
  async cleanup() {
    this.page.off('response', this.listener);
    this.page.off('request', this.onRequest);
    await Promise.all(this.pending);
    if (!this.api) { expect(this.ids.size, 'no API available for owned-record cleanup').toBe(0); return; }
    const collection = this.kind === 'tasks' ? '/tasks' : '/agent-sessions';
    for (const row of await this.list()) if (this.owns(row.title ?? row.name)) this.ids.add(String(row.id));
    for (const id of this.ids) {
      const detail = await this.api.fetch(`${collection}/${encodeURIComponent(id)}`);
      if (detail.status === 404) continue;
      expect(detail.status, 'cleanup must read ownership before deleting').toBe(200);
      const value = await detail.json() as Row | { session: Row };
      const row = ('session' in value ? value.session : value) as Row;
      expect(this.owns(row.title ?? row.name), 'refusing to delete a record without this test nonce').toBe(true);
      if (this.kind === 'sessions') deletedOwnSessions.add(id);
      const removed = await this.api.fetch(`${collection}/${encodeURIComponent(id)}${this.kind === 'sessions' ? '/hard' : ''}`, { method: 'DELETE' });
      expect(removed.status, 'owned-record deletion must succeed').toBe(204);
      expect((await this.api.fetch(`${collection}/${encodeURIComponent(id)}`)).status, 'deleted record still readable').toBe(404);
    }
    expect((await this.list()).filter(row => this.owns(row.title ?? row.name)), 'nonce-owned records leaked').toEqual([]);
    if (this.directory) await rm(this.directory, { recursive: true });
  }
}

const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
type ReadonlyDb = { prepare(sql: string): { get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] }; close(): void };
export function localRows(sql: string, ...args: unknown[]) {
  const Database = requireApi('better-sqlite3') as new (file: string, options: { readonly: true; fileMustExist: true }) => ReadonlyDb;
  const db = new Database(path.join(homedir(), 'Library/Application Support/Rhythm Electron/rhythm.db'), { readonly: true, fileMustExist: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}

export const test = packagedTest.extend<{ tasks: OwnedRecords; sessions: OwnedRecords; audit: void }>({
  tasks: async ({ page }, use) => { const records = new OwnedRecords(page, 'tasks'); try { await use(records); } finally { await records.cleanup(); } },
  sessions: async ({ page }, use) => { const records = new OwnedRecords(page, 'sessions'); try { await use(records); } finally { await records.cleanup(); } },
  audit: [async ({ page, packaged }, use, info) => {
    const identity = JSON.parse(readFileSync(path.join(packaged.appPath, 'Contents/Resources/api_server/build-identity.json'), 'utf8'));
    expect(identity, 'UNVERIFIED: packaged API is not built from the mega source head').toMatchObject({ schemaVersion: 1, sourceRevision: expectedRevision });
    const health = await fetch(`${ENGINE}/global/health`, { signal: AbortSignal.timeout(20_000) });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ healthy: true, version: `0.0.0-rhythm-${expectedRevision}` });
    await waitForSignedIn(page);
    const log = path.join(tmpdir(), 'rhythm-packaged-smoke.log');
    const offset = statSync(log).size;
    packaged.pageErrors.length = 0;
    deletedOwnSessions.clear();
    try { await use(); } finally {
      await page.unrouteAll({ behavior: 'wait' });
      // Private per-case evidence survives the next worker truncating the shared app log.
      const fresh = readFileSync(log).subarray(offset).toString('utf8');
      await info.attach('runtime-output', { body: fresh, contentType: 'text/plain' });
      expect(packaged.pageErrors, 'uncaught renderer errors during this test').toEqual([]);
      const unexpected = fresh.split('\n').filter(line => /\[ERROR\]/.test(line)).filter(line => ![...deletedOwnSessions].some(id =>
        line.includes(`Handled NOT_FOUND GET /agent-sessions/${id} — AgentSession not found`)
        || line.includes(`Handled NOT_FOUND GET /agent-sessions/${id}?transcriptLimit=50 — AgentSession not found`)
        || line.includes(`Handled NOT_FOUND GET /agent-sessions/${id}/pending-permissions — AgentSession not found`)));
      expect(unexpected, 'unexpected app errors in this test window').toEqual([]);
    }
  }, { auto: true }],
});
