import { describe, expect, it } from 'vitest';

import type { CoordinatorConversation, CoordinatorConversationContextScope } from '../contracts/coordinator_conversation_contract';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { createCoordinatorConversationContextAdapters } from '../services/coordinator_conversation_runtime_adapters';

const now = new Date('2026-10-05T12:00:00.000Z');
const scope: CoordinatorConversationContextScope = {
  ownerUserId: 7,
  projectId: 'project-a',
  conversationId: 'conversation-a',
  now,
};

const conversation: CoordinatorConversation = {
  schemaVersion: 3,
  id: scope.conversationId,
  sessionId: 'chat-a',
  ownerUserId: scope.ownerUserId,
  projectId: scope.projectId,
  controlRevision: 1,
  primaryOwnerRoot: true,
  goals: [],
  commandDedupe: [],
  continuations: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

describe('C2 bounded ordinary context adapters', () => {
  it('selects a deterministic relevant window after a complete ordinary task read rather than calling >25 rows unavailable', async () => {
    const tasks: Array<{
      id: string; title: string; status: string; dueDate: string | null; scheduledDate: string | null; priority: number | null;
    }> = Array.from({ length: 26 }, (_, index) => ({
      id: `task-${String(index).padStart(2, '0')}`,
      title: `Task ${index}`,
      status: 'open',
      dueDate: null,
      scheduledDate: null,
      priority: null,
    }));
    // It is intentionally last in repository order: relevance, not an
    // arbitrary first page, must preserve today's ordinary follow-up.
    tasks[25] = {
      id: 'task-today', title: 'Today follow-up', status: 'waiting_for_reply',
      dueDate: '2026-10-05', scheduledDate: null, priority: 1,
    };
    const adapters = createCoordinatorConversationContextAdapters({
      tasks: { findAllAsync: async () => tasks } as never,
      schedules: { listForOwnerAsync: async () => [] } as never,
      rhythms: { findAllAsync: async () => [] } as never,
      workstreams: { list: () => [] } as never,
      jobs: { listNativeForWorkstream: () => [] } as never,
    });
    const taskRead = await adapters.tasks.read(scope);
    expect(taskRead).toMatchObject({
      availability: 'available', complete: true, authoritative: true,
      coverage: { strategy: 'bounded_relevance', totalItems: 26, selectedItems: 25, maxItems: 25 },
    });
    if (taskRead.availability !== 'available') throw new Error('expected task window');
    expect(taskRead.items.map((task) => task.id)).toContain('task-today');

    const context = await new CoordinatorConversationContextAssembler(adapters).assemble({ conversation, now });
    expect(context.coverage.tasks).toEqual({
      strategy: 'bounded_relevance', totalItems: 26, selectedItems: 25, maxItems: 25,
    });
    expect(context.todayTasks.map((task) => task.id)).toEqual(['task-today']);
    expect(context.modelContext.kind).toBe('ready');
  });
});
