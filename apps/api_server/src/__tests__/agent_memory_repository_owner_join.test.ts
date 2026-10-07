import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import * as database from '../database/db';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { env, resolveMemoryDirPath } from '../config/env';
import { EngraphHttpClient } from '../services/engraph_client';
import {
  buildMemoryPreface,
  getRelevantMemoriesSemantic,
  searchMemoryReferences,
} from '../services/memory_retrieval';
import {
  AgentMemoryRepository,
  type AgentMemory,
} from '../repositories/agent_memory_repository';

const MEMORY_ENV_KEYS = [
  'HOME',
  'MEMORY_VAULT_PATH',
  'MEMORY_VAULT_SUBDIR',
  'ENGRAPH_MEMORY_VAULT_ROOT',
] as const;

const CANONICAL_CONTENT =
  'For church announcements, reuse verified clips when details remain incomplete. Confirm every posted time before sharing.';

const GENERIC_ANNOUNCEMENT_QUERY = (
  'Read this church announcement request carefully and provide only a concise summary of approved communication preferences; do not make edits, send messages, or contact anyone. '
).repeat(3).slice(0, 324);

let db: Database.Database;
let previousDb: Database.Database | null;
let previousDbClient: 'sqlite' | 'postgres';
let repo: AgentMemoryRepository;
let scratchRoot: string;
let savedEnv: Record<(typeof MEMORY_ENV_KEYS)[number], string | undefined>;

async function seedMemory(input: {
  source?: string;
  sourceId: string;
  content?: string;
  ownerUserId?: number;
  autoInjectable?: boolean;
}): Promise<AgentMemory> {
  const row = {
    kind: 'preference',
    content: input.content ?? CANONICAL_CONTENT,
    source: input.source ?? 'obsidian-memory',
    sourceId: input.sourceId,
    autoInjectable: input.autoInjectable ?? true,
  };
  return input.ownerUserId === undefined
    ? repo.createAsync(row)
    : repo.createAsync({ ...row, ownerUserId: input.ownerUserId });
}

function writeCanonicalMemory(sourceId: string, content: string): void {
  const file = path.join(resolveMemoryDirPath(), sourceId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `---\nkind: preference\nstatus: stable\ninjectable: true\n---\n${content}\n`,
  );
}

