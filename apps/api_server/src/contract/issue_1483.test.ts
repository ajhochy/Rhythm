import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import type { AgentSkill } from '../models/agent_skill';
import { useTempManagedSkillsRoot } from '../__tests__/_managed_skills_temp_root';

const { downloadSkillBody } = vi.hoisted(() => ({ downloadSkillBody: vi.fn() }));
vi.mock('../services/generators/external_discovery_search', () => ({ downloadSkillBody }));
useTempManagedSkillsRoot('issue-1483');

const provenance = { source: 'skills.sh', stars: 10, lastUpdated: '2026-08-01', maintainer: 'owner',
  license: 'MIT', installCommand: 'npx skills add owner/repo/zsh-path' };
const gap = { gapId: 'capability-gap:path', kind: 'capability-gap' as const,
  evidence: 'login shell PATH repair', intentTitle: 'fix CLI PATH for login shells' };

function localSkill(): AgentSkill {
  return { id: 'local', title: 'Fix CLI PATH for login shells', whenToUse: null,
    description: 'Repair ~/.zprofile PATH entries for login-shell verification', stepsJson: null,
    tagsJson: null, body: 'Inspect and repair login shell PATH entries.', confidence: 1, status: 'active',
    source: 'local', uses: 1, version: 1, appliedForName: null, baseVersion: null,
    originLocation: null, isExternal: 0, baselineScore: null, postScore: null, measureReason: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

beforeEach(() => {
  const db = new Database(':memory:'); runMigrations(db); setDb(db);
  downloadSkillBody.mockReset();
});

describe('#1483 safe external skill adoption', () => {
  it('issue-1483-c1: drops an external skill overlapping an installed local skill', async () => {
    // Regression caught: zsh-path is proposed despite equivalent installed PATH-repair skills.
    const { runExternalDiscoveryGenerator } = await import('../services/generators/external_discovery_generator');
    const result = await runExternalDiscoveryGenerator({ auditRunId: 'issue-1483', gaps: [gap],
      installedSkills: [localSkill()], discoverCandidates: async () => [{ kind: 'skill', name: 'zsh path',
        gapId: gap.gapId, provenance, downloadUrl: `https://raw.githubusercontent.com/owner/repo/${'a'.repeat(40)}/SKILL.md`,
        contentSha256: createHash('sha256').update('body').digest('hex') }] });
    expect(result.emitted).toBe(0);
    expect(result.droppedInstalledOverlap).toBe(1);
  });

  it('issue-1483-c2: rejects HEAD URLs and records the reviewed content hash', async () => {
    // Regression caught: proposal approval downloads mutable HEAD content.
    const { runExternalDiscoveryGenerator } = await import('../services/generators/external_discovery_generator');
    await runExternalDiscoveryGenerator({ auditRunId: 'issue-1483', gaps: [gap], installedSkills: [],
      discoverCandidates: async () => [{ kind: 'skill', name: 'candidate', gapId: gap.gapId, provenance,
        downloadUrl: 'https://raw.githubusercontent.com/owner/repo/HEAD/SKILL.md' }] });
    expect(await new AgentOrgProposalsRepository().listByStatusAsync('proposed')).toHaveLength(0);
  });

  it('issue-1483-c3: the real installer fails closed when downloaded bytes differ from review', async () => {
    // Regression caught: approval installs changed upstream bytes after human review.
    const expected = createHash('sha256').update('reviewed').digest('hex');
    downloadSkillBody.mockResolvedValue('tampered after review');
    const { buildRealExternalAdoptionDeps } = await import('../services/org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    await expect(deps.installSkill({ skillName: 'candidate',
      downloadUrl: `https://raw.githubusercontent.com/o/r/${'b'.repeat(40)}/SKILL.md`,
      contentSha256: expected })).rejects.toThrow(/content hash mismatch/);
  });
});
