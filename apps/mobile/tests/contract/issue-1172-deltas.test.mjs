import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildAgentChatReadModel,
} from '../../providers/services/agent-chat-service.ts';
import {
  sanitizeActivityCache,
} from '../../providers/services/activity-service.ts';

const read = (path) =>
  readFile(new URL(path, import.meta.url), 'utf8');

test('issue-1172-delta-c1: chats expose all projects and every lifecycle view', async () => {
  // Regression caught: the service can classify completed chats, but the
  // composing chat list silently renders all lifecycles with no UI control.
  const chatList = await read('../../components/chat/chat-list.tsx');
  for (const label of [
    'All projects',
    'All chat states',
    'Active chats',
    'Completed chats',
    'Archived chats',
  ]) {
    assert.match(chatList, new RegExp(label));
  }
  assert.match(
    chatList,
    /buildAgentChatReadModel\(chat\.sessions,\s*\{\s*lifecycle,\s*projectId,\s*\}\)/,
  );

  const sessions = [
    { id: 'active', projectId: 'a', status: 'working', title: 'Active' },
    { id: 'completed', projectId: 'a', status: 'idle', title: 'Completed' },
    {
      id: 'archived',
      projectId: 'b',
      status: 'idle',
      title: 'Archived',
      time: { archived: 10 },
    },
  ];
  assert.deepEqual(
    buildAgentChatReadModel(sessions, { lifecycle: 'completed' }).map(
      ({ id }) => id,
    ),
    ['completed'],
  );
  assert.deepEqual(
    buildAgentChatReadModel(sessions, { lifecycle: 'archived' }).map(
      ({ id }) => id,
    ),
    ['archived'],
  );
});

test('issue-1172-delta-c6: the mobile Activity boundary accepts all six canonical sources', () => {
  // Regression caught: one source kind is dropped by cache normalization and
  // therefore never reaches the unified feed even when the gateway returns it.
  const sources = [
    'human',
    'scheduler',
    'webhook',
    'research',
    'cookbook',
    'optimizer',
  ];
  const cached = sanitizeActivityCache(
    sources.map((source, index) => ({
      id: `${source}-${index}`,
      source,
      status: 'completed',
      title: `${source} activity`,
      summary: null,
      occurredAt: `2026-07-28T12:00:0${index}.000Z`,
      startedAt: null,
      completedAt: `2026-07-28T12:00:0${index}.000Z`,
      sessionId: null,
      resultUrl: null,
      profileId: null,
      projectId: null,
    })),
  );
  assert.deepEqual(
    new Set(cached.map(({ source }) => source)),
    new Set(sources),
  );
});

test('issue-1172-delta-c8: the chats list has explicit loading and retryable error states', async () => {
  // Regression caught: initial loading or a failed refresh is mislabeled as
  // the ordinary "No chats yet" empty state.
  const chatList = await read('../../components/chat/chat-list.tsx');
  assert.match(chatList, /state="loading"/);
  assert.match(chatList, /title="Loading chats"/);
  assert.match(chatList, /state="error"/);
  assert.match(chatList, /title="Could not load chats"/);
  assert.match(chatList, /actionLabel="Try again"/);
});

test('issue-1172-delta-c9: Agents composes the shared chat, activity, and resilient-state components', async () => {
  // Regression caught: a second session list, activity renderer, or state
  // panel is copied into the route instead of extending the shared surfaces.
  const [agents, chatList, chatDetail, workspace] = await Promise.all([
    read('../../app/(tabs)/agents.tsx'),
    read('../../components/chat/chat-list.tsx'),
    read('../../app/agents/chats/[sessionId].tsx'),
    read('../../app/agents/workspace.tsx'),
  ]);
  assert.match(agents, /import \{ ChatList \}/);
  assert.match(agents, /import \{ ActivityFeed \}/);
  assert.match(chatList, /buildAgentChatReadModel/);
  assert.match(chatList, /<ToolScreenState/);
  assert.match(chatDetail, /import \{ ChatView \}/);
  assert.match(workspace, /useOpencode/);
});
