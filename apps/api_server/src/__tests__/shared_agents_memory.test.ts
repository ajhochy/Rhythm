import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const inodeSwap = vi.hoisted(() => ({
  target: null as string | null,
  backup: null as string | null,
  replacement: '',
  swapped: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      open: async (filePath: Parameters<typeof actual.promises.open>[0], ...args: unknown[]) => {
        const resolved = path.resolve(String(filePath));
        if (inodeSwap.target === resolved && inodeSwap.backup) {
          const target = inodeSwap.target;
          const backup = inodeSwap.backup;
          inodeSwap.target = null;
          await actual.promises.rename(target, backup);
          await actual.promises.writeFile(target, inodeSwap.replacement, 'utf8');
          inodeSwap.swapped = true;
        }
        return (actual.promises.open as (...values: unknown[]) => Promise<unknown>)(
          filePath,
          ...args,
        );
      },
    },
  };
});

const registrarSecret = 'synthetic-shared-agent-memory-registrar';
const registrarHeaders = {
  'Content-Type': 'application/json',
  'X-Rhythm-Bridge-Registrar': registrarSecret,
};

let baseUrl = '';
let server: Server;
let database: Database.Database;
let fixtureRoot = '';
let vaultRoot = '';
let retiredVaultRoot = '';
let modules: {
  setDb(value: Database.Database | null): void;
  resetBridgeGrantsForTest(): void;
  AgentMemoryRepository: new () => {
    upsertBySourceAsync(input: Record<string, unknown>): Promise<boolean>;
  };
  UsersRepository: new () => {
    create(input: { name: string; email: string }): { id: number };
  };
  SessionsRepository: new () => {
    createAsync(userId: number): Promise<{ token: string }>;
  };
};
let primarySessionToken = '';
let primaryCapability = '';
let primaryGrantId = '';
let currentVaultId = '';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function postGrant(input: {
  grantId: string;
  capability: string;
  sessionToken: string;
  scopes: string[];
  memoryVaultId?: string;
}): Promise<Response> {
  return fetch(`${baseUrl}/agent-bridge/v1/registrar/grants`, {
    method: 'POST',
    headers: registrarHeaders,
    body: JSON.stringify({
      grantId: input.grantId,
      capabilitySha256: sha256(input.capability),
      sessionToken: input.sessionToken,
      hermesProfile: 'default',
      runtimeGeneration: '10000000-0000-4000-8000-000000000001',
      serverOrigin: 'http://127.0.0.1:7390',
      authGeneration: 'memory-test-auth-generation',
      scopes: input.scopes,
      ...(input.memoryVaultId === undefined
        ? {}
        : { memoryVaultId: input.memoryVaultId }),
    }),
  });
}

async function searchMemory(
  capability: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/agent-bridge/v1/memory/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Rhythm-Bridge-Capability': capability,
    },
    body: JSON.stringify(body),
  });
}

async function addIndexedNote(input: {
  sourceId: string;
  raw?: string;
  indexedContent: string;
  kind?: string;
  staleAfter?: string | null;
  trustTier?: string;
}): Promise<void> {
  if (input.raw !== undefined) {
    const absolute = path.join(vaultRoot, input.sourceId);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, input.raw, 'utf8');
  }
  const repository = new modules.AgentMemoryRepository();
  await repository.upsertBySourceAsync({
    kind: input.kind ?? 'fact',
    content: input.indexedContent,
    source: 'obsidian-memory',
    sourceId: input.sourceId,
    tagsJson: '[]',
    status: 'stable',
    staleAfter: input.staleAfter ?? null,
    verifiedJson: input.trustTier === 'human'
      ? '[{"by":"memory-test","at":"2026-09-24T00:00:00.000Z"}]'
      : '[]',
    sourcesJson: '[]',
    trustTier: input.trustTier ?? 'unverified',
    ownerUserId: null,
  });
}

