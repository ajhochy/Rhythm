import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { expect, ObservedApi } from './parity-fixture';

type Design = { id: string; title: string; provider: string; artifactUrl: string | null; thumbnailUrl: string | null };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
const pngSha = createHash('sha256').update(png).digest('hex');

/** No test registration; callers must establish ObservedApi from the real browser UI. */
export class OwnedMissingGalleryFixture {
  readonly nonce = randomUUID();
  readonly title = `[smoke] gallery missing ${this.nonce}`;
  readonly file: string;
  private fileStat?: Stats;
  private designId?: string;
  get id() { return this.designId; }

  constructor(readonly api: ObservedApi) {
    let dir = api.parity.sandbox;
    for (const name of ['home', 'Downloads', 'Rhythm Studio']) {
      dir = join(dir, name);
      if (!lstatSync(dir, { throwIfNoEntry: false })) mkdirSync(dir, { mode: 0o700 });
      const stat = lstatSync(dir);
      expect(stat?.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()
        && (stat.mode & 0o077) === 0 && realpathSync(dir) === dir).toBe(true);
    }
    this.file = join(dir, `[smoke]-gallery-missing-${this.nonce}.png`);
  }

  async create() {
    writeFileSync(this.file, png, { mode: 0o600, flag: 'wx' });
    this.fileStat = lstatSync(this.file);
    const response = await this.api.fetch('/agent-designs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: this.title, provider: 'smoke', localPath: this.file }) });
    expect(response.status).toBe(201);
    const design = await response.json() as Design;
    expect(design).toMatchObject({ id: expect.any(String), title: this.title,
      artifactUrl: `/agent-designs/${design.id}/artifact` });
    this.designId = design.id;
    expect(this.api.parity.rows('SELECT id,title,provider,file_path FROM agent_designs WHERE id=?', design.id)).toMatchObject([
      { id: design.id, title: this.title, provider: 'smoke', file_path: this.file },
    ]);
    this.removeSource();
    return design;
  }

  private removeSource() {
    const stat = lstatSync(this.file, { throwIfNoEntry: false });
    expect(stat && this.fileStat && stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()
      && stat.dev === this.fileStat.dev && stat.ino === this.fileStat.ino && stat.size === png.length
      && createHash('sha256').update(readFileSync(this.file)).digest('hex') === pngSha).toBe(true);
    unlinkSync(this.file);
    expect(lstatSync(this.file, { throwIfNoEntry: false })).toBeUndefined();
  }

  async cleanup() {
    try {
      if (lstatSync(this.file, { throwIfNoEntry: false })) this.removeSource();
      const rows = this.api.parity.rows('SELECT id,title,provider,file_path FROM agent_designs WHERE title=?', this.title);
      expect(rows.length).toBeLessThanOrEqual(1);
      for (const row of rows) {
        expect(row).toMatchObject({ title: this.title, provider: 'smoke', file_path: this.file });
        if (this.designId) expect(row.id).toBe(this.designId);
        const detail = await this.api.json<Design>(`/agent-designs/${row.id}`);
        expect(detail).toMatchObject({ id: row.id, title: this.title, provider: 'smoke',
          artifactUrl: null, thumbnailUrl: null });
        const deleted = await this.api.fetch(`/agent-designs/${row.id}`, { method: 'DELETE' });
        expect(deleted.status).toBe(204);
      }
      expect(this.api.parity.rows('SELECT id FROM agent_designs WHERE title=?', this.title)).toEqual([]);
    } finally {
      const stat = lstatSync(this.file, { throwIfNoEntry: false });
      if (stat) this.removeSource();
    }
  }
}
