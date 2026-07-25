/**
 * OCU-16 (#1057) — /opencode/worktrees route contract + worktree event relay.
 *
 * Verifies the REST proxy maps to the engine wrappers with the project
 * directory, the directory guard returns 400, and the stream bridge relays
 * worktree.ready / worktree.failed as typed top-level WS frames.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

const listWorktrees = vi.fn();
const createWorktree = vi.fn();
const removeWorktree = vi.fn();
const resetWorktree = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listWorktrees: (...a: unknown[]) => listWorktrees(...a),
    createWorktree: (...a: unknown[]) => createWorktree(...a),
    removeWorktree: (...a: unknown[]) => removeWorktree(...a),
    resetWorktree: (...a: unknown[]) => resetWorktree(...a),
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('/opencode/worktrees (OCU-16 #1057)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    const { createApp } = await import('../app');
    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('GET / lists worktrees for the project directory', async () => {
    // #1133: the engine's GET /experimental/worktree returns a plain array of
    // directory-path strings (project.sandboxes(projectId)), not
    // {name,branch,directory} objects — verified against the real engine.
    listWorktrees.mockResolvedValue(['/repo/.wt/wt-1']);
    const res = await fetch(`${baseUrl}/opencode/worktrees?directory=${encodeURIComponent('/repo')}`);
    expect(res.status).toBe(200);
    expect(listWorktrees).toHaveBeenCalledWith('/repo');
    const body = (await res.json()) as string[];
    expect(body).toEqual(['/repo/.wt/wt-1']);
  });

  it('GET / without directory → 400', async () => {
    const res = await fetch(`${baseUrl}/opencode/worktrees`);
    expect(res.status).toBe(400);
  });

  it('POST / creates a worktree', async () => {
    createWorktree.mockResolvedValue({ name: 'wt-2', branch: 'feat/y', directory: '/repo/.wt/wt-2' });
    const res = await fetch(`${baseUrl}/opencode/worktrees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: '/repo', name: 'wt-2' }),
    });
    expect(res.status).toBe(200);
    expect(createWorktree).toHaveBeenCalledWith('/repo', { name: 'wt-2', startCommand: undefined });
    expect(((await res.json()) as { name: string }).name).toBe('wt-2');
  });

  it('DELETE / removes a worktree (204)', async () => {
    listWorktrees.mockResolvedValue(['/repo/.wt/wt-2']);
    removeWorktree.mockResolvedValue(true);
    const res = await fetch(`${baseUrl}/opencode/worktrees`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: '/repo', worktreeDir: '/repo/.wt/wt-2' }),
    });
    expect(res.status).toBe(204);
    expect(removeWorktree).toHaveBeenCalledWith('/repo', '/repo/.wt/wt-2');
  });

  it('POST /reset resets a worktree', async () => {
    listWorktrees.mockResolvedValue(['/repo/.wt/wt-2']);
    resetWorktree.mockResolvedValue(true);
    const res = await fetch(`${baseUrl}/opencode/worktrees/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: '/repo', worktreeDir: '/repo/.wt/wt-2' }),
    });
    expect(res.status).toBe(200);
    expect(resetWorktree).toHaveBeenCalledWith('/repo', '/repo/.wt/wt-2');
  });

  // #1133 — worktreeDir must be a worktree the engine ACTUALLY registered for
  // `directory` (validated against GET /experimental/worktree, i.e.
  // opencodeClient.listWorktrees) before proxying to the engine's destructive
  // remove/reset endpoints.
  //
  // Root-cause history (2 repairs):
  //   1. First attempt required worktreeDir to be lexically/realpath-*inside*
  //      `directory`. WRONG predicate — the fork creates worktrees under a
  //      global app-data root keyed by project id
  //      (Global.Path.data/worktree/<projectId>/<name>), never nested under
  //      `directory`, so that check rejected every real worktree.
  //   2. Second attempt validated against listWorktrees()'s `.directory`
  //      field. STILL wrong — verified against the real running engine (curl)
  //      that GET /experimental/worktree returns a plain array of directory
  //      STRINGS (project.sandboxes(projectId)), not
  //      {name,branch,directory} objects, so `.directory` was `undefined` on
  //      every entry and nothing ever matched. Fixed opencodeClient.listWorktrees's
  //      return type to `string[]` and compare entries directly.
  describe('worktreeDir registered-worktree validation (#1133)', () => {
    let directory: string;
    let outside: string;
    let escapeLink: string;
    // Mirrors where the engine ACTUALLY puts worktrees: a global root that is
    // NOT nested under `directory`.
    let engineWorktreeRoot: string;

    beforeEach(() => {
      directory = realpathSync(mkdtempSync(join(tmpdir(), 'wt-routes-dir-')));
      outside = realpathSync(mkdtempSync(join(tmpdir(), 'wt-routes-outside-')));
      engineWorktreeRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wt-routes-engine-root-')));
      escapeLink = join(directory, 'escape');
      symlinkSync(outside, escapeLink);
      // Default: engine has no registered worktrees for `directory`.
      listWorktrees.mockResolvedValue([]);
    });

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      rmSync(engineWorktreeRoot, { recursive: true, force: true });
    });

    it('DELETE / rejects a worktreeDir reached via an in-root symlink pointing outside (not a registered worktree)', async () => {
      const res = await fetch(`${baseUrl}/opencode/worktrees`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: escapeLink }),
      });
      expect(res.status).toBe(400);
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it('POST /reset rejects the same escape', async () => {
      const res = await fetch(`${baseUrl}/opencode/worktrees/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: escapeLink }),
      });
      expect(res.status).toBe(400);
      expect(resetWorktree).not.toHaveBeenCalled();
    });

    it('DELETE / rejects an arbitrary real directory the engine never registered as a worktree', async () => {
      const randomDir = realpathSync(mkdtempSync(join(tmpdir(), 'wt-routes-random-')));
      try {
        const res = await fetch(`${baseUrl}/opencode/worktrees`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ directory, worktreeDir: randomDir }),
        });
        expect(res.status).toBe(400);
        expect(removeWorktree).not.toHaveBeenCalled();
      } finally {
        rmSync(randomDir, { recursive: true, force: true });
      }
    });

    it('DELETE / allows a genuine engine worktree even though it lives OUTSIDE directory (the actual #1133 fix)', async () => {
      const legit = join(engineWorktreeRoot, 'wt-real');
      mkdirSync(legit, { recursive: true });
      listWorktrees.mockResolvedValue([legit]);
      removeWorktree.mockResolvedValue(true);
      const res = await fetch(`${baseUrl}/opencode/worktrees`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: legit }),
      });
      expect(res.status).toBe(204);
      expect(listWorktrees).toHaveBeenCalledWith(directory);
      expect(removeWorktree).toHaveBeenCalledWith(directory, legit);
    });

    it('POST /reset allows a genuine engine worktree living outside directory', async () => {
      const legit = join(engineWorktreeRoot, 'wt-real-2');
      mkdirSync(legit, { recursive: true });
      listWorktrees.mockResolvedValue([legit]);
      resetWorktree.mockResolvedValue(true);
      const res = await fetch(`${baseUrl}/opencode/worktrees/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: legit }),
      });
      expect(res.status).toBe(200);
      expect(resetWorktree).toHaveBeenCalledWith(directory, legit);
    });

    // Regression for the exact shape observed against the real running
    // engine: sandboxes() can list BOTH the raw path create() returns AND a
    // canonical duplicate (macOS /var vs /private/var symlink) added later
    // by the worktree's own async bootstrap. create() hands the RAW
    // (non-canonical) form back to the client, so the DELETE request's
    // worktreeDir is the raw form — it must match even when the list also
    // contains a differently-spelled (but equally real) canonical entry.
    it('DELETE / matches when worktreeDir is a raw (symlinked) alias of a listed canonical entry', async () => {
      const real = join(engineWorktreeRoot, 'wt-real-3');
      mkdirSync(real, { recursive: true });
      const aliasRoot = join(engineWorktreeRoot, '..', 'wt-routes-alias-root');
      symlinkSync(engineWorktreeRoot, aliasRoot);
      const rawWorktreeDir = join(aliasRoot, 'wt-real-3'); // same real file, spelled via the symlink

      listWorktrees.mockResolvedValue([real]); // engine lists the canonical form
      removeWorktree.mockResolvedValue(true);
      const res = await fetch(`${baseUrl}/opencode/worktrees`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: rawWorktreeDir }),
      });
      expect(res.status).toBe(204);
      expect(removeWorktree).toHaveBeenCalledWith(directory, rawWorktreeDir);
      rmSync(aliasRoot, { force: true });
    });
  });
});

// ── worktree event relay (bridge) ────────────────────────────────────────────

const { broadcastSpy } = vi.hoisted(() => ({ broadcastSpy: vi.fn() }));
vi.mock('../services/ws_gateway', () => ({
  broadcast: (m: unknown) => broadcastSpy(m),
  broadcastSessionUpdated: vi.fn(),
}));

describe('OCU-16 worktree event relay', () => {
  beforeEach(() => {
    setDb(makeDb());
    broadcastSpy.mockClear();
  });

  it('relays worktree.ready as a typed top-level WS frame', async () => {
    const { OpencodeStreamBridge } = await import('../services/opencode_stream_bridge');
    const bridge = new OpencodeStreamBridge();
    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'worktree.ready',
      properties: { name: 'wt-9', branch: 'feat/z' },
    });
    expect(broadcastSpy).toHaveBeenCalledWith({
      v: 1,
      type: 'worktree.ready',
      name: 'wt-9',
      branch: 'feat/z',
    });
  });

  it('relays worktree.failed as a typed top-level WS frame', async () => {
    const { OpencodeStreamBridge } = await import('../services/opencode_stream_bridge');
    const bridge = new OpencodeStreamBridge();
    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'worktree.failed',
      properties: { message: 'not a git repo' },
    });
    expect(broadcastSpy).toHaveBeenCalledWith({
      v: 1,
      type: 'worktree.failed',
      message: 'not a git repo',
    });
  });

  // OCU-22 (#1063) — same relay mechanism, verified alongside the worktree ones.
  it('relays vcs.branch.updated as a typed top-level WS frame', async () => {
    const { OpencodeStreamBridge } = await import('../services/opencode_stream_bridge');
    const bridge = new OpencodeStreamBridge();
    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'vcs.branch.updated',
      properties: { branch: 'feat/new' },
    });
    expect(broadcastSpy).toHaveBeenCalledWith({ v: 1, type: 'vcs.branch.updated', branch: 'feat/new' });
  });
});
