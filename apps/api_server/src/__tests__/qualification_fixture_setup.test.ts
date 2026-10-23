import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authority: null as any, sdk: 0 }));
vi.mock('../services/qualification_fixture_authority', () => ({
  loadQualificationFixtureAuthority: () => state.authority, qualificationApiBootId: 'setup-unit-boot',
  qualificationSyntheticActorToken: (m: any) => readFileSync(m.syntheticActor.tokenPath, 'utf8'),
}));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { reloadConfig: vi.fn(), createSession: async () => ({ id: 'ses_setup_' + ++state.sdk }),
    getEngineIdentity: async () => ({ pid: 123, bootId: 'setup-unit-engine' }) },
  opencodeSessionMap: new Map(),
}));
vi.mock('../services/ws_gateway', () => ({ handleInputFrame: vi.fn() }));
vi.mock('../services/async_delegation_completion_service', () => ({ asyncDelegationCompletionService: {} }));

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { bootstrapQualificationFixture } from '../services/qualification_fixture_bootstrap';
import { QualificationFixtureService } from '../services/qualification_fixture_service';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { DayflowConfigStore } from '../integrations/dayflow/config_store';
import { MemoryLedger } from '../integrations/dayflow/ledger';
import { DayflowPersistedQualificationAuthority } from '../integrations/dayflow/persisted_qualification_authority';
import { DayflowQualifiedEvidenceService } from '../services/dayflow_qualified_evidence_service';
import { DayflowGuardEnrollmentService, DayflowReceivingContextAuthorityService } from '../services/dayflow_receiving_context_authority';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';
import { opencodeClient } from '../services/opencode_engine';
import { SessionsRepository } from '../repositories/sessions_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import { authenticateIfPresent, requireAuth } from '../middleware/auth_middleware';

let db: Database.Database, previous: Database.Database | null, root: string;
let savedVitest: string | undefined, savedNodeEnv: string | undefined, savedConfigPath: string | undefined;
const ids = ['secretary', 'workflow-orchestrator', 'coding-agent', 'verification-gate'];
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rhythm-qualification-setup-unit-')));
  db = new Database(':memory:'); runMigrations(db); previous = setDb(db);
  const profileSeedPath = join(root, 'profiles.json');
  writeFileSync(profileSeedPath, JSON.stringify({ profiles: ids.map(id => ({ id, revision: 3,
    label: id, icon: 'hub', enabled: true, isAgent: true, systemPrompt: 'Use only the approved scope.',
    corePermissionsJson: '{"read":"allow","edit":"ask","bash":"ask"}', allowedMcpsJson: '[]',
    modelProvider: 'openai', modelId: 'gpt-6.1-sol', ocAgent: id, reasoningEffort: 'xhigh' })) }));
  state.authority = { fixtureRoot: root, dbPath: join(root, 'rhythm.db'), sourceRevision: 'a'.repeat(40), ownerId: 'invented-owner',
    ownerUserId: 1, profileSeedPath,
    publicUserSeed: { id: 1, name: 'Invented owner', email: 'fixture@example.invalid', googleSub: 'invented', timezone: 'UTC' } };
  writeFileSync(state.authority.dbPath, 'owned unit placeholder');
  savedVitest = process.env.VITEST; savedNodeEnv = process.env.NODE_ENV;
  savedConfigPath = process.env.RHYTHM_OPENCODE_CONFIG_PATH;
  process.env.RHYTHM_OPENCODE_CONFIG_PATH = join(root, 'opencode-config/opencode.json');
  // Permit the actual canonical writer, which is confined by the mocked private startup authority.
  process.env.VITEST = 'false'; process.env.NODE_ENV = 'development';
  bootstrapQualificationFixture();
});
afterEach(() => {
  process.env.VITEST = savedVitest; process.env.NODE_ENV = savedNodeEnv;
  if (savedConfigPath === undefined) delete process.env.RHYTHM_OPENCODE_CONFIG_PATH;
  else process.env.RHYTHM_OPENCODE_CONFIG_PATH = savedConfigPath;
  setDb(previous); db.close(); state.authority = null;
  rmSync(root, { recursive: true, force: true });
});
function projectBoot() { (bootstrapQualificationFixture as (...args: any[]) => void)('project'); }
// The server's shared Dayflow seam, as composed in server.ts: one enrollment for every producer.
function dayflowSeam() {
  const records = new DayflowReceivingContextRepository(db);
  const engine = opencodeClient as never;
  const guardEnrollment = new DayflowGuardEnrollmentService({ engine, records });
  const receiver = new DayflowReceivingContextAuthorityService({ engine, records });
  return { guardEnrollment, evidenceFor: (reader: never, canonical: never) =>
    new DayflowQualifiedEvidenceService({ reader, receiver, enrollment: guardEnrollment, canonical }) };
}
function service() {
  return Object.assign(Object.create(QualificationFixtureService.prototype), { m: state.authority, dayflowSeam: dayflowSeam() });
}

