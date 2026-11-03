/** Real installed Engraph CLI through the isolated API, fork, and canonical vault. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const RUN = process.env.RHYTHM_LIVE_E2E === '1' && !!process.env.RHYTHM_LIVE_ENGRAPH_BIN;
const API = 'http://127.0.0.1:4098';

type ManagerStatus = {
  enabled: boolean;
  state: string;
  backendOwnership: 'owned' | 'reused' | 'foreign' | 'none';
  backendCount: number;
  approvedMemoryRoot: string | null;
  lastHealthyAt: string | null;
  lastFailureCategory: string | null;
  lastFailureMessage: string | null;
};
type ReferenceSearch = {
  status: string;
  hitCount: number;
  returned: number;
  references: Array<{ id: string; excerpt: string; referenceSourceId?: string; referenceVersion?: string }>;
};

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function managerStatus(): Promise<ManagerStatus> {
  const response = await json('/engraph-manager/status');
  expect(response.status).toBe(200);
  return response.body as ManagerStatus;
}

(RUN ? describe : describe.skip)('real CLI Engraph native reference and disabled fallback', () => {
  it('indexes only a private canonical note and returns a versioned reference; disable leaves FTS usable', async () => {
    assertLiveE2EIsolation();
    const fixture = realpathSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '');
    const sourceDb = realpathSync(process.env.RHYTHM_LIVE_DB_PATH ?? '');
    const sourceConfig = realpathSync(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG ?? '');
    const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR ?? '');
    const binary = process.env.RHYTHM_LIVE_ENGRAPH_BIN ?? '';
    expect(fixture).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sandbox).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sandbox).not.toBe(fixture);
    expect(sourceDb).toBe(join(fixture, 'rhythm.db'));
    expect(sourceConfig.startsWith(`${fixture}/`)).toBe(true);
    expect(statSync(sourceDb).mode & 0o222).toBe(0);
    expect(statSync(sourceConfig).mode & 0o222).toBe(0);
    expect(resolve(process.env.DB_PATH ?? '')).toBe(join(sandbox, 'rhythm.db'));
    expect(process.env.RHYTHM_LIVE_URL).toBe(API);
    expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe('http://127.0.0.1:4097');
    expect(isAbsolute(binary) && realpathSync(binary) === binary && statSync(binary).isFile()).toBe(true);
    expect(statSync(binary).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(sandbox, 'opencode_engine.pid'), 'utf8').trim()).toMatch(/^\d+$/);
    const engine = await fetch('http://127.0.0.1:4097/global/health', { signal: AbortSignal.timeout(10_000) });
    expect(engine.status).toBe(200);
    expect(await engine.json()).toMatchObject({ healthy: true });
    const initial = await managerStatus();
    expect(initial).toMatchObject({ enabled: false, state: 'disabled', backendOwnership: 'none', backendCount: 0 });

    const nonce = `engrreal${randomUUID().replaceAll('-', '')}`;
    const phrase = `${nonce} on-call rotation starts Monday`;
    const query = `${nonce} on-call rotation`;
    const searchPath = `/agent-memory/search?q=${encodeURIComponent(query)}&view=references`;
    const ftsPath = `/agent-memory/search?q=${encodeURIComponent(nonce)}`;
    let noteId: string | null = null;
    let notePath: string | null = null;
    let enabled = false;
    let assertionFailure: unknown;
    try {
      const created = await json('/agent-memory', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'fact', content: `# fact\n${phrase}.\n`, source: 'agent', tags: ['smoke'] }) });
      expect(created.status).toBe(201);
      noteId = String(created.body.id);
      expect(created.body.path).toMatch(/^memory\/fact\//);
      notePath = resolve(sandbox, 'vault', String(created.body.path));
      expect(notePath.startsWith(`${sandbox}/vault/memory/fact/`)).toBe(true);
      expect(realpathSync(notePath)).toBe(notePath);
      const note = lstatSync(notePath);
      expect(note.isFile() && !note.isSymbolicLink() && note.nlink === 1 && note.uid === process.getuid?.()).toBe(true);
      expect(readFileSync(notePath, 'utf8')).toContain(phrase);

      const chosen = await json('/engraph-manager/choose-binary', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: binary }) });
      expect(chosen).toMatchObject({ status: 200, body: { ok: true } });
      const started = await json('/engraph-manager/enable', { method: 'POST' });
      enabled = started.status === 200 && started.body?.accepted === true;
      expect(started).toMatchObject({ status: 200, body: { accepted: true } });
      const deadline = Date.now() + 120_000;
      let ready = await managerStatus();
      while (ready.state !== 'ready' && ready.state !== 'error' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250));
        ready = await managerStatus();
      }
      expect(ready.state, `Engraph failure ${ready.lastFailureCategory}: ${ready.lastFailureMessage}`).toBe('ready');
      expect(ready).toMatchObject({ enabled: true, backendOwnership: 'owned', backendCount: 1,
        approvedMemoryRoot: join(sandbox, 'vault', 'memory') });
      expect(ready.lastHealthyAt).not.toBeNull();
      const health = await json('/engraph-manager/check-health', { method: 'POST' });
      expect(health).toMatchObject({ status: 200, body: { ok: true } });
      expect(health.body.latencyMs).toBeLessThanOrEqual(1_000);
      const fts = await json(ftsPath);
      expect(fts.status).toBe(200);
      const indexed = Array.isArray(fts.body)
        ? fts.body.find((row: { id: string; content: string; sourceId: string }) => row.content.includes(nonce))
        : null;
      expect(indexed?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(indexed?.sourceId).toBe(created.body.path);
      const expectedVersion = `sha256:${createHash('sha256').update(readFileSync(notePath)).digest('hex')}`;

      const native = await json(searchPath);
      expect(native.status).toBe(200);
      const references = native.body as ReferenceSearch;
      expect(references.status).toBe('used');
      expect(references.hitCount).toBeGreaterThan(0);
      expect(references.returned).toBeGreaterThan(0);
      expect(references.references.some(reference => reference.id === indexed.id
        && reference.excerpt.includes(nonce)
        && reference.referenceSourceId === `memory:${indexed.id}`
        && reference.referenceVersion === expectedVersion), JSON.stringify(references.references)).toBe(true);

      const off = await json('/engraph-manager/disable', { method: 'POST' });
      expect(off).toMatchObject({ status: 200, body: { ok: true } });
      enabled = false;
      expect(await managerStatus()).toMatchObject({ enabled: false, state: 'disabled', backendOwnership: 'none', backendCount: 0 });
      const unavailable = await json(searchPath);
      expect(unavailable).toMatchObject({ status: 200, body: { status: 'backend_unavailable', hitCount: 0,
        returned: 0, references: [] } });
      const ftsAfter = await json(ftsPath);
      expect(ftsAfter.status).toBe(200);
      expect(Array.isArray(ftsAfter.body) && ftsAfter.body.some((row: { content: string }) => row.content.includes(nonce))).toBe(true);
    } catch (error) {
      assertionFailure = error;
    }
    const cleanupFailures: unknown[] = [];
    try {
      if (enabled) {
        const current = await managerStatus();
        expect(current.backendOwnership, 'refusing to signal a foreign Engraph process').not.toBe('foreign');
        const off = await json('/engraph-manager/disable', { method: 'POST' });
        expect(off).toMatchObject({ status: 200, body: { ok: true } });
      }
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (noteId && notePath) {
      try {
        expect(notePath.startsWith(`${sandbox}/vault/memory/fact/`)).toBe(true);
        const deleted = await json(`/agent-memory/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
        expect(deleted.status).toBe(204);
        expect(existsSync(notePath)).toBe(false);
        const absent = await json(ftsPath);
        expect(absent.status).toBe(200);
        expect(Array.isArray(absent.body) && absent.body.some((row: { content: string }) => row.content.includes(nonce))).toBe(false);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (assertionFailure && cleanupFailures.length > 0) {
      throw new AggregateError([assertionFailure, ...cleanupFailures], 'Engraph assertion and safe cleanup both failed');
    }
    if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'Engraph safe cleanup failed');
    if (assertionFailure) throw assertionFailure;
  }, 130_000);
});