async function treeHash(root: string): Promise<string> {
  const hash = createHash('sha256');

  async function visit(relative: string): Promise<void> {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    hash.update(`${relative}\0${stat.mode}\0${stat.size}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(await fs.readlink(absolute));
      return;
    }
    if (stat.isDirectory()) {
      const entries = (await fs.readdir(absolute)).sort();
      for (const entry of entries) {
        await visit(path.join(relative, entry));
      }
      return;
    }
    hash.update(await fs.readFile(absolute));
  }

  await visit('.');
  return hash.digest('hex');
}

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('RHYTHM_ROLE', 'local');
  vi.stubEnv('AGENT_LOCAL', 'true');
  vi.stubEnv('DB_CLIENT', 'sqlite');
  vi.stubEnv('RHYTHM_AGENT_BRIDGE_REGISTRAR_SHA256', sha256(registrarSecret));
  fixtureRoot = await fs.mkdtemp('/private/tmp/rhythm-sa-mem-');
  vaultRoot = path.join(fixtureRoot, 'vault');
  retiredVaultRoot = path.join(fixtureRoot, 'retired-vault');
  await fs.mkdir(vaultRoot, { recursive: true });
  vi.stubEnv('MEMORY_VAULT_PATH', vaultRoot);
  vi.stubEnv('MEMORY_VAULT_SUBDIR', '');

  const [{ setDb }, { runMigrations }, grants, memoryRepository, users, sessions, app] = await Promise.all([
    import('../database/db'),
    import('../database/migrations'),
    import('../shared_agents/bridge_grants'),
    import('../repositories/agent_memory_repository'),
    import('../repositories/users_repository'),
    import('../repositories/sessions_repository'),
    import('../app'),
  ]);
  modules = {
    setDb,
    resetBridgeGrantsForTest: grants.resetBridgeGrantsForTest,
    AgentMemoryRepository: memoryRepository.AgentMemoryRepository,
    UsersRepository: users.UsersRepository,
    SessionsRepository: sessions.SessionsRepository,
  };

  database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  modules.setDb(database);

  const primaryUser = new modules.UsersRepository().create({
    name: 'Memory Owner',
    email: 'shared-memory-owner@example.test',
  });
  primarySessionToken = (await new modules.SessionsRepository().createAsync(primaryUser.id)).token;
  const noScopeUser = new modules.UsersRepository().create({
    name: 'No Memory Scope',
    email: 'shared-memory-no-scope@example.test',
  });
  const noScopeSessionToken = (await new modules.SessionsRepository().createAsync(noScopeUser.id)).token;

  const longTitle = 'T'.repeat(140);
  const longBody = `# ${longTitle}\n\nmemoryneedle ${'x'.repeat(700)}`;
  await addIndexedNote({
    sourceId: 'fact/primary.md',
    raw: longBody,
    indexedContent: longBody,
    kind: 'fact',
    staleAfter: '2999-10-01',
    trustTier: 'human',
  });
  await new modules.AgentMemoryRepository().upsertBySourceAsync({
    kind: 'fact',
    content: 'memoryneedle non-vault row',
    source: 'manual',
    sourceId: 'manual-row',
    tagsJson: '[]',
    status: 'stable',
    ownerUserId: primaryUser.id,
  });

  server = app.createApp().listen(0, '127.0.0.1');
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const vaultResponse = await fetch(`${baseUrl}/agent-bridge/v1/registrar/memory-vault`, {
    headers: { 'X-Rhythm-Bridge-Registrar': registrarSecret },
  });
  expect(vaultResponse.status).toBe(200);
  currentVaultId = ((await vaultResponse.json()) as { memoryVaultId: string }).memoryVaultId;

  primaryCapability = 'synthetic-primary-memory-capability';
  primaryGrantId = '20000000-0000-4000-8000-000000000001';
  expect((await postGrant({
    grantId: primaryGrantId,
    capability: primaryCapability,
    sessionToken: primarySessionToken,
    scopes: ['catalog.read', 'memory.search'],
    memoryVaultId: currentVaultId,
  })).status).toBe(201);
  expect((await postGrant({
    grantId: '20000000-0000-4000-8000-000000000002',
    capability: 'synthetic-no-memory-scope-capability',
    sessionToken: noScopeSessionToken,
    scopes: ['catalog.read'],
  })).status).toBe(201);
}, 120_000);

afterAll(async () => {
  inodeSwap.target = null;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  modules?.resetBridgeGrantsForTest();
  modules?.setDb(null);
  database?.close();
  vi.unstubAllEnvs();
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe('shared-agent memory bridge', () => {
  it('rejects grants whose memory.search scope is not bound to the current vault identity', async () => {
    const mismatchUser = new modules.UsersRepository().create({
      name: 'Mismatched Vault Owner',
      email: 'shared-memory-mismatch@example.test',
    });
    const mismatchToken = (await new modules.SessionsRepository().createAsync(mismatchUser.id)).token;
    const mismatched = await postGrant({
      grantId: '20000000-0000-4000-8000-000000000010',
      capability: 'synthetic-mismatched-memory-capability',
      sessionToken: mismatchToken,
      scopes: ['catalog.read', 'memory.search'],
      memoryVaultId: '0'.repeat(64),
    });
    expect(mismatched.status).toBe(409);
    expect(await mismatched.json()).toMatchObject({ error: { code: 'memory_vault_changed' } });

    const missing = await postGrant({
      grantId: '20000000-0000-4000-8000-000000000011',
      capability: 'synthetic-missing-memory-capability',
      sessionToken: mismatchToken,
      scopes: ['memory.search'],
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ error: { code: 'memory_vault_changed' } });
  });

  it('SA-MEM-1: enforces scope and bounds while returning opaque untrusted results', async () => {
    // Catches a renderer/model reading memory without consent or receiving paths/row ids.
    const denied = await searchMemory('synthetic-no-memory-scope-capability', {
      query: 'memoryneedle',
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: 'bridge_scope_denied' },
    });

    for (const body of [
      { query: '' },
      { query: 'q'.repeat(257) },
      { query: 'memoryneedle', limit: 0 },
      { query: 'memoryneedle', limit: 11 },
      { query: 'memoryneedle', limit: 1.5 },
      { query: 'memoryneedle', unexpected: true },
    ]) {
      const response = await searchMemory(primaryCapability, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'bridge_invalid_request' },
      });
    }

    const first = await searchMemory(primaryCapability, {
      query: 'memoryneedle',
      limit: 1,
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      schema: string;
      untrusted: boolean;
      results: Array<Record<string, unknown>>;
      omitted: { stale: number; unreadable: number };
    };
    expect(body.schema).toBe('rhythm.memory-search.v1');
    expect(body.untrusted).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      kind: 'fact',
      title: 'T'.repeat(120),
      staleAfter: '2999-10-01',
      trustTier: 'verified',
    });
    expect(body.results[0].snippet).toEqual(expect.any(String));
    expect((body.results[0].snippet as string).length).toBe(500);
    expect(body.results[0].ref).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const row = database.prepare(
      "SELECT id FROM agent_memory WHERE source = 'obsidian-memory' AND source_id = 'fact/primary.md'",
    ).get() as { id: string };
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(row.id);
    expect(serialized).not.toContain('fact/primary.md');
    expect(serialized).not.toContain(vaultRoot);
    expect(serialized).not.toContain('non-vault row');

    const replay = await searchMemory(primaryCapability, {
      query: 'memoryneedle',
      limit: 1,
    });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { results: Array<{ ref: string }> };
    expect(replayBody.results[0].ref).toBe(body.results[0].ref);
  });

  it('SA-MEM-2: omits unsafe, stale, oversized, and inode-swapped notes without mutating the vault', async () => {
    // Catches path escape/symlink reads and TOCTOU replacement between lstat and open.
    const validBody = '# Safe result\n\nadversarialneedle safe';
    await addIndexedNote({
      sourceId: 'fact/adversarial-valid.md',
      raw: validBody,
      indexedContent: validBody,
    });
    await addIndexedNote({
      sourceId: 'fact/stale-index.md',
      raw: '# Changed\n\nfile no longer matches the index',
      indexedContent: 'adversarialneedle stale index bytes',
    });

    const finalTarget = path.join(vaultRoot, 'fact', 'final-target.md');
    await fs.writeFile(finalTarget, 'adversarialneedle final target', 'utf8');
    await fs.symlink('final-target.md', path.join(vaultRoot, 'fact', 'final-link.md'));
    await addIndexedNote({
      sourceId: 'fact/final-link.md',
      indexedContent: 'adversarialneedle final target',
    });

    const componentTarget = path.join(vaultRoot, 'component-target');
    await fs.mkdir(componentTarget, { recursive: true });
    await fs.writeFile(
      path.join(componentTarget, 'component.md'),
      'adversarialneedle component target',
      'utf8',
    );
    await fs.symlink('component-target', path.join(vaultRoot, 'linked-component'));
    await addIndexedNote({
      sourceId: 'linked-component/component.md',
      indexedContent: 'adversarialneedle component target',
    });

    await fs.writeFile(
      path.join(fixtureRoot, 'outside.md'),
      'adversarialneedle outside vault',
      'utf8',
    );
    await addIndexedNote({
      sourceId: '../outside.md',
      indexedContent: 'adversarialneedle outside vault',
    });

    const oversize = `adversarialneedle ${'o'.repeat(256 * 1024)}`;
    await addIndexedNote({
      sourceId: 'fact/oversize.md',
      raw: oversize,
      indexedContent: oversize,
    });

    const inodeBody = 'adversarialneedle original inode';
    await addIndexedNote({
      sourceId: 'fact/inode-swap.md',
      raw: inodeBody,
      indexedContent: inodeBody,
    });
    const inodePath = path.join(vaultRoot, 'fact', 'inode-swap.md');
    const inodeBackup = path.join(fixtureRoot, 'inode-swap.original');
    inodeSwap.target = inodePath;
    inodeSwap.backup = inodeBackup;
    inodeSwap.replacement = 'adversarialneedle replacement inode';
    inodeSwap.swapped = false;

    const before = await treeHash(vaultRoot);
    const response = await searchMemory(primaryCapability, {
      query: 'adversarialneedle',
      limit: 10,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ title: string | null; snippet: string }>;
      omitted: { stale: number; unreadable: number };
    };
    expect(inodeSwap.swapped).toBe(true);
    expect(body.results).toEqual([
      expect.objectContaining({ title: 'Safe result' }),
    ]);
    expect(body.omitted).toEqual({ stale: 1, unreadable: 5 });

    await fs.rm(inodePath, { force: true });
    await fs.rename(inodeBackup, inodePath);
    expect(await treeHash(vaultRoot)).toBe(before);
  });

  it('SA-MEM-3: applies revocation immediately and fail-closes when vault identity changes', async () => {
    // Catches cached consent surviving explicit revoke or a vault replacement at the same path.
    const revoked = await fetch(
      `${baseUrl}/agent-bridge/v1/registrar/grants/${primaryGrantId}/revoke-scopes`,
      {
        method: 'POST',
        headers: registrarHeaders,
        body: JSON.stringify({ scopes: ['memory.search'] }),
      },
    );
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({
      scopes: expect.not.arrayContaining(['memory.search']),
    });
    const afterRevoke = await searchMemory(primaryCapability, {
      query: 'memoryneedle',
    });
    expect(afterRevoke.status).toBe(403);
    await expect(afterRevoke.json()).resolves.toMatchObject({
      error: { code: 'bridge_scope_denied' },
    });

    primaryCapability = 'synthetic-regranted-memory-capability';
    primaryGrantId = '20000000-0000-4000-8000-000000000003';
    expect((await postGrant({
      grantId: primaryGrantId,
      capability: primaryCapability,
      sessionToken: primarySessionToken,
      scopes: ['catalog.read', 'memory.search'],
      memoryVaultId: currentVaultId,
    })).status).toBe(201);

    await fs.rename(vaultRoot, retiredVaultRoot);
    await fs.mkdir(vaultRoot);
    const changed = await searchMemory(primaryCapability, {
      query: 'memoryneedle',
    });
    expect(changed.status).toBe(403);
    await expect(changed.json()).resolves.toMatchObject({
      error: { code: 'memory_vault_changed' },
    });

    const scopeWasRemoved = await searchMemory(primaryCapability, {
      query: 'memoryneedle',
    });
    expect(scopeWasRemoved.status).toBe(403);
    await expect(scopeWasRemoved.json()).resolves.toMatchObject({
      error: { code: 'bridge_scope_denied' },
    });
  });
});
