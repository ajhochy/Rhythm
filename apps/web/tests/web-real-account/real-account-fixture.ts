import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test as base, expect, type Page, type Response as BrowserResponse } from '@playwright/test';

export { expect };
export const enabled = process.env.RHYTHM_WEB_REAL_ACCOUNT === '1' && process.env.RHYTHM_LIVE_E2E === '1';
export const origin = process.env.RHYTHM_WEB_PUBLIC_ORIGIN ?? 'http://rhythm-web.test:4001';
type Kind = 'cookbook' | 'task' | 'artifact';
export type Row = Record<string, any> & { id: string; title: string };
type Entry = { kind: Kind; id: string; title: string; absent: boolean };
type Intent = { kind: Kind; title: string; body: Record<string, unknown>; sent: boolean; absenceConfirmed: boolean };
type Candidate = { schemaVersion: 1; kind: 'web-real-account-candidate-v1'; appPath: string;
  sourceRevision: string; apiPid: number; enginePid: number; localOwnerId: 1 };
const routes: Record<Kind, string> = { cookbook: '/agent-cookbook', task: '/cloud/tasks', artifact: '/cloud/live-artifacts' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function publicFile(file: string, privateFile = false) {
  assert(path.isAbsolute(file) && path.resolve(file) === file && fs.realpathSync(file) === file, 'Public receipt path must be canonical');
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && stat.nlink === 1, 'Public receipt must be an owned regular file');
  assert.equal(stat.mode & (privateFile ? 0o777 : 0o022), privateFile ? 0o600 : 0);
  return fs.readFileSync(file);
}

/** One candidate, one AJ owner, one nonce ledger. No DB, credential or synthetic fixture imports. */
export class RealAccountRun {
  readonly marker = `[rhythm-web-e2e ${randomUUID()}]`;
  readonly entries: Entry[] = [];
  readonly intents: Intent[] = [];
  readonly violations: string[] = [];
  readonly evidenceRoot: string;
  readonly ledgerPath: string;
  readonly candidate: Candidate;
  readonly receiptPath: string;
  readonly receiptHash: string;
  cloudOwnerId = 0;
  workspaceId = 0;
  blocked = false;
  private pending = new Set<Promise<void>>();