beforeEach(() => {
  savedEnv = Object.fromEntries(
    MEMORY_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof MEMORY_ENV_KEYS)[number], string | undefined>;
  scratchRoot = mkdtempSync(path.join(tmpdir(), 'agent-memory-owner-join-'));
  process.env.HOME = path.join(scratchRoot, 'home');
  mkdirSync(process.env.HOME, { recursive: true });
  delete process.env.MEMORY_VAULT_PATH;
  delete process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.ENGRAPH_MEMORY_VAULT_ROOT;

  previousDbClient = env.dbClient;
  (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'sqlite';
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare('INSERT INTO users (id, name, email) VALUES (1, ?, ?), (2, ?, ?)').run(
    'Synthetic owner one',
    'owner-one@example.invalid',
    'Synthetic owner two',
    'owner-two@example.invalid',
  );
  previousDb = setDb(db);
  repo = new AgentMemoryRepository();
});

afterEach(() => {
  setDb(previousDb);
  db.close();
  (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = previousDbClient;
  for (const key of MEMORY_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratchRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('AgentMemoryRepository canonical owner/global joins', () => {
  it('uses actual SQLite SQL for canonical own-plus-global rows without widening other sources', async () => {
    const globalVault = await seedMemory({ sourceId: 'preference/global.md' });
    const ownVault = await seedMemory({ sourceId: 'preference/own.md', ownerUserId: 1 });
    const foreignVault = await seedMemory({ sourceId: 'preference/foreign.md', ownerUserId: 2 });
    const duplicateGlobal = await seedMemory({ sourceId: 'preference/duplicate.md' });
    const duplicateOwn = await seedMemory({ sourceId: 'preference/duplicate.md', ownerUserId: 1 });
    const globalOther = await seedMemory({ source: 'imported-memory', sourceId: 'other/global.md' });
    const ownOther = await seedMemory({ source: 'imported-memory', sourceId: 'other/own.md', ownerUserId: 1 });
    await seedMemory({ source: 'imported-memory', sourceId: 'other/foreign.md', ownerUserId: 2 });

    const authenticatedVault = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [globalVault.sourceId!, ownVault.sourceId!, foreignVault.sourceId!],
      1,
    );
    expect(authenticatedVault.map(({ id }) => id)).toEqual(
      expect.arrayContaining([globalVault.id, ownVault.id]),
    );
    expect(authenticatedVault.map(({ id }) => id)).not.toContain(foreignVault.id);

    const unknownVault = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [globalVault.sourceId!, ownVault.sourceId!, foreignVault.sourceId!],
    );
    expect(unknownVault.map(({ id }) => id)).toEqual([globalVault.id]);
    const nullVault = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [globalVault.sourceId!, ownVault.sourceId!, foreignVault.sourceId!],
      null as unknown as number,
    );
    expect(nullVault.map(({ id }) => id)).toEqual([globalVault.id]);

    const authenticatedOther = await repo.findBySourceIdsAsync(
      'imported-memory',
      [globalOther.sourceId!, ownOther.sourceId!, 'other/foreign.md'],
      1,
    );
    expect(authenticatedOther.map(({ id }) => id)).toEqual([ownOther.id]);
    await expect(repo.findBySourceIdsAsync('imported-memory', [globalOther.sourceId!]))
      .resolves.toMatchObject([{ id: globalOther.id }]);
    await expect(repo.findBySourceIdsAsync(
      'imported-memory',
      [globalOther.sourceId!, ownOther.sourceId!],
      null as unknown as number,
    )).resolves.toMatchObject([{ id: globalOther.id }]);

    const ambiguous = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      [duplicateGlobal.sourceId!],
      1,
    );
    expect(ambiguous.map(({ id }) => id)).toEqual(
      expect.arrayContaining([duplicateGlobal.id, duplicateOwn.id]),
    );
    expect(ambiguous).toHaveLength(2);

    await expect(repo.findBySourceIdsAsync('obsidian-memory', [], 1)).resolves.toEqual([]);
    await expect(repo.findBySourceIdsAsync(
      "obsidian-memory' OR 1=1 --",
      [globalVault.sourceId!],
      1,
    )).resolves.toEqual([]);
    await expect(repo.findBySourceIdsAsync(
      'obsidian-memory',
      ["preference/global.md') OR 1=1 --"],
      1,
    )).resolves.toEqual([]);
  });

  it('keeps the Postgres source and owner predicates bound and source-specific', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const poolSpy = vi.spyOn(database, 'getPostgresPool').mockReturnValue({ query } as never);
    (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'postgres';

    try {
      await repo.findBySourceIdsAsync('obsidian-memory', ['preference/global.md'], 1);
      const [vaultSql, vaultParams] = query.mock.calls[0] as [string, unknown[]];
      expect(vaultSql).toContain('source = $1 AND source_id = ANY($2::text[])');
      expect(vaultSql).toContain('(owner_user_id = $3 OR owner_user_id IS NULL)');
      expect(vaultSql).not.toContain('obsidian-memory');
      expect(vaultParams).toEqual(['obsidian-memory', ['preference/global.md'], 1]);

      query.mockClear();
      await repo.findBySourceIdsAsync('imported-memory', ['other/own.md'], 1);
      const [otherSql, otherParams] = query.mock.calls[0] as [string, unknown[]];
      expect(otherSql).toContain('AND owner_user_id = $3');
      expect(otherSql).not.toContain('OR owner_user_id IS NULL');
      expect(otherParams).toEqual(['imported-memory', ['other/own.md'], 1]);

      query.mockClear();
      await repo.findBySourceIdsAsync('obsidian-memory', ['preference/global.md']);
      const [unknownSql, unknownParams] = query.mock.calls[0] as [string, unknown[]];
      expect(unknownSql).toContain('AND owner_user_id IS NULL');
      expect(unknownParams).toEqual(['obsidian-memory', ['preference/global.md']]);

      query.mockClear();
      await repo.findBySourceIdsAsync(
        'imported-memory',
        ['other/global.md'],
        null as unknown as number,
      );
      const [nullSql, nullParams] = query.mock.calls[0] as [string, unknown[]];
      expect(nullSql).toContain('AND owner_user_id IS NULL');
      expect(nullSql).not.toContain('$3');
      expect(nullParams).toEqual(['imported-memory', ['other/global.md']]);
    } finally {
      poolSpy.mockRestore();
      (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'sqlite';
    }
  });

  it('carries a global canonical vault row through synthetic native HTTP, SQL, receipt, and fenced preface assembly', async () => {
    expect(CANONICAL_CONTENT).toHaveLength(120);
    expect(GENERIC_ANNOUNCEMENT_QUERY).toHaveLength(324);
    const sourceId = 'preference/announcement slides/verified clips with spaces.md';
    const foreignSourceId = 'preference/foreign owner.md';
    const foreignContent = 'Foreign owner content must remain unavailable to another authenticated user in this synthetic regression case.';
    const global = await seedMemory({ sourceId });
    await seedMemory({
      sourceId: foreignSourceId,
      content: foreignContent,
      ownerUserId: 2,
    });
    writeCanonicalMemory(sourceId, CANONICAL_CONTENT);
    writeCanonicalMemory(foreignSourceId, foreignContent);

    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { file_path: 'preference/heading-only synthesis.md', snippet: '# Announcement preference' },
        {
          file_path: sourceId,
          snippet: `## <b>Announcement guidance</b>\n${CANONICAL_CONTENT} ...`,
        },
        { file_path: foreignSourceId, snippet: foreignContent },
      ],
    }), { status: 200 }));
    const selected = await getRelevantMemoriesSemantic(
      GENERIC_ANNOUNCEMENT_QUERY,
      1,
      2,
      repo,
      new EngraphHttpClient('http://127.0.0.1:7777', fetchImpl),
    );

    expect(resolveMemoryDirPath()).toBe(
      path.join(process.env.HOME!, 'Documents', 'Obsidian Vault', 'AGENT-MEMORY'),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const nativeRequest = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string);
    expect(nativeRequest).toMatchObject({ top_n: 20 });
    expect(nativeRequest.query).toEqual(expect.any(String));
    expect(nativeRequest.query.length).toBeLessThanOrEqual(128);
    expect(nativeRequest.query).toContain('church');
    expect(nativeRequest.query).toContain('announcement');
    expect(nativeRequest.query).not.toBe(GENERIC_ANNOUNCEMENT_QUERY);
    expect(selected).toMatchObject([{
      id: global.id,
      ownerUserId: null,
      status: 'stable',
      autoInjectable: true,
    }]);

    const preface = await buildMemoryPreface(GENERIC_ANNOUNCEMENT_QUERY, 1, {
      enabled: true,
      getRelevant: async (query, ownerUserId) => {
        expect(query).toBe(GENERIC_ANNOUNCEMENT_QUERY);
        expect(ownerUserId).toBe(1);
        return selected;
      },
    });

    expect(preface.memoryIds).toEqual([global.id]);
    expect(preface.text).toContain('## Retrieved memory references');
    expect(preface.text).toContain('<<<UNTRUSTED_EXTERNAL_CONTENT>>>');
    expect(preface.text).toContain('<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>');
    expect(preface.text).toContain(`[${sourceId}]`);
    expect(preface.text.length).toBeLessThanOrEqual(1200);
    expect(Math.ceil(preface.text.length / 4)).toBeLessThanOrEqual(300);
  });

  it('retains the canonical-file guard after the actual global-row SQL join', async () => {
    const sourceId = 'preference/changed canonical.md';
    await seedMemory({ sourceId });
    writeCanonicalMemory(sourceId, 'Canonical bytes changed after the derived row was indexed.');
    const client = new EngraphHttpClient(
      'http://127.0.0.1:7777',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        results: [{ file_path: sourceId, snippet: CANONICAL_CONTENT }],
      }), { status: 200 })),
    );

    await expect(repo.findBySourceIdsAsync('obsidian-memory', [sourceId], 1))
      .resolves.toMatchObject([{ sourceId, ownerUserId: null }]);
    await expect(searchMemoryReferences(GENERIC_ANNOUNCEMENT_QUERY, 1, {
      repo,
      engraph: client,
    })).resolves.toMatchObject({ references: [] });
  });
});
