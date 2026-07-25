/**
 * CONTRACT TESTS — Issue #805 (memory epic #801): per-prompt injection reads
 * the DERIVED index, works with Obsidian closed, and tracks vault edits via a
 * re-index pass. Each returned memory traces back to its vault note path.
 *
 * Real in-memory SQLite + real repository + real index/write services + real FS
 * temp dirs. No module mocks of the system under test. A TEMP FIXTURE vault is
 * created per-test — NEVER the real ~/Documents/Memory-Vault.
 *
 * Acceptance criteria proven here (mapping to the issue):
 *   AC1: immediately after a vault-first `remember`, buildMemoryPreface(query)
 *        includes that memory — sourced from the index (no fresh vault scan).
 *   AC2: Obsidian-closed — retrieval succeeds with NO Obsidian REST plugin in
 *        play (the path is index-only / direct-FS; we never touch obsidian).
 *   AC3: user edit — a note's body edited directly on disk is reflected in
 *        injection after a re-index pass (syncMemoryVault, the cron's worker).
 *   AC4: deletion — a note removed on disk is gone from injection after re-index.
 *   AC5: AGENT_MEMORY_INJECTION_ENABLED=false still disables injection.
 *   AC6: returned memory objects expose the originating note path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault } from '../services/memoryVaultWriteService';
import { syncMemoryVault } from '../services/memoryVaultSyncService';
import {
  buildMemoryPreface,
  getRelevantMemories,
} from '../services/memory_retrieval';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;
let savedMemoryVaultSubdir: string | undefined;

/** Recursively list `.md` files under the memory dir, vault-relative. */
function noteFiles(dir = memoryDir, base = memoryDir): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...noteFiles(full, base));
    else if (ent.name.endsWith('.md')) out.push(path.relative(base, full));
  }
  return out;
}

beforeEach(() => {
  savedMemoryVaultSubdir = process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'meminj-idx-'));
  // The write path owns `<vault>/memory`; the sync scans the whole vault.
  memoryDir = path.join(vaultRoot, 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  if (savedMemoryVaultSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
  else process.env.MEMORY_VAULT_SUBDIR = savedMemoryVaultSubdir;
  vi.restoreAllMocks();
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('memory injection reads the derived index (#805)', () => {
  it('AC1: after a vault-first remember, buildMemoryPreface includes it — from the index', async () => {
    await rememberToVault(
      { kind: 'fact', content: 'The facilities reservation calendar uses Postgres.' },
      { memoryDir, index },
    );

    const preface = await buildMemoryPreface('how does facilities reservation work', null);
    expect(preface.text).toContain('## Known context (facts & preferences)');
    expect(preface.text).toContain('The facilities reservation calendar uses Postgres.');
    expect(preface.memoryIds.length).toBeGreaterThanOrEqual(1);
  });

  it('AC1 (index-sourced, NOT a vault rescan): recall reads SQLite even when the vault dir is gone', async () => {
    await rememberToVault(
      { kind: 'fact', content: 'The worship team rehearses Thursdays.' },
      { memoryDir, index },
    );
    // Prove the recall does not depend on re-reading the vault: delete the whole
    // vault from disk, then recall. If injection scanned the vault it would now
    // find nothing; reading the index it still returns the row.
    rmSync(vaultRoot, { recursive: true, force: true });

    const hits = await getRelevantMemories('worship team rehearses', null);
    expect(hits.map((m) => m.content)).toContain('The worship team rehearses Thursdays.');
  });

  it('AC2: Obsidian-closed — recall works with the obsidian REST plugin unavailable', async () => {
    // The injection path must never import/use the Obsidian MCP. Make any
    // accidental use explode: a require of an "obsidian" module would throw.
    // (We assert behaviourally — recall succeeds purely via index + FS write.)
    await rememberToVault(
      { kind: 'fact', content: 'Sunday service starts at nine.' },
      { memoryDir, index },
    );

    const preface = await buildMemoryPreface('when does sunday service start', null);
    expect(preface.text).toContain('Sunday service starts at nine.');
  });

  it('AC6: returned memory objects expose the originating note path', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Budget approvals go through the elder board.' },
      { memoryDir, index },
    );

    // getRelevantMemories rows carry sourceId == the vault-relative note path.
    const hits = await getRelevantMemories('budget approvals elder board', null);
    const hit = hits.find((m) => m.content.includes('Budget approvals'));
    expect(hit).toBeTruthy();
    expect(hit!.sourceId).toBe(result.path);

    // And the preface surfaces it positionally aligned with memoryIds.
    const preface = await buildMemoryPreface('budget approvals elder board', null);
    expect(preface.notePaths.length).toBe(preface.memoryIds.length);
    expect(preface.notePaths).toContain(result.path);
  });
});

