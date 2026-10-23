import { randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { expect, ObservedApi, expectedRevision, localRows } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let time = '', now = Date.now();
  for (let index = 0; index < 10; index++) { time = crockford[now % 32] + time; now = Math.floor(now / 32); }
  return time + Array.from(randomBytes(16), byte => crockford[byte % 32]).join('');
}

/** One real normal-API note, only for a validated disposable synthetic actor. */
export class OwnedMemoryFixture {
  readonly id = ulid();
  readonly nonce = randomUUID();
  readonly content = `[smoke] legacy memory inspector ${this.nonce}. Harmless private source-backed selection.`;
  readonly root: string;
  indexId?: string;
  sourceId?: string;
  constructor(readonly api: ObservedApi) {
    const path = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
    expect(path, 'UNVERIFIED: disposable synthetic actor manifest required for memory writes').toBeTruthy();
    const manifest = readQualificationFixture(path!, expectedRevision).manifest;
    expect(manifest.syntheticActor).toBeDefined();
    this.root = join(manifest.fixtureRoot, 'memory');
  }

  private ownedFile(sourceId: string) {
    expect(sourceId && !isAbsolute(sourceId) && !sourceId.split(/[\\/]/).includes('..')).toBe(true);
    const rootStat = lstatSync(this.root);
    expect(rootStat?.isDirectory() && !rootStat.isSymbolicLink() && rootStat.uid === process.getuid?.()
      && realpathSync(this.root) === this.root).toBe(true);
    const file = resolve(this.root, sourceId);
    expect(relative(this.root, file).startsWith('..') || file === this.root).toBe(false);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (stat) expect(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()
      && realpathSync(file).startsWith(`${this.root}/`)).toBe(true);
    return file;
  }

  async create() {
    const response = await this.api.fetch('/agent-memory', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: this.id, kind: 'fact', source: 'manual', content: this.content, tags: ['smoke', this.nonce] }) });
    expect(response.status).toBe(201);
    const body = await response.json() as { id: string; path: string; kind: string };
    expect(body).toMatchObject({ id: this.id, kind: 'fact', path: expect.any(String) });
    this.sourceId = body.path;
    const rows = localRows('SELECT id,content,source,source_id FROM agent_memory WHERE content=?', this.content);
    expect(rows).toMatchObject([{ content: this.content, source: 'obsidian-memory', source_id: body.path }]);
    this.indexId = String(rows[0].id);
    const raw = readFileSync(this.ownedFile(body.path), 'utf8');
    expect(raw).toContain(`id: ${this.id}`);
    expect(raw).toContain(this.content);
    return this.indexId;
  }

  async cleanup() {
    const rows = localRows('SELECT id,content,source,source_id FROM agent_memory WHERE content=?', this.content);
    expect(rows.length).toBeLessThanOrEqual(1);
    for (const row of rows) {
      expect(row).toMatchObject({ content: this.content, source: 'obsidian-memory' });
      if (this.indexId) expect(row.id).toBe(this.indexId);
      if (this.sourceId) expect(row.source_id).toBe(this.sourceId);
      const file = this.ownedFile(String(row.source_id));
      const detail = await this.api.json<{ id: string; content: string; sourceId: string }>(`/agent-memory/${row.id}`);
      expect(detail).toMatchObject({ id: row.id, content: this.content, sourceId: row.source_id });
      const deleted = await this.api.fetch(`/agent-memory/${row.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);
      expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
    }
    // An acknowledged vault note with a lost mirror can still be removed by its exact frontmatter ULID.
    if (this.sourceId) {
      const file = this.ownedFile(this.sourceId);
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (stat) {
        const raw = readFileSync(file, 'utf8');
        expect(raw).toContain(`id: ${this.id}`);
        expect(raw).toContain(this.content);
        const deleted = await this.api.fetch(`/agent-memory/${this.id}`, { method: 'DELETE' });
        expect(deleted.status).toBe(204);
        expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
      }
    }
    expect(localRows('SELECT id FROM agent_memory WHERE content=?', this.content)).toEqual([]);
  }
}