it('projects every declared latest profile after backfills and reconciles files on restart', () => {
  const repo = new AgentConfigsRepository();
  repo.update('coding-agent', { systemPrompt: 'Latest bounded coding instructions.' });
  projectBoot();
  for (const id of ids) {
    const profile = repo.getById(id)!;
    expect(readFileSync(join(root, 'opencode-config', 'agents', id + '.md'), 'utf8')).toContain(profile.systemPrompt);
    expect(db.prepare('SELECT projection_state,file_projected_revision FROM agent_profile_projections WHERE profile_id=?').get(id))
      .toEqual({ projection_state: 'projected', file_projected_revision: profile.revision });
  }
  const target = join(root, 'opencode-config', 'agents', 'coding-agent.md'); rmSync(target);
  projectBoot(); expect(readFileSync(target, 'utf8')).toContain('Latest bounded coding instructions.');
  expect(repo.getById('coding-agent')!.systemPrompt).toBe('Latest bounded coding instructions.');
});
it('refuses startup reconciliation for an execution-blocked declared profile', () => {
  new AgentConfigsRepository().update('coding-agent', { enabled: false });
  expect(() => projectBoot()).toThrow(/qualification profile projection/);
  expect(existsSync(join(root, 'opencode-config', 'agents', 'coding-agent.md'))).toBe(false);
});
it('refuses a missing declared profile rather than booting an incomplete engine registry', () => {
  db.prepare('DELETE FROM agent_configs WHERE id=?').run('coding-agent');
  expect(() => projectBoot()).toThrow('qualification profile projection missing');
});
it('refuses a real profile-file write failure', () => {
  mkdirSync(join(root, 'opencode-config'));
  writeFileSync(join(root, 'opencode-config', 'agents'), 'not a directory');
  expect(() => projectBoot()).toThrow('qualification profile projection unavailable');
  expect(db.prepare('SELECT projection_state FROM agent_profile_projections WHERE profile_id=?').get('secretary'))
    .toEqual({ projection_state: 'pending' });
});
it('does not accept a projected file without its durable current-revision trust record', () => {
  db.exec("CREATE TRIGGER reject_projection BEFORE INSERT ON agent_profile_projections BEGIN SELECT RAISE(ABORT, 'unit durable projection refusal'); END");
  expect(() => projectBoot()).toThrow('qualification profile projection unavailable');
  expect(existsSync(join(root, 'opencode-config', 'agents', 'secretary.md'))).toBe(true);
});
it('seeds a synthetic actor through ordinary auth middleware and keeps other bearers invalid', async () => {
  const token = randomBytes(32).toString('hex');
  const tokenPath = join(root, 'actor-token');
  writeFileSync(tokenPath, token); chmodSync(tokenPath, 0o600);
  state.authority.tokenSha256 = createHash('sha256').update(token).digest('hex');
  state.authority.syntheticActor = { tokenPath, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  const workspaces = new WorkspaceRepository();
  expect(workspaces.findForUser(state.authority.ownerUserId)).toBeNull();
  bootstrapQualificationFixture();
  const workspace = workspaces.findForUser(state.authority.ownerUserId);
  expect(workspace).toMatchObject({ name: '[smoke] Qualification invented-owner', role: 'admin', createdBy: state.authority.ownerUserId });
  expect(workspaces.listMembers(workspace!.id)).toMatchObject([{ userId: state.authority.ownerUserId, role: 'admin' }]);
  const sessions = new SessionsRepository();
  expect(sessions.findUserByToken(token)).toMatchObject({ id: state.authority.ownerUserId, email: 'fixture@example.invalid' });
  expect(sessions.findUserByToken('foreign-' + token)).toBeNull();
  for (const middleware of [requireAuth, authenticateIfPresent]) {
    const req = { header: () => 'Bearer ' + token } as never;
    let failure: unknown;
    await middleware(req, {} as never, ((error?: unknown) => { failure = error; }) as never);
    expect(failure).toBeUndefined();
    expect((req as { auth?: { user: { id: number } } }).auth?.user.id).toBe(state.authority.ownerUserId);
  }
  expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  bootstrapQualificationFixture();
  expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT count(*) AS n FROM workspaces').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT count(*) AS n FROM workspace_members').get()).toEqual({ n: 1 });
  db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(workspace!.id, state.authority.ownerUserId);
  expect(() => bootstrapQualificationFixture()).toThrow('qualification synthetic actor workspace membership invalid');
  db.prepare('INSERT INTO users(id,name,email,google_sub,timezone) VALUES (?,?,?,?,?)')
    .run(2, 'Foreign user', 'foreign@example.invalid', 'qualification-fixture:foreign', 'UTC');
  expect(() => bootstrapQualificationFixture()).toThrow('qualification synthetic actor found foreign user');
});
it('establishes real selected-journal consent and canonical import without a later consent-revoking config update', async () => {
  const sessionId = randomUUID(), project = new ProjectsRepository().createCoordinatorOwned({ ownerUserId: 1,
    setupKey: 'setup-unit', cwd: root, profileId: 'secretary', name: 'Invented project', workspaceGeneration: 1 }).project;
  const row = new AgentSessionsRepository().insert({ name: 'Invented Dayflow receiver', agentKind: 'claude-code',
    cwd: root, projectId: project.id, ownerUserId: 1, taskId: null, permissionMode: 'plan' });
  const f = { id: sessionId, sessionId: row.id, projectId: project.id, sdkSessionId: 'ses_setup_dayflow', cwd: root };
  const actual = await service().dayflow(f);
  try {
    const config = new DayflowConfigStore(join(root, 'dayflow', f.id, 'config.json'));
    const ledger = new MemoryLedger(join(root, 'dayflow', f.id, 'ledger.json'));
    expect(config.read()).toMatchObject({ enabled: true, automaticImport: true, sourceConsent: { ownerUserId: 1, projectId: project.id } });
    expect(new DayflowPersistedQualificationAuthority(config, ledger).activeScope()).not.toBeNull();
    expect(ledger.entries()).toHaveLength(1);
    const entry = ledger.entries()[0];
    expect(entry.pendingCreateAt).toBeUndefined();
    expect(entry.canonicalSourceKey).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_memory WHERE owner_user_id=1").get()).toEqual({ n: 1 });
    expect(await actual.service.readQualifiedEvidence({ ownerUserId: 1, projectId: project.id }))
      .toMatchObject({ status: 'available', candidates: [expect.objectContaining({ canonicalSourceKey: entry.canonicalSourceKey })] });
  } finally { actual.service.dispose(); }
});
it('pins the selected model and effort before exhaustion without clearing the persisted effort', async () => {
  const actual = service(), f = await actual.create('router-exhaustion'), repo = new AgentSessionsRepository();
  let frontdoors = 0;
  actual.frontdoor = async () => {
    if (++frontdoors === 1) {
      repo.updateFields(f.sessionId, { providerId: 'openai', modelId: 'gpt-6.1-sol', routerVariant: 'xhigh' });
      repo.setOpenaiAccountSource(f.sessionId, 'router');
      repo.setOpenaiAccountId(f.sessionId, 'fixture-account-a');
    }
    return []; // Setup regression only: no SDK/provider or router-quality claim.
  };
  const receipt = await actual.runCase(f.id, 'router-exhausted-pinned');
  expect(receipt.checks[0]).toMatchObject({ pass: true, observed: { mode: 'fixed',
    before: { accountId: 'fixture-account-a', model: 'gpt-6.1-sol', effort: 'xhigh' },
    after: { accountId: 'fixture-account-a', model: 'gpt-6.1-sol', effort: 'xhigh' } } });
  expect(repo.findById(f.sessionId)).toMatchObject({ modelMode: 'fixed', routerVariant: 'xhigh', openaiAccountSource: 'pinned' });
});
