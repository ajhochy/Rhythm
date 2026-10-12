/**
 * Finite plan admission keeps exactly decompose/continue/execute, and the
 * strict (non-defaulting) native message read used for exact accounting.
 */
import { describe, expect, it } from 'vitest';

import { parseCoordinatorConversationPreparePlan } from '../contracts/coordinator_conversation_contract';
import { OpencodeClientService } from '../services/opencode_client_service';

const admissionBase = {
  commandKey: 'plan-1', totalTokenAuthorization: 512, maxTurns: 2, maxWallTimeSeconds: 300, expiresInSeconds: 300,
  acknowledgesSoftTotalTokenAuthorization: true,
};
const plan = (admission: unknown) => ({
  sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-1', admission,
});

describe('admission contract', () => {
  it('keeps decompose, continue and scoped execute exactly as they were', () => {
    for (const purpose of ['decompose', 'continue'] as const) {
      expect(parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose }))).toMatchObject({ admission: { purpose } });
      expect(() => parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose, workflowCheck: { kind: 'selected_reference_summary_v1', sourceId: 's', expectedVersion: 'v' } }))).toThrow();
    }
    expect(parseCoordinatorConversationPreparePlan(plan({
      ...admissionBase, purpose: 'execute', acknowledgesScopedWorkspaceExecution: true,
    }))).toMatchObject({ admission: { purpose: 'execute', acknowledgesScopedWorkspaceExecution: true } });
    expect(() => parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose: 'execute' }))).toThrow();
    expect(() => parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose: 'unknown' }))).toThrow();
    // The retired selected-reference Coding Workflow purpose is no longer admitted.
    expect(() => parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose: 'workflow', acknowledgesCodingWorkflowCoverage: true }))).toThrow();
  });
});

describe('strict native reads never turn absent or malformed data into an empty result', () => {
  const service = (sdk: Record<string, unknown>) => {
    const svc = new OpencodeClientService();
    (svc as unknown as { client: unknown }).client = { session: sdk };
    (svc as unknown as { status: string }).status = 'ready';
    return svc;
  };

  it('listMessagesPageStrict', async () => {
    const message = { info: { id: 'm1', role: 'assistant' }, parts: [] };
    const withCursor = service({ messages: async () => ({ data: [message], response: { headers: new Headers({ 'x-next-cursor': 'c9' }) } }) });
    expect(await withCursor.listMessagesPageStrict('s', '/d')).toEqual({ messages: [{ info: message.info, parts: [] }], nextCursor: 'c9' });
    expect(await service({ messages: async () => ({ data: [message], response: { headers: new Headers() } }) })
      .listMessagesPageStrict('s', '/d')).toMatchObject({ nextCursor: null });
    for (const response of [
      { error: { message: 'x' } }, { data: undefined }, { data: {} }, { data: [null] }, { data: [{ parts: [] }] },
      { data: [{ info: { role: 'assistant' } }] }, { data: [{ info: { id: 'm1' } }] },
    ]) expect(await service({ messages: async () => response }).listMessagesPageStrict('s', '/d')).toBeNull();
    expect(await service({ messages: async () => { throw new Error('down'); } }).listMessagesPageStrict('s', '/d')).toBeNull();
  });

  it('keeps the old defaulting wrappers exactly as they were', async () => {
    expect(await service({ children: async () => ({ data: undefined }) }).listChildren('p', '/d')).toEqual([]);
    expect(await service({ messages: async () => ({ data: undefined }) }).listMessagesPage('s', '/d')).toEqual({ messages: [], nextCursor: null });
  });
});
