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
    listWorktrees.mockResolvedValue([{ name: 'wt-1', branch: 'feat/x', directory: '/repo/.wt/wt-1' }]);
    const res = await fetch(`${baseUrl}/opencode/worktrees?directory=${encodeURIComponent('/repo')}`);
    expect(res.status).toBe(200);
    expect(listWorktrees).toHaveBeenCalledWith('/repo');
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body[0].name).toBe('wt-1');
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
    resetWorktree.mockResolvedValue(true);
    const res = await fetch(`${baseUrl}/opencode/worktrees/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: '/repo', worktreeDir: '/repo/.wt/wt-2' }),
    });
    expect(res.status).toBe(200);
    expect(resetWorktree).toHaveBeenCalledWith('/repo', '/repo/.wt/wt-2');
  });

  // #1133 — worktreeDir must be validated as actually inside `directory`
  // (realpath-canonicalized) before proxying to the engine's destructive
  // remove/reset endpoints; a symlink living inside `directory` must not be
  // able to point the engine at an arbitrary outside directory.
  describe('worktreeDir containment (#1133)', () => {
    let directory: string;
    let outside: string;
    let escapeLink: string;

    beforeEach(() => {
      directory = realpathSync(mkdtempSync(join(tmpdir(), 'wt-routes-dir-')));
      outside = realpathSync(mkdtempSync(join(tmpdir(), 'wt-routes-outside-')));
      escapeLink = join(directory, 'escape');
      symlinkSync(outside, escapeLink);
    });

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    });

    it('DELETE / rejects a worktreeDir reached via an in-root symlink pointing outside', async () => {
      const res = await fetch(`${baseUrl}/opencode/worktrees`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: escapeLink }),
      });
      expect(res.status).toBe(400);
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it('POST /reset rejects a worktreeDir reached via an in-root symlink pointing outside', async () => {
      const res = await fetch(`${baseUrl}/opencode/worktrees/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: escapeLink }),
      });
      expect(res.status).toBe(400);
      expect(resetWorktree).not.toHaveBeenCalled();
    });

    it('DELETE / allows a legitimate worktreeDir inside directory (no false lockout)', async () => {
      const legit = join(directory, '.wt', 'wt-real');
      mkdirSync(legit, { recursive: true });
      removeWorktree.mockResolvedValue(true);
      const res = await fetch(`${baseUrl}/opencode/worktrees`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory, worktreeDir: legit }),
      });
      expect(res.status).toBe(204);
      expect(removeWorktree).toHaveBeenCalledWith(directory, legit);
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
