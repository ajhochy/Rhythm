
import { describe, expect, it } from 'vitest';
import { extractWorkflowFailureSignals } from '../workflow_failure_signal_extractor';
import { AgentSession } from '../../models/agent_session';

describe('workflow_failure_signal_extractor', () => {
  it('detects errored sessions', () => {
    const session: AgentSession = {
      id: 'ses_1',
      status: 'error',
      statusMessage: 'Something went wrong',
      updatedAt: '2026-07-07T12:00:00Z',
    } as any;
    const signals = extractWorkflowFailureSignals([session], []);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('session-errored');
    expect(signals[0].sessionId).toBe('ses_1');
  });

  it('detects delegated child session failures', () => {
    const parentSession: AgentSession = { id: 'parent_ses', status: 'working' } as any;
    const childSession: AgentSession = {
      id: 'child_ses',
      status: 'error',
      statusMessage: 'Child failed',
      parentSessionId: 'parent_ses',
      updatedAt: '2026-07-07T12:00:00Z',
    } as any;
    const signals = extractWorkflowFailureSignals([parentSession, childSession], []);
    expect(signals).toHaveLength(2);
    expect(signals.find(s => s.kind === 'delegated-failure')).toBeDefined();
    expect(signals.find(s => s.kind === 'session-errored')).toBeDefined();
  });
});
