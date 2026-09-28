/** #1569 S5 acceptance: only synthetic vaults and a temporary HOME. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
  statSync,
  promises as fs,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import {
  deprecateMemory, forgetFromVault, rememberToVault, updateMemoryInVault, verifyMemory,
} from '../services/memoryVaultWriteService';
import { regenerateMemoryVaultNavigation } from '../services/memory_vault_index_writer';
import { scanVaultNotes, syncMemoryVault } from '../services/memoryVaultSyncService';

let root: string;
let vault: string;
let memoryDir: string;
let db: Database.Database;
let index: MemoryIndexService;
const savedEnv = { HOME: process.env.HOME, MEMORY_VAULT_PATH: process.env.MEMORY_VAULT_PATH,
  MEMORY_VAULT_SUBDIR: process.env.MEMORY_VAULT_SUBDIR };

function absolute(sourceId: string): string { return path.join(vault, sourceId); }
function bytes(sourceId: string): string { return readFileSync(absolute(sourceId), 'utf8'); }
function restoreEnv(name: keyof typeof savedEnv): void {
  if (savedEnv[name] === undefined) delete process.env[name];
  else process.env[name] = savedEnv[name];
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'issue-1569-s5-'));
  vault = path.join(root, 'vault');
  memoryDir = path.join(vault, 'memory');
  mkdirSync(memoryDir, { recursive: true });
  process.env.HOME = path.join(root, 'home');
  process.env.MEMORY_VAULT_PATH = vault;
  process.env.MEMORY_VAULT_SUBDIR = 'memory';
  mkdirSync(process.env.HOME, { recursive: true });
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  index = new MemoryIndexService(new AgentMemoryRepository());
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  restoreEnv('HOME'); restoreEnv('MEMORY_VAULT_PATH'); restoreEnv('MEMORY_VAULT_SUBDIR');
  rmSync(root, { recursive: true, force: true });
});

async function expectExternalEditPreserved(
  sourceId: string,
  run: (beforeNotePromotion: () => Promise<void>) => Promise<unknown>,
  requested: string,
): Promise<void> {
  const external = '\nExternal Hermes edit must survive.\n';
  let calls = 0;
  let conflict = false;
  try {
    await run(async () => {
      if (calls++ === 0) writeFileSync(absolute(sourceId), bytes(sourceId) + external);
    });
  } catch (error) {
    conflict = true;
    expect(String((error as { code?: string }).code ?? error)).toContain('MEMORY_NOTE_CONFLICT');
  }
  const final = bytes(sourceId);
  expect(final).toContain(external.trim());
  if (!conflict) expect(final).toContain(requested);
}

describe('#1569 S5 external writer safety', () => {
  it.each(['update', 'lifecycle', 'merge'] as const)(
    's5-c1: %s preserves an external edit made after the read', async (operation) => {
      const created = await rememberToVault({ kind: 'fact', content: `${operation} target.` }, { memoryDir, index });
      await expectExternalEditPreserved(created.path, (beforeNotePromotion) =>
        operation === 'update'
          ? updateMemoryInVault(created.id, { content: 'Updated by Rhythm.' }, { memoryDir, index, beforeNotePromotion })
          : operation === 'lifecycle'
            ? verifyMemory(created.path, 'human:fixture', { memoryDir, index, beforeNotePromotion })
            : rememberToVault({ kind: 'fact', id: created.id, content: 'Merged by Rhythm.' },
              { memoryDir, index, beforeNotePromotion }),
      operation === 'update' ? 'Updated by Rhythm.' : operation === 'lifecycle' ? 'verified:' : 'Merged by Rhythm.');
    },
  );

  it('s5-c1: forget preserves a managed note externally edited before deletion', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Managed deletion target.' }, { memoryDir, index },
    );
    const original = bytes(created.path);
    const external = `${original}\nExternal Hermes edit must survive.\n`;
    await expect(forgetFromVault(created.path, {
      memoryDir, index,
      beforeNoteDeletion: async () => { writeFileSync(absolute(created.path), external); },
    })).rejects.toThrow('MEMORY_NOTE_CONFLICT');
    expect(bytes(created.path)).toBe(external);
    expect((await scanVaultNotes(vault)).some((entry) => entry.sourceId === created.path)).toBe(true);
  });

  it('s5-c1: kind move refuses an edited source before publishing a duplicate', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Managed kind move target.' }, { memoryDir, index },
    );
    const log = path.join(memoryDir, 'log.md');
    const beforeLog = readFileSync(log, 'utf8');
    const external = `${bytes(created.path)}\nExternal source change.\n`;
    await expect(updateMemoryInVault(created.id, { kind: 'preference' }, {
      memoryDir, index,
      beforeNotePromotion: async () => { writeFileSync(absolute(created.path), external); },
    })).rejects.toThrow('MEMORY_NOTE_CONFLICT');
    expect(bytes(created.path)).toBe(external);
    expect((await scanVaultNotes(vault)).map((entry) => entry.sourceId)).toEqual([created.path]);
    expect(readFileSync(log, 'utf8')).toBe(beforeLog);
  });

  it('s5-c1: kind move removes only its own new note on a late source conflict', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Late kind move target.' }, { memoryDir, index },
    );
    const beforeLog = readFileSync(path.join(memoryDir, 'log.md'), 'utf8');
    const external = `${bytes(created.path)}\nLate external source change.\n`;
    await expect(updateMemoryInVault(created.id, { kind: 'preference' }, {
      memoryDir, index,
      afterNotePromotion: async () => { writeFileSync(absolute(created.path), external); },
    })).rejects.toThrow('MEMORY_NOTE_CONFLICT');
    expect(bytes(created.path)).toBe(external);
    expect((await scanVaultNotes(vault)).map((entry) => entry.sourceId)).toEqual([created.path]);
    expect(readFileSync(path.join(memoryDir, 'log.md'), 'utf8')).toBe(beforeLog);
  });

  it('s5-c3: a managed CRLF-frontmatter note remains eligible for lifecycle mutation', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Managed Windows-line-ending note.' }, { memoryDir, index },
    );
    writeFileSync(absolute(created.path), bytes(created.path).replace(/\n/g, '\r\n'));
    await expect(verifyMemory(created.path, 'human:fixture', { memoryDir, index }))
      .resolves.toMatchObject({ id: created.id });
  });

  it('s5-c2: an index reader sees the old complete index until the new one is published', async () => {
    const note = path.join(memoryDir, 'fact', 'one.md');
    mkdirSync(path.dirname(note), { recursive: true });
    writeFileSync(note, '---\nkind: fact\n---\nFirst note.\n');
    await regenerateMemoryVaultNavigation(memoryDir);
    const destination = path.join(memoryDir, 'index.md');
    const before = readFileSync(destination, 'utf8');
    writeFileSync(path.join(memoryDir, 'fact', 'two.md'), '---\nkind: fact\n---\nSecond note.\n');

    const originalRename = fs.rename.bind(fs);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const renaming = new Promise<void>((resolve) => { entered = resolve; });
    let intercepted = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
      if (!intercepted && String(args[1]) === destination) {
        intercepted = true;
        entered();
        await held;
      }
      return originalRename(...args);
    });
    const regeneration = regenerateMemoryVaultNavigation(memoryDir);
    const first = await Promise.race([renaming.then(() => 'rename'), regeneration.then(() => 'finished')]);
    try {
      expect(first).toBe('rename');
      expect(readFileSync(destination, 'utf8')).toBe(before);
    } finally {
      release();
    }
    await regeneration;
    expect(readFileSync(destination, 'utf8')).toContain('2 memories');
  });

  it.each(['verify', 'deprecate', 'update', 'forget', 'merge'] as const)(
    's5-c3: untyped note rejects %s and remains discoverable', async (operation) => {
      const sourceId = `memory/fact/unmanaged-${operation}.md`;
      const target = absolute(sourceId);
      mkdirSync(path.dirname(target), { recursive: true });
      const original = `Unmanaged ${operation} note written by a person.\n`;
      writeFileSync(target, original);
      await syncMemoryVault({ vaultPath: vault });
      const action = operation === 'verify' ? verifyMemory(sourceId, 'human:fixture', { memoryDir, index })
        : operation === 'deprecate' ? deprecateMemory(sourceId, 'human:fixture', { memoryDir, index })
        : operation === 'update' ? updateMemoryInVault('missing-id', { content: 'Rhythm replacement.' },
          { memoryDir, index, relPathFallback: `fact/unmanaged-${operation}.md` })
        : operation === 'forget' ? forgetFromVault(sourceId, { memoryDir, index })
        : rememberToVault({ kind: 'fact', content: original.trim() }, { memoryDir, index });
      await expect(action).rejects.toThrow(/MEMORY_NOTE_UNMANAGED/);
      expect(readFileSync(target, 'utf8')).toBe(original);
      expect((await scanVaultNotes(vault)).some((entry) => entry.sourceId === sourceId)).toBe(true);
    },
  );

  it('s5-c4: generated README names owners, stays complete, and preserves a user edit', async () => {
    await regenerateMemoryVaultNavigation(memoryDir);
    const readme = path.join(memoryDir, 'README.md');
    expect(existsSync(readme)).toBe(true);
    const text = readFileSync(readme, 'utf8');
    expect(text).toMatch(/Rhythm-managed|managed notes/i);
    expect(text).toMatch(/unmanaged|user notes/i);
    expect(text).toMatch(/Hermes.*MEMORY\.md|MEMORY\.md.*Hermes/i);
    expect(text).toMatch(/Hermes.*USER\.md|USER\.md.*Hermes/i);
    expect(text).toMatch(/Rhythm.*index\.md|index\.md.*Rhythm/i);
    expect(text).toMatch(/Rhythm.*log\.md|log\.md.*Rhythm/i);
    writeFileSync(readme, `${text}\nUser ownership annotation.\n`);
    await regenerateMemoryVaultNavigation(memoryDir);
    expect(readFileSync(readme, 'utf8')).toContain('User ownership annotation.');
    expect((await scanVaultNotes(vault)).some((entry) => entry.sourceId.endsWith('README.md'))).toBe(false);

    rmSync(readme);
    const originalRename = fs.rename.bind(fs);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const renaming = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(fs, 'rename').mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[1]) === readme) { entered(); await held; }
      return originalRename(...args);
    });
    const regeneration = regenerateMemoryVaultNavigation(memoryDir);
    const first = await Promise.race([renaming.then(() => 'rename'), regeneration.then(() => 'finished')]);
    try {
      expect(first).toBe('rename');
      expect(existsSync(readme)).toBe(false);
    } finally {
      release();
    }
    await regeneration;
    expect(readFileSync(readme, 'utf8')).toMatch(/Rhythm.*index\.md|index\.md.*Rhythm/i);
  });

  it('s5-c5: concurrent same-slug remembers keep both session attributions', async () => {
    const content = 'The synthetic booking calendar belongs to the facilities module.';
    mkdirSync(path.join(memoryDir, 'fact'), { recursive: true });
    await Promise.all([
      rememberToVault({ kind: 'fact', content, sessionId: 'alpha' }, { memoryDir, index }),
      rememberToVault({ kind: 'fact', content, sessionId: 'beta' }, { memoryDir, index }),
    ]);
    const files = (await fs.readdir(path.join(memoryDir, 'fact'))).filter((name) => name.endsWith('.md') && name !== 'index.md');
    expect(files).toHaveLength(1);
    const note = readFileSync(path.join(memoryDir, 'fact', files[0]), 'utf8');
    expect(note).toContain('sess-alpha');
    expect(note).toContain('sess-beta');
  });

  it('s5-c6: index and log are owned aggregates and are excluded from note search', async () => {
    await rememberToVault({ kind: 'fact', content: 'A synthetic ownership note.' }, { memoryDir, index });
    const readme = readFileSync(path.join(memoryDir, 'README.md'), 'utf8');
    expect(readme).toMatch(/Rhythm.*index\.md|index\.md.*Rhythm/i);
    expect(readme).toMatch(/Rhythm.*log\.md|log\.md.*Rhythm/i);
    const sourceIds = (await scanVaultNotes(vault)).map((entry) => entry.sourceId);
    expect(sourceIds.some((id) => /(?:^|\/)index\.md$|(?:^|\/)log\.md$/i.test(id))).toBe(false);
  });

  it('s5-c7: Rhythm lifecycle leaves Hermes MEMORY.md and USER.md at their original paths and bytes', async () => {
    const hermes = path.join(process.env.HOME!, '.hermes', 'memories');
    mkdirSync(hermes, { recursive: true });
    const memory = path.join(hermes, 'MEMORY.md');
    const user = path.join(hermes, 'USER.md');
    writeFileSync(memory, 'Synthetic Hermes working memory.\n');
    writeFileSync(user, 'Synthetic Hermes user profile.\n');
    const before = [readFileSync(memory), readFileSync(user)];
    const originalStats = [statSync(memory), statSync(user)];
    const created = await rememberToVault({ kind: 'fact', content: 'Synthetic Rhythm memory.' }, { memoryDir, index });
    await verifyMemory(created.path, 'human:fixture', { memoryDir, index });
    await updateMemoryInVault(created.id, { content: 'Synthetic Rhythm edit.' }, { memoryDir, index });
    await forgetFromVault(created.path, { memoryDir, index });
    expect(existsSync(memory)).toBe(true);
    expect(existsSync(user)).toBe(true);
    expect(readFileSync(memory)).toEqual(before[0]);
    expect(readFileSync(user)).toEqual(before[1]);
    expect([statSync(memory).ino, statSync(user).ino]).toEqual(originalStats.map((entry) => entry.ino));
    expect([statSync(memory).mtimeMs, statSync(user).mtimeMs]).toEqual(originalStats.map((entry) => entry.mtimeMs));
  });
});
