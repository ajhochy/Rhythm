/**
 * W3 (self-improvement-engine-foundation plan) — learning_session_eligibility.ts.
 *
 * Pure eligibility matrix for skill harvesting: which agent_sessions rows are
 * allowed to feed the harvest loop (skill_extractor.ts) at all. Must fail
 * closed (ineligible) for a missing session, and must exclude every internal/
 * curator/self-improvement/scheduled session so the learner cannot
 * recursively harvest skills from its own background work.
 */

import { describe, expect, it } from 'vitest';
import type { AgentSession } from '../../models/agent_session';

type Fixture = Pick<AgentSession, 'isSystem' | 'category' | 'mcpRole'>;

const USER_CHAT: Fixture = { isSystem: false, category: 'chat', mcpRole: null };

describe('evaluateLearningSessionEligibility', () => {
  it('is eligible for an ordinary user chat session', async () => {
    const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = evaluateLearningSessionEligibility(USER_CHAT);
    expect(result).toEqual({ eligible: true, reason: 'eligible' });
  });

  it('fails closed (ineligible) for a missing session', async () => {
    const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = evaluateLearningSessionEligibility(null);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('session-missing');
  });

  it('excludes isSystem=1 sessions', async () => {
    const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = evaluateLearningSessionEligibility({ ...USER_CHAT, isSystem: true });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('system-session');
  });

  it('excludes category=self_improvement sessions', async () => {
    const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = evaluateLearningSessionEligibility({ ...USER_CHAT, category: 'self_improvement' });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('category-self-improvement');
  });

  it('excludes category=scheduled sessions', async () => {
    const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = evaluateLearningSessionEligibility({ ...USER_CHAT, category: 'scheduled' });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('category-scheduled');
  });

  it.each(['skill-extract', 'skill-refine-judge', 'skill-measure-score', 'skill-refine-rewrite', 'org-optimizer-diagnose'])(
    'excludes curator/measurement/optimizer mcpRole=%s',
    async (role) => {
      const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
      const result = evaluateLearningSessionEligibility({ ...USER_CHAT, mcpRole: role });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('curator-role');
    },
  );

  it('does not exclude an unrelated mcpRole', async () => {
    const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = evaluateLearningSessionEligibility({ ...USER_CHAT, mcpRole: 'church-admin' });
    expect(result).toEqual({ eligible: true, reason: 'eligible' });
  });

  it('isSystem takes priority over an eligible category/role combination', async () => {
    const { evaluateLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = evaluateLearningSessionEligibility({ isSystem: true, category: 'chat', mcpRole: null });
    expect(result.reason).toBe('system-session');
  });
});

describe('checkLearningSessionEligibility (sessionId + repo lookup, fail-closed)', () => {
  it('fails closed when the sessions repo cannot find the session', async () => {
    const { checkLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = checkLearningSessionEligibility('missing-session-id', {
      sessionsRepo: { findById: () => null },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('session-missing');
  });

  it('fails closed when the sessions repo throws', async () => {
    const { checkLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = checkLearningSessionEligibility('boom-session-id', {
      sessionsRepo: {
        findById: () => {
          throw new Error('db unavailable');
        },
      },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('session-missing');
  });

  it('delegates to the pure matrix once a session is found', async () => {
    const { checkLearningSessionEligibility } = await import('../learning_session_eligibility');
    const result = checkLearningSessionEligibility('sys-session-id', {
      sessionsRepo: { findById: () => ({ ...USER_CHAT, isSystem: true } as AgentSession) },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('system-session');
  });
});
