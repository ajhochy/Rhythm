import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  buildAgentChatReadModel,
  dedupeRecoveryEvents,
  getRecoveryDelayMs,
  sanitizeOfflineChatCache,
  assertOnlineMutation,
} from '../providers/services/agent-chat-service.ts';
import {
  getActivityDeepLink,
  normalizeActivityStatus,
  sanitizeActivityCache,
} from '../providers/services/activity-service.ts';

const tabsSource = await readFile(
  new URL('../app/(tabs)/_layout.tsx', import.meta.url),
  'utf8',
);
const screenStateSource = await readFile(
  new URL('../components/tools/tool-screen-state.tsx', import.meta.url),
  'utf8',
);

test('issue-1172-c1: navigation exposes exactly Agents Tools and Settings', () => {
  const tabNames = [...tabsSource.matchAll(/<Tabs\.Screen[\s\S]*?name="([^"]+)"[\s\S]*?\/>/g)]
    .map((match) => match[1]);
  assert.deepEqual(tabNames, ['agents', 'tools', 'settings']);
  assert.doesNotMatch(tabsSource, /name=\"(?:index|terminal|workspace)\"/);
});

test('issue-1172-c2: chat read model filters projects and lifecycle states while preserving children', () => {
  const sessions = [
    { id: 'active-a', projectId: 'a', status: 'working', title: 'Active A' },
    { id: 'done-a', projectId: 'a', status: 'done', title: 'Done A' },
    { id: 'archived-b', projectId: 'b', status: 'idle', time: { archived: 3 }, title: 'Archived B' },
    { id: 'child-a', projectId: 'a', status: 'done', parentID: 'active-a', title: 'Child A' },
  ];
  const model = buildAgentChatReadModel(sessions, {
    projectId: 'a',
    lifecycle: 'active',
  });
  assert.deepEqual(model.map((entry) => entry.id), ['active-a']);
  assert.deepEqual(model[0].children.map((child) => child.id), ['child-a']);
  assert.deepEqual(
    buildAgentChatReadModel(sessions, { lifecycle: 'archived' }).map((entry) => entry.id),
    ['archived-b'],
  );
});

test('issue-1172-c3: recovery dedupes stable event IDs and bounds retry delays', () => {
  assert.deepEqual(
    dedupeRecoveryEvents([
      { id: 'event-1', type: 'message.updated' },
      { id: 'event-1', type: 'message.updated' },
      { id: 'event-2', type: 'session.status' },
    ]).map((event) => event.id),
    ['event-1', 'event-2'],
  );
  assert.deepEqual(
    [0, 1, 2, 30].map((attempt) => getRecoveryDelayMs(attempt)),
    [500, 1000, 2000, 30000],
  );
});

test('issue-1172-c4: offline cache strips secrets and mutation guard fails closed', () => {
  const cached = sanitizeOfflineChatCache({
    sessions: [{ id: 'session-1', title: 'Visible', token: 'secret', output: 'Visible output' }],
    authorization: 'Bearer secret',
    pairingCode: 'pair-me',
    accessToken: 'token',
  });
  assert.deepEqual(cached, {
    sessions: [{ id: 'session-1', title: 'Visible', output: 'Visible output' }],
  });
  assert.throws(() => assertOnlineMutation(false), /offline/i);
  assert.doesNotThrow(() => assertOnlineMutation(true));
});

test('issue-1172-c7: activity feed normalizes states and only emits valid deep links', () => {
  assert.deepEqual(
    ['working', 'pending', 'error', 'done'].map(normalizeActivityStatus),
    ['active', 'waiting', 'failed', 'completed'],
  );
  assert.equal(
    getActivityDeepLink({ source: 'human', sessionId: 'session-1', resultUrl: null }),
    '/agents/chats/session-1',
  );
  assert.equal(
    getActivityDeepLink({ source: 'research', sessionId: null, resultUrl: '/agent-research/research-1' }),
    '/tools/research?selectedId=research-1',
  );
  assert.equal(
    getActivityDeepLink({ source: 'webhook', sessionId: null, resultUrl: 'https://attacker.example' }),
    null,
  );
  const cached = sanitizeActivityCache([{
    id: 'human:session-1',
    source: 'human',
    status: 'completed',
    title: 'Visible',
    summary: 'Safe summary',
    occurredAt: '2026-07-25T10:00:00.000Z',
    startedAt: null,
    completedAt: '2026-07-25T10:00:00.000Z',
    sessionId: 'session-1',
    resultUrl: '/agent-sessions/session-1',
    profileId: null,
    projectId: 'project-1',
    deviceToken: 'must-not-persist',
    authorization: 'Bearer must-not-persist',
  }]);
  assert.equal(cached.length, 1);
  assert.doesNotMatch(JSON.stringify(cached), /token|authorization/i);
});

test('issue-1172-c8: reusable screen states cover the full resilient state set', () => {
  for (const state of ['loading', 'empty', 'offline-cache', 'expired-auth', 'forbidden', 'error']) {
    assert.match(screenStateSource, new RegExp(`['\"]${state}['\"]`));
  }
  assert.match(screenStateSource, /accessibilityRole/);
  assert.doesNotMatch(screenStateSource, /fontSize:\\s*\\d+/);
});