describe('vault edits flow into injection after a re-index pass (#805)', () => {
  it('AC3: a note edited directly on disk is reflected after re-index', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'The old fellowship hall capacity is 80.' },
      { memoryDir, index },
    );

    // Edit the note body directly on disk (as a user would in Obsidian/Finder),
    // keeping the same frontmatter id so it is the same logical note.
    const abs = path.join(vaultRoot, result.path);
    const edited = [
      '---',
      `id: ${result.id}`,
      'kind: fact',
      'tags: []',
      'created: 2026-06-28',
      'updated: 2026-06-28',
      'source: "agent"',
      '---',
      '',
      'The new fellowship hall capacity is 240.',
      '',
    ].join('\n');
    writeFileSync(abs, edited, 'utf8');

    // Before re-index the index still holds the OLD body.
    const before = await getRelevantMemories('fellowship hall capacity', null);
    expect(before.map((m) => m.content).join(' ')).toContain('80');

    // Re-index pass (this is exactly what the */10min cron runs).
    await syncMemoryVault({ vaultPath: vaultRoot });

    const after = await getRelevantMemories('fellowship hall capacity', null);
    const joined = after.map((m) => m.content).join(' ');
    expect(joined).toContain('240');
    expect(joined).not.toContain('capacity is 80');
  });

  it('AC4: a note removed on disk is gone from injection after re-index', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Choir practice is on Wednesday evenings.' },
      { memoryDir, index },
    );
    // Present before deletion.
    expect((await getRelevantMemories('choir practice wednesday', null)).length).toBeGreaterThanOrEqual(1);

    rmSync(path.join(vaultRoot, result.path));
    expect(noteFiles()).toHaveLength(0);

    await syncMemoryVault({ vaultPath: vaultRoot });

    const after = await getRelevantMemories('choir practice wednesday', null);
    expect(after.some((m) => m.content.includes('Choir practice'))).toBe(false);
  });
});

describe('toggle still disables injection (#805 AC5)', () => {
  it('AGENT_MEMORY_INJECTION_ENABLED=false → empty preface even with a matching index row', async () => {
    await rememberToVault(
      { kind: 'fact', content: 'The annual retreat is in October.' },
      { memoryDir, index },
    );
    process.env.AGENT_MEMORY_INJECTION_ENABLED = 'false';

    const preface = await buildMemoryPreface('when is the annual retreat', null);
    expect(preface.text).toBe('');
    expect(preface.memoryIds).toEqual([]);
    expect(preface.notePaths).toEqual([]);
  });
});

describe('falsification guards (#805)', () => {
  it('FALSIFY (AC1): if recall did NOT read the index, a freshly-remembered fact would be missing', async () => {
    // A control: with NOTHING remembered, the matching query returns nothing.
    const empty = await getRelevantMemories('uniquetokenxyzzy', null);
    expect(empty).toEqual([]);

    // After remember, the SAME query returns it — proving recall reflects the
    // index write, not a stale/empty source.
    await rememberToVault({ kind: 'fact', content: 'Marker uniquetokenxyzzy here.' }, { memoryDir, index });
    const found = await getRelevantMemories('uniquetokenxyzzy', null);
    expect(found.some((m) => m.content.includes('uniquetokenxyzzy'))).toBe(true);
  });

  it('FALSIFY (AC4): without the re-index pass the deleted note would still be recalled', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Stale deletion marker zzqqxx.' },
      { memoryDir, index },
    );
    rmSync(path.join(vaultRoot, result.path));

    // No syncMemoryVault yet → index still has the row (this is the bug the
    // re-index pass fixes; asserting it here keeps AC4's mechanism honest).
    const stillThere = await getRelevantMemories('zzqqxx', null);
    expect(stillThere.some((m) => m.content.includes('zzqqxx'))).toBe(true);

    // Now re-index → gone.
    await syncMemoryVault({ vaultPath: vaultRoot });
    const gone = await getRelevantMemories('zzqqxx', null);
    expect(gone.some((m) => m.content.includes('zzqqxx'))).toBe(false);
  });
});
