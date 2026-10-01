import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';
import { MediaArtifactStore } from '../services/media_artifact_store';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

const PROJECT = 'project-mobile-attachment';
const SESSION = 'ses-mobile-attachment';
const OWNER = 41;
const STRANGER = 42;
const selectedBytes = Buffer.from('selected safe attachment bytes');

describe('A1 mobile attachment adapter', () => {
  let db: Database.Database;
  let root: string;
  let previousRoot: string | undefined;
  let ownership: MobileOpenCodeOwnershipRepository;
  let store: MediaArtifactStore;
  let forwarded: Array<Record<string, unknown>>;
  let fetchPaths: string[];

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    root = mkdtempSync(join(tmpdir(), 'rhythm-mobile-attachment-'));
    previousRoot = process.env.ARTIFACT_STORAGE_ROOT;
    process.env.ARTIFACT_STORAGE_ROOT = root;
    db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(OWNER, 'Owner', 'owner-mobile-attachment@example.test');
    db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(STRANGER, 'Stranger', 'stranger-mobile-attachment@example.test');
    db.prepare("INSERT INTO projects (id, name, cwd, created_at) VALUES (?, ?, ?, ?)").run(PROJECT, 'Mobile', '/tmp/rhythm-mobile-attachment-project', new Date().toISOString());
    ownership = new MobileOpenCodeOwnershipRepository(db);
    ownership.claimResource('session', SESSION, OWNER, PROJECT);
    store = new MediaArtifactStore({ db, root });
    forwarded = [];
    fetchPaths = [];
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.ARTIFACT_STORAGE_ROOT;
    else process.env.ARTIFACT_STORAGE_ROOT = previousRoot;
  });

  const send = async (artifactId: string, userId = OWNER, extras: Record<string, unknown> = {}) => {
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      preparePromptStream: async () => undefined,
      fetchFn: async (request: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(request));
        fetchPaths.push(url.pathname);
        if (url.pathname === '/session') return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
        if (init?.method === 'POST') forwarded.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });
    return proxy.forward({
      method: 'POST', path: `/session/${SESSION}/prompt_async`, query: new URLSearchParams(),
      body: { parts: [
        { type: 'text', text: 'Read the selected bytes' },
        { type: 'file', mime: 'image/png', filename: 'selected.png', url: `/artifacts/${artifactId}`, ...extras },
      ] },
      project: { id: PROJECT, root: '/tmp/rhythm-mobile-attachment-project' },
      userId,
    });
  };

  it('normalizes an owned persisted reference to actual selected bytes after session authorization', async () => {
    const artifact = store.registerAttachmentBytesSync({ bytes: selectedBytes, mime: 'image/png', project: PROJECT, session: SESSION });
    const response = await send(artifact.id, OWNER, { artifactId: artifact.id, artifactProject: PROJECT });
    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].parts).toEqual([
      { type: 'text', text: 'Read the selected bytes' },
      { type: 'file', mime: 'image/png', filename: 'selected.png', url: `data:image/png;base64,${selectedBytes.toString('base64')}` },
    ]);
  });

  it('denies an unowned session before artifact lookup or prompt forwarding', async () => {
    const artifact = store.registerAttachmentBytesSync({ bytes: selectedBytes, mime: 'image/png', project: PROJECT, session: SESSION });
    await expect(send(artifact.id, STRANGER)).rejects.toMatchObject({ statusCode: 404 });
    expect(forwarded).toEqual([]);
    expect(fetchPaths).not.toContain(`/session/${SESSION}/prompt_async`);
  });

  it('denies cross-session and missing artifact references identically without forwarding', async () => {
    const other = store.registerAttachmentBytesSync({ bytes: selectedBytes, mime: 'image/png', project: PROJECT, session: 'ses-other' });
    const missing = crypto.randomUUID();
    const errors: string[] = [];
    for (const id of [other.id, missing]) {
      try { await send(id); } catch (error) { errors.push(String((error as Error).message)); }
    }
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe(errors[1]);
    expect(errors[0]).not.toContain(other.id);
    expect(forwarded).toEqual([]);
  });

  it('rejects cross-project references and caller-supplied identity mismatches', async () => {
    const otherProject = store.registerAttachmentBytesSync({
      bytes: selectedBytes, mime: 'image/png', project: 'project-other', session: SESSION,
    });
    const owned = store.registerAttachmentBytesSync({
      bytes: Buffer.from('different selected bytes'), mime: 'image/png', project: PROJECT, session: SESSION,
    });
    for (const [id, extras] of [
      [otherProject.id, {}],
      [owned.id, { artifactProject: 'project-other' }],
      [owned.id, { artifactId: otherProject.id }],
    ] as Array<[string, Record<string, unknown>]>) {
      await expect(send(id, OWNER, extras)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(forwarded).toEqual([]);
  });
});
