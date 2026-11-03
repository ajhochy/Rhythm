/**
 * Approval-time refine-skill preimage regression. These tests use the real
 * SQLite repositories, proposal validator/applier, and managed SKILL.md writer.
 * Only post-apply measurement/finalization are no-ops: this is the source
 * approval boundary, not an engine/model or HTTP approval-card test.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useTempManagedSkillsRoot } from './_managed_skills_temp_root';
import type { AgentSkillsRepository as SkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentOrgProposalsRepository as ProposalsRepository } from '../repositories/agent_org_proposals_repository';

type Proposal = Awaited<ReturnType<ProposalsRepository['createAsync']>>;

// Registers its private-root hook first. Never resolve the real user skill dir.
const managedRoot = useTempManagedSkillsRoot('org-refine-approval');
const perTestEnv = [
  'RHYTHM_LEGACY_MANAGED_SKILLS_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'XDG_CACHE_HOME', 'XDG_STATE_HOME',
] as const;
const suiteEnv = ['DB_CLIENT', 'NODE_ENV', 'RHYTHM_MANAGED_SKILLS_DIR', ...perTestEnv] as const;
const savedSuiteEnv = new Map<string, string | undefined>();
let savedPerTestEnv = new Map<string, string | undefined>();
let db: Database.Database | null = null;
let previousDb: Database.Database | null = null;
let ownedRoot = '';
let suiteRoot = '';
let setDb: typeof import('../database/db').setDb;
let runMigrations: typeof import('../database/migrations').runMigrations;
let AgentSkillsRepository: typeof import('../repositories/agent_skills_repository').AgentSkillsRepository;
let AgentOrgProposalsRepository: typeof import('../repositories/agent_org_proposals_repository').AgentOrgProposalsRepository;
let writeManagedSkill: typeof import('../services/rhythm_managed_skills').writeManagedSkill;
let readManagedSkillBytes: typeof import('../services/rhythm_managed_skills').readManagedSkillBytes;
let registerAllProposalAppliers: typeof import('../services/org_proposal_appliers_wiring').registerAllProposalAppliers;
let validateProposalChange: typeof import('../services/org_proposal_apply_service').validateProposalChange;
let applyApprovedProposalAsync: typeof import('../services/org_proposal_apply_service').applyApprovedProposalAsync;
let applyProposal: typeof import('../services/org_proposal_apply_service').applyProposal;
let registerProposalValidator: typeof import('../services/org_proposal_apply_service').registerProposalValidator;
let resetProposalPluginsForTests: typeof import('../services/org_proposal_apply_service').resetProposalPluginsForTests;
let skills: SkillsRepository;
let proposals: ProposalsRepository;

function restoreEnv(names: readonly string[], saved: ReadonlyMap<string, string | undefined>): void {
  for (const name of names) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeAll(async () => {
  for (const name of suiteEnv) savedSuiteEnv.set(name, process.env[name]);
  suiteRoot = mkdtempSync(join(tmpdir(), 'org-refine-approval-suite-'));
  process.env.DB_CLIENT = 'sqlite';
  process.env.NODE_ENV = 'test';
  process.env.RHYTHM_MANAGED_SKILLS_DIR = join(suiteRoot, 'managed-skills');
  process.env.RHYTHM_LEGACY_MANAGED_SKILLS_DIR = join(suiteRoot, 'legacy-skills');
  process.env.XDG_CONFIG_HOME = join(suiteRoot, 'xdg-config');
  process.env.XDG_DATA_HOME = join(suiteRoot, 'xdg-data');
  process.env.XDG_CACHE_HOME = join(suiteRoot, 'xdg-cache');
  process.env.XDG_STATE_HOME = join(suiteRoot, 'xdg-state');
  ({ setDb } = await import('../database/db'));
  ({ runMigrations } = await import('../database/migrations'));
  ({ AgentSkillsRepository } = await import('../repositories/agent_skills_repository'));
  ({ AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository'));
  ({ writeManagedSkill, readManagedSkillBytes } = await import('../services/rhythm_managed_skills'));
  ({ registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring'));
  ({
    validateProposalChange, applyApprovedProposalAsync, applyProposal,
    registerProposalValidator, resetProposalPluginsForTests,
  } = await import('../services/org_proposal_apply_service'));
});

afterAll(() => {
  restoreEnv(suiteEnv, savedSuiteEnv);
  if (suiteRoot) rmSync(suiteRoot, { recursive: true, force: true });
});

beforeEach(() => {
  ownedRoot = mkdtempSync(join(tmpdir(), 'org-refine-approval-env-'));
  savedPerTestEnv = new Map(perTestEnv.map((name) => [name, process.env[name]]));
  process.env.RHYTHM_LEGACY_MANAGED_SKILLS_DIR = join(ownedRoot, 'legacy-skills');
  process.env.XDG_CONFIG_HOME = join(ownedRoot, 'xdg-config');
  process.env.XDG_DATA_HOME = join(ownedRoot, 'xdg-data');
  process.env.XDG_CACHE_HOME = join(ownedRoot, 'xdg-cache');
  process.env.XDG_STATE_HOME = join(ownedRoot, 'xdg-state');
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO users(id,name,email) VALUES(1,'Owned approver','refine-approver@example.invalid')").run();
  previousDb = setDb(db);
  skills = new AgentSkillsRepository(db);
  proposals = new AgentOrgProposalsRepository(db);
  resetProposalPluginsForTests();
  registerAllProposalAppliers();
});

afterEach(() => {
  resetProposalPluginsForTests();
  if (db) {
    setDb(previousDb);
    db.close();
    db = null;
  }
  previousDb = null;
  restoreEnv(perTestEnv, savedPerTestEnv);
  if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  ownedRoot = '';
});

async function ownedProposal(label: string, fileBeforeProposal?: string) {
  const name = `smoke-refine-${label}-${randomUUID().slice(0, 8)}`;
  const original = 'Use the original safe summary procedure.';
  const revised = 'Use the reviewed revised summary procedure.';
  const concurrent = 'Use the independently edited summary procedure.';
  const skill = skills.create({ title: name, description: 'Owned summary fixture', body: original, status: 'active' });
  const file = writeManagedSkill({ name, description: 'Owned summary fixture', body: fileBeforeProposal ?? original });
  expect(resolve(file).startsWith(`${resolve(managedRoot())}${sep}`)).toBe(true);
  const proposal = await proposals.createAsync({
    id: randomUUID(), kind: 'refine-skill', risk: 'high', status: 'proposed',
    title: `Revise ${name}`, targetRef: `skill:${skill.id}`,
    changeJson: JSON.stringify({ priorBody: fileBeforeProposal ?? original, revisedBody: revised }),
    ownerUserId: 1,
  });
  return { name, original, revised, concurrent, skill, file, proposal };
}

function current(skillId: string, name: string, file: string) {
  return {
    dbBody: skills.getById(skillId)?.body ?? null,
    managedBytes: readManagedSkillBytes(name),
    fileBytes: readFileSync(file),
  };
}

async function approve(proposal: Proposal) {
  return applyApprovedProposalAsync({
    proposal, decidedByUserId: 1, proposalsRepo: proposals,
    // Keep the source approval/applier path real; avoid model/monitor dispatch.
    finalizePostApply: async () => null,
    measure: async () => 'skipped',
  });
}

describe.sequential('refine-skill approval preserves the submitted skill preimage', () => {
  it('applies an unchanged managed-file preimage to DB and file', async () => {
    const f = await ownedProposal('unchanged');
    expect((await validateProposalChange(f.proposal)).valid).toBe(true);
    expect((await approve(f.proposal)).kind).toBe('applied');
    const after = current(f.skill.id, f.name, f.file);
    expect(after.dbBody).toBe(f.revised);
    expect(after.managedBytes?.toString('utf8')).toContain(f.revised);
    expect(after.fileBytes.toString('utf8')).toContain(f.revised);
    expect((await proposals.findByIdAsync(f.proposal.id))?.status).toBe('measuring');
  });

  it('refuses a later file-only edit without changing DB, file, or proposal state', async () => {
    const f = await ownedProposal('file-only');
    writeManagedSkill({ name: f.name, description: 'Owned summary fixture', body: f.concurrent });
    const before = current(f.skill.id, f.name, f.file);
    expect((await validateProposalChange(f.proposal)).valid).toBe(false);
    expect((await approve(f.proposal)).kind).toBe('conflict');
    expect(current(f.skill.id, f.name, f.file)).toEqual(before);
    expect((await proposals.findByIdAsync(f.proposal.id))?.status).toBe('proposed');
  });

  it('accepts managed-file authority when DB was already stale at submission', async () => {
    const authoritative = 'Use the file-only current summary procedure.';
    const f = await ownedProposal('db-stale-before-submit', authoritative);
    expect(skills.getById(f.skill.id)?.body).toBe(f.original);
    expect(readFileSync(f.file, 'utf8')).toContain(authoritative);
    expect((await validateProposalChange(f.proposal)).valid).toBe(true);
    expect((await approve(f.proposal)).kind).toBe('applied');
    const after = current(f.skill.id, f.name, f.file);
    expect(after.dbBody).toBe(f.revised);
    expect(after.fileBytes.toString('utf8')).toContain(f.revised);
    expect((await proposals.findByIdAsync(f.proposal.id))?.status).toBe('measuring');
  });

  it('refuses a later DB and managed-file edit without overwriting either', async () => {
    const f = await ownedProposal('db-and-file');
    skills.update(f.skill.id, { body: f.concurrent });
    writeManagedSkill({ name: f.name, description: 'Owned summary fixture', body: f.concurrent });
    const before = current(f.skill.id, f.name, f.file);
    expect((await validateProposalChange(f.proposal)).valid).toBe(false);
    expect((await approve(f.proposal)).kind).toBe('conflict');
    expect(current(f.skill.id, f.name, f.file)).toEqual(before);
    expect((await proposals.findByIdAsync(f.proposal.id))?.status).toBe('proposed');
  });

  it('rechecks at the applier when the target changes after a valid decision', async () => {
    const f = await ownedProposal('after-validation');
    expect((await validateProposalChange(f.proposal)).valid).toBe(true);
    // Test seam deliberately returns a valid decision while editing the file.
    // The registered real applier must independently refuse the later bytes.
    registerProposalValidator('refine-skill', () => {
      writeManagedSkill({ name: f.name, description: 'Owned summary fixture', body: f.concurrent });
      return { valid: true };
    });
    await expect(applyProposal(f.proposal)).rejects.toMatchObject({ statusCode: 409 });
    const after = current(f.skill.id, f.name, f.file);
    expect(after.dbBody).toBe(f.original);
    expect(after.fileBytes.toString('utf8')).toContain(f.concurrent);
    expect((await proposals.findByIdAsync(f.proposal.id))?.status).toBe('proposed');
  });
});