  constructor() {
    assert(enabled, 'UNVERIFIED: explicit real-account and live opt-ins required');
    assert.equal(origin, 'http://rhythm-web.test:4001');
    const expected = process.env.RHYTHM_WEB_REAL_EXPECTED_REVISION ?? '';
    assert.match(expected, /^[a-f0-9]{40}$/, 'Exact final candidate revision required');
    this.receiptPath = process.env.RHYTHM_WEB_REAL_CANDIDATE_RECEIPT ?? '';
    const bytes = publicFile(this.receiptPath, true);
    this.receiptHash = hash(bytes);
    this.candidate = JSON.parse(bytes.toString()) as Candidate;
    assert(this.candidate.schemaVersion === 1 && this.candidate.kind === 'web-real-account-candidate-v1'
      && this.candidate.sourceRevision === expected && this.candidate.localOwnerId === 1, 'Candidate receipt identity rejected');
    assert(this.candidate.appPath.endsWith('.app') && fs.realpathSync(this.candidate.appPath) === this.candidate.appPath);
    const identity = JSON.parse(publicFile(path.join(this.candidate.appPath, 'Contents/Resources/api_server/build-identity.json')).toString());
    assert(identity.schemaVersion === 1 && identity.sourceRevision === expected, 'Candidate API identity differs');
    this.evidenceRoot = fs.mkdtempSync('/private/tmp/rhythm-web-real-');
    fs.chmodSync(this.evidenceRoot, 0o700);
    this.ledgerPath = path.join(this.evidenceRoot, 'owned-records.json');
    this.persist();
  }
  persist() {
    fs.writeFileSync(this.ledgerPath, JSON.stringify({ schemaVersion: 1, marker: this.marker,
      sourceRevision: this.candidate.sourceRevision, localOwnerId: this.candidate.localOwnerId,
      cloudOwnerId: this.cloudOwnerId || null, blocked: this.blocked,
      records: this.entries, pendingCreates: this.intents.filter(intent => intent.sent && !intent.absenceConfirmed && !this.entries.some(row => row.kind === intent.kind && row.title === intent.title))
        .map(({ kind, title }) => ({ kind, title })), violations: this.violations }, null, 2) + '\n', { mode: 0o600 });
  }
  assertCandidateProcesses() {
    assert.equal(hash(publicFile(this.receiptPath, true)), this.receiptHash, 'Candidate receipt changed');
    for (const [port, pid] of [[4001, this.candidate.apiPid], [4096, this.candidate.enginePid]]) {
      assert(Number.isSafeInteger(pid) && pid > 1);
      assert.equal(execFileSync('/usr/sbin/lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(), String(pid), 'Candidate listener identity changed');
    }
    const executable = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(this.candidate.enginePid), '-d', 'txt', '-Fn'], { encoding: 'utf8' })
      .split('\n').find(line => line.startsWith('n'))?.slice(1);
    assert(executable?.startsWith(this.candidate.appPath + path.sep), 'Engine executable is outside the final candidate');
  }
  async qualify() {
    assert(!this.blocked, 'Cleanup failed; stop and resolve the owned ledger before continuing');
    this.assertCandidateProcesses();
    const bootstrap = await this.json('/web/bootstrap');
    assert(bootstrap.mode === 'web' && bootstrap.owner?.id === this.candidate.localOwnerId
      && bootstrap.capabilities?.localAgents === true && bootstrap.capabilities?.cloud === true, 'AJ candidate owner/cloud bootstrap rejected');
    const runtime = await this.json('/opencode/runtime');
    assert(runtime.api?.port === 4001 && runtime.engine?.port === 4096 && runtime.engine.pid === this.candidate.enginePid
      && runtime.engine.status === 'ready' && runtime.engine.version === `0.0.0-rhythm-${this.candidate.sourceRevision}`, 'Final candidate engine identity rejected');
    const health = await this.json('/cloud/health');
    assert(health.status === 'ok' && health.service === 'rhythm-api-server', 'Cloud health unavailable');
    // Startup webCloud already compares the existing local Google subject + email.
    // Numeric cloud IDs are independent. Never log this auth body (may include joinCode).
    const me = await this.json('/cloud/auth/me');
    assert(Number.isSafeInteger(me.user?.id) && me.user.id > 0, 'Validated AJ cloud identity unavailable');
    if (this.cloudOwnerId) assert.equal(me.user.id, this.cloudOwnerId, 'Cloud identity changed');
    this.cloudOwnerId = me.user.id;
    this.workspaceId = Number.isSafeInteger(me.workspace?.id) ? me.workspace.id : 0;
    this.persist();
  }
  async fetch(route: string, method = 'GET', body?: Record<string, unknown>): Promise<Response> {
    assert(route.startsWith('/') && !route.startsWith('//') && !/[\r\n\\]/.test(route));
    if (!['GET', 'HEAD'].includes(method)) this.checkWrite(method, new URL(route, origin).pathname, body);
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 4001, path: route, method,
        headers: { Host: new URL(origin).host, Origin: origin, Accept: 'application/json',
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('error', reject);
        response.on('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) if (value !== undefined)
            for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
          resolve(new Response(method === 'HEAD' || [204, 205, 304].includes(response.statusCode!) ? null : new Uint8Array(Buffer.concat(chunks)), { status: response.statusCode!, headers }));
        });
      });
      req.setTimeout(20_000, () => req.destroy(new Error('Real-account request timed out')));
      req.on('error', reject); req.end(bytes);
    });
  }
  async json(route: string): Promise<any> {
    const response = await this.fetch(route); assert.equal(response.status, 200, `Read failed: ${new URL(route, origin).pathname}`);
    return response.json();
  }
  async list(kind: Kind): Promise<Row[]> {
    const query = kind === 'cookbook' ? '' : `${kind === 'task' ? '?status=all&' : '?type=html&'}search=${encodeURIComponent(this.marker)}`;
    const rows = await this.json(routes[kind] + query);
    assert(Array.isArray(rows), 'Collection shape differs');
    return rows.filter((row: Row) => typeof row.title === 'string' && row.title.startsWith(this.marker + ' '));
  }
  async prepareCreate(kind: Kind, body: Record<string, unknown>) {
    assert(typeof body.title === 'string' && body.title.startsWith(this.marker + ' '));
    assert.equal((await this.list(kind)).filter(row => row.title === body.title).length, 0, 'Owned marker collision');
    assert(!this.intents.some(intent => intent.kind === kind), 'One record per kind per run');
    this.intents.push({ kind, title: body.title, body, sent: false, absenceConfirmed: false }); this.persist();
  }
  assertOwned(kind: Kind, row: Row) {
    assert(uuid.test(row.id) && typeof row.title === 'string' && row.title.startsWith(this.marker + ' '), 'Foreign record refused');
    if (kind === 'cookbook') assert(row.ownerUserId === this.candidate.localOwnerId && row.boundConfigId === null, 'Foreign or executable-bound recipe refused');
    if (kind === 'task') assert(row.ownerId === this.cloudOwnerId && row.isShared === false && row.workspaceId == null
      && row.sourceType == null && row.sourceId == null && Array.isArray(row.collaborators) && row.collaborators.length === 0, 'Task is not private and AJ-only');
    if (kind === 'artifact') assert(row.ownerUserId === this.cloudOwnerId && row.workspaceId === this.workspaceId
      && row.visibility === 'private' && Array.isArray(row.declaredCapabilities) && row.declaredCapabilities.length === 0, 'Artifact is not private and AJ-only');
  }
  remember(kind: Kind, row: Row) {
    const intent = this.intents.find(item => item.kind === kind && item.sent);
    assert(intent, 'Record has no matching create intent');
    // Persist the acknowledged ID before further shape checks, so unexpected ownership is reported and never deleted blindly.
    if (!this.entries.some(entry => entry.kind === kind && entry.id === row.id)) {
      assert(uuid.test(row.id)); this.entries.push({ kind, id: row.id, title: intent.title, absent: false }); this.persist();
    }
    assert.equal(row.title, intent.title, 'Create acknowledgement title differs from the prepared marker');
    this.assertOwned(kind, row);
  }
  checkWrite(method: string, pathname: string, body?: Record<string, unknown>) {
    assert(!this.blocked, 'Run is stopped after cleanup failure');
    this.assertCandidateProcesses();
    const createKind = (Object.keys(routes) as Kind[]).find(kind => routes[kind] === pathname);
    if (method === 'POST' && createKind) {
      const intent = this.intents.find(item => item.kind === createKind && !item.sent && equal(item.body, body));
      assert(intent, 'Unexpected create refused'); intent.sent = true; this.persist(); return;
    }
    const entry = this.entries.find(item => !item.absent && (pathname === `${routes[item.kind]}/${item.id}`
      || item.kind === 'artifact' && [`${routes.artifact}/${item.id}/bundle`, `${routes.artifact}/${item.id}/state`].includes(pathname)));
    assert(entry, 'Write to an ID not created by this run refused');
    if (method === 'DELETE') { assert(pathname === `${routes[entry.kind]}/${entry.id}` && body === undefined); return; }
    const keys = Object.keys(body ?? {});
    if (method === 'PATCH') {
      const allowed = entry.kind === 'cookbook' ? ['title', 'description', 'stepsJson']
        : entry.kind === 'task' ? ['title', 'notes', 'status', 'dueDate', 'scheduledDate', 'preferredAgent', 'energy'] : ['title'];
      assert(keys.length && keys.every(key => allowed.includes(key)), 'Unexpected owned-record fields refused');
      if (body?.title !== undefined) assert(typeof body.title === 'string' && body.title.startsWith(this.marker + ' '));
      for (const key of ['dueDate', 'scheduledDate', 'preferredAgent', 'energy']) if (key in (body ?? {})) assert(body![key] == null || body![key] === '');
      if (body?.status !== undefined) assert(body.status === 'done');
      return;
    }
    assert(entry.kind === 'artifact' && method === 'PUT'
      && (pathname.endsWith('/bundle') && equal(keys.sort(), ['bundle', 'expectedBundleRevision'])
        || pathname.endsWith('/state') && equal(keys.sort(), ['expectedStateRevision', 'state'])), 'Unexpected mutation refused');
  }
  async installBrowserGuard(page: Page) {
    await page.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== origin) return route.abort('blockedbyclient');
      try {
        assert(!request.headers().authorization && !request.headers()['x-rhythm-human-approval'], 'Browser credential header refused');
        if (!['GET', 'HEAD'].includes(request.method())) this.checkWrite(request.method(), url.pathname, request.postData() ? request.postDataJSON() : undefined);
        await route.continue();
      } catch {
        this.violations.push(`blocked unexpected ${request.method()} request`); this.persist(); await route.abort('blockedbyclient');
      }
    });
    // These are inert record flows, with no agent session or turn in scope.
    await page.routeWebSocket('**/*', socket => socket.close({ code: 1008, reason: 'No agent turns in real-account record checks' }));
    page.on('response', response => {
      const kind = (Object.keys(routes) as Kind[]).find(key => routes[key] === new URL(response.url()).pathname);
      if (!kind || response.request().method() !== 'POST' || response.status() !== 201) return;
      const pending = response.json().then(row => this.remember(kind, row)).catch(() => { this.violations.push('Create acknowledgement could not be qualified'); this.persist(); });
      this.pending.add(pending); void pending.finally(() => this.pending.delete(pending));
    });
  }
  async assertAbsent(entry: Entry) {
    const result = await this.fetch(`${routes[entry.kind]}/${entry.id}`);
    assert.equal(result.status, entry.kind === 'artifact' ? 410 : 404, 'Owned record deletion readback failed');
    if (entry.kind === 'artifact') assert((await result.json()).error?.code === 'artifact_deleted', 'Expected artifact tombstone');
    assert(!(await this.list(entry.kind)).some(row => row.id === entry.id), 'Owned ID remains in catalog');
    entry.absent = true; this.persist();
  }
  async cleanup() {
    await Promise.all(this.pending);
    const errors: string[] = [];
    // Recover only an actually dispatched create's full unique title after a lost acknowledgement.
    for (const intent of this.intents.filter(item => item.sent)) {
      try {
        const matching = (await this.list(intent.kind)).filter(row => row.title === intent.title);
        for (const row of matching) if (!this.entries.some(entry => entry.id === row.id)) this.remember(intent.kind, row);
        if (!matching.length && !this.entries.some(entry => entry.kind === intent.kind && !entry.absent)) intent.absenceConfirmed = true;
      }
      catch { errors.push(`unresolved create: ${intent.kind}`); }
    }
    for (const entry of this.entries.filter(item => !item.absent)) {
      try {
        const response = await this.fetch(`${routes[entry.kind]}/${entry.id}`);
        if (response.status !== (entry.kind === 'artifact' ? 410 : 404)) {
          assert.equal(response.status, 200); const row = await response.json() as Row; this.assertOwned(entry.kind, row);
          if (entry.kind !== 'cookbook') assert.equal((await this.json(`${routes[entry.kind]}/${entry.id}/collaborators`)).length, 0, 'Collaborator added; refuse cleanup');
          assert.equal((await this.fetch(`${routes[entry.kind]}/${entry.id}`, 'DELETE')).status, 204);
        }
        await this.assertAbsent(entry);
      } catch { errors.push(`${entry.kind}:${entry.id}`); }
    }
    if (errors.length) {
      this.blocked = true; this.persist();
      throw new Error(`STOP: real-account cleanup failed. Leftover IDs: ${this.entries.filter(entry => !entry.absent).map(entry => `${entry.kind}:${entry.id}`).join(', ') || 'unknown; inspect pendingCreates'}. Ledger: ${this.ledgerPath}`);
    }
    this.persist();
  }
}

export function responseFor(page: Page, method: string, pathname: string) {
  const result = page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).origin === origin && new URL(response.url()).pathname === pathname, { timeout: 20_000 });
  void result.catch(() => {}); return result;
}
export async function checked(response: BrowserResponse, status: number) {
  assert.equal(response.status(), status); assert.equal(new URL(response.url()).origin, origin);
  assert(!response.request().headers().authorization && !response.request().headers()['x-rhythm-human-approval']);
}
export const test = base.extend<{ account: RealAccountRun }, { realRun: RealAccountRun }>({
  realRun: [async ({}, use) => {
    assert(enabled, 'AJ-only real-account verification requires explicit opt-in');
    const run = new RealAccountRun();
    try { await use(run); } finally { if (!run.blocked) await run.cleanup(); }
  }, { scope: 'worker' }],
  account: async ({ realRun, page }, use, info) => {
    await realRun.qualify(); await realRun.installBrowserGuard(page);
    try { await use(realRun); }
    finally {
      await realRun.cleanup();
      await info.attach('owned-record-ledger', { path: realRun.ledgerPath, contentType: 'application/json' });
      assert.equal(realRun.violations.length, 0, 'Unexpected browser write was blocked; no qualification credit');
    }
  },
});
