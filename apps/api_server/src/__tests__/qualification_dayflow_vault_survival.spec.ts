import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authority: null as any }));
vi.mock('../services/qualification_fixture_authority', () => ({
  loadQualificationFixtureAuthority: () => state.authority, qualificationApiBootId: 'vault-unit-boot',
}));
vi.mock('../services/opencode_engine', () => ({ opencodeClient: { reloadConfig: vi.fn() }, opencodeSessionMap: new Map() }));
vi.mock('../services/ws_gateway', () => ({ handleInputFrame: vi.fn() }));
vi.mock('../services/async_delegation_completion_service', () => ({ asyncDelegationCompletionService: {} }));

it('real fixture canonical evidence survives normal vault sync/rebuild and retains owner/content fences', async () => {
  const root = realpathSync(mkdtempSync('/private/tmp/rhythm-dayflow-vault-unit-'));
  mkdirSync(join(root, 'memory'), { mode: 0o700 });
  state.authority = { fixtureRoot: root, dbPath: join(root, 'unit.db'), ownerUserId: 1 };
  vi.stubEnv('DB_CLIENT', 'sqlite'); vi.stubEnv('DB_PATH', state.authority.dbPath);
  vi.stubEnv('MEMORY_VAULT_PATH', join(root, 'memory')); vi.stubEnv('MEMORY_VAULT_SUBDIR', '');
  vi.stubEnv('RHYTHM_ACCOUNTS_FILE', join(root, 'anthropic.json'));
  vi.stubEnv('RHYTHM_OPENAI_ACCOUNTS_FILE', join(root, 'openai.json'));
  vi.stubEnv('RHYTHM_DECISION_ROUTER_FILE', join(root, 'router.json'));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unit network forbidden')));
  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:'); runMigrations(db); const prior = setDb(db);
  let actual: any;
  try {
    db.prepare('INSERT INTO users(id,name,email) VALUES(1,?,?)').run('Invented owner', 'fixture@example.invalid');
    db.prepare('INSERT INTO users(id,name,email) VALUES(2,?,?)').run('Invented foreign owner', 'foreign@example.invalid');
    const { QualificationFixtureService } = await import('../services/qualification_fixture_service');
    const { AgentSessionsRepository } = await import('../repositories/agent_sessions_repository');
    const { ProjectsRepository } = await import('../repositories/projects_repository');
    const { AgentMemoryRepository } = await import('../repositories/agent_memory_repository');
    const { DayflowCanonicalEvidenceResolver } = await import('../services/dayflow_qualified_evidence_service');
    const { syncMemoryVault, vaultKeyToMemoryDirRelative } = await import('../services/memoryVaultSyncService');
    const { MemoryIndexService } = await import('../services/memory_index_service');
    const project = new ProjectsRepository().createCoordinatorOwned({ ownerUserId: 1, setupKey: 'vault-unit',
      cwd: root, profileId: 'secretary', name: 'Invented project', workspaceGeneration: 1 }).project;
    const row = new AgentSessionsRepository().insert({ name: 'Invented receiver', agentKind: 'claude-code',
      cwd: root, projectId: project.id, ownerUserId: 1, taskId: null, permissionMode: 'plan' });
    const fixture = Object.assign(Object.create(QualificationFixtureService.prototype), { m: state.authority });
    actual = await fixture.dayflow({ id: randomUUID(), sessionId: row.id, projectId: project.id });
    const page = await actual.service.readQualifiedEvidence({ ownerUserId: 1, projectId: project.id });
    expect(page.status).toBe('available'); expect(page.candidates).toHaveLength(1);
    const input = { ownerUserId: 1, projectId: project.id, candidate: page.candidates[0] };
    const resolver = new DayflowCanonicalEvidenceResolver({ memoryRoot: () => actual.memoryRoot });
    const original = await resolver.resolve(input); expect(original).not.toBeNull();

    // Exercise the real canonical mirror's tombstone sweep, with the normal
    // declared vault root; do not force an index row or manufacture a receipt.
    await syncMemoryVault({ vaultPath: join(root, 'memory') });
    expect(await resolver.resolve(input)).toEqual(original);
    expect(actual.memoryRoot).toBe(join(root, 'memory'));
    await new MemoryIndexService(new AgentMemoryRepository()).rebuildIndexFromVault(join(root, 'memory'));
    const unowned = db.prepare("SELECT owner_user_id FROM agent_memory WHERE source='obsidian-memory' AND source_id=?").get(input.candidate.canonicalSourceKey);
    expect(unowned).toEqual({ owner_user_id: null });
    expect(await resolver.resolve(input)).toEqual(original); // existing immutable-receipt owner repair
    expect(resolver.currentForCandidate(input)).toBe(true);

    const path = join(actual.memoryRoot, vaultKeyToMemoryDirRelative(actual.memoryRoot, input.candidate.canonicalSourceKey));
    const canonicalBytes = readFileSync(path, 'utf8');
    writeFileSync(path, canonicalBytes + '\nInvented changed canonical bytes.\n');
    expect(await resolver.resolve(input)).toBeNull();
    expect(resolver.currentForCandidate(input)).toBe(false);
    writeFileSync(path, canonicalBytes);
    expect(await resolver.resolve(input)).toEqual(original); // independent clean baseline for foreign-owner challenge
    db.prepare("UPDATE agent_memory SET owner_user_id=2 WHERE source='obsidian-memory' AND source_id=?").run(input.candidate.canonicalSourceKey);
    expect(await resolver.resolve(input)).toBeNull();
    expect(db.prepare("SELECT owner_user_id FROM agent_memory WHERE source='obsidian-memory' AND source_id=?").get(input.candidate.canonicalSourceKey))
      .toEqual({ owner_user_id: 2 }); // foreign ownership is never overwritten
    expect(resolver.currentForCandidate(input)).toBe(false);
  } finally {
    actual?.service.dispose(); setDb(prior); db.close(); state.authority = null;
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true });
  }
});
