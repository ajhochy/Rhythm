import { describe, expect, it } from 'vitest';
import { candidateBeatsDraft } from '../external_discovery_search';
import type { OrgAuditGap } from '../../org_audit_service';

const gap: OrgAuditGap = {
  gapId: 'capability-gap:test',
  kind: 'capability-gap',
  evidence: 'missing conventional commit capability',
  intentTitle: 'conventional commit',
  intentProblem: 'Write consistent commit messages',
  intentTags: ['git'],
};

describe('candidateBeatsDraft', () => {
  it('shortlists a differentiated candidate that scores above the draft', async () => {
    const scorer = async (_purpose: unknown, body: string | null) => ({
      score: body?.includes('## Problem') ? 20 : 85,
      reason: 'fixture',
    });
    await expect(candidateBeatsDraft(gap, '# Complete candidate\nSteps...', scorer)).resolves.toBe(true);
  });

  it('keeps a provenance-clean candidate human-gated when the judge cannot score either body', async () => {
    const scorer = async () => ({ score: 0, reason: 'all reliable scorer routes failed' });
    await expect(candidateBeatsDraft(gap, '# Complete candidate\nSteps...', scorer)).resolves.toBe(true);
  });

  it('drops a genuinely lower-scoring candidate', async () => {
    const scorer = async (_purpose: unknown, body: string | null) => ({
      score: body?.includes('## Problem') ? 70 : 30,
      reason: 'fixture',
    });
    await expect(candidateBeatsDraft(gap, '# Weak candidate', scorer)).resolves.toBe(false);
  });
});
