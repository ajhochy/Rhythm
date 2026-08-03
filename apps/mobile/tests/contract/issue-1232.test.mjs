import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getActivityDeepLink } from '../../providers/services/activity-service.ts';

const categoryService = await import(
  '../../providers/services/agent-category-service.ts'
).catch(() => ({}));
const agentsSource = await readFile(
  new URL('../../app/(tabs)/agents.tsx', import.meta.url),
  'utf8',
);
const chatListSource = await readFile(
  new URL('../../components/chat/chat-list.tsx', import.meta.url),
  'utf8',
);
const activityFeedSource = await readFile(
  new URL('../../components/agents/activity-feed.tsx', import.meta.url),
  'utf8',
);

const activities = [
  {
    id: 'scheduled-active',
    source: 'scheduler',
    status: 'active',
    title: 'Morning briefing',
    summary: 'Preparing the daily briefing',
    occurredAt: '2026-07-28T12:00:00.000Z',
    startedAt: null,
    completedAt: null,
    sessionId: null,
    resultUrl: '/agent-schedules/morning',
    profileId: null,
    projectId: 'project-a',
  },
  {
    id: 'scheduled-completed',
    source: 'scheduler',
    status: 'completed',
    title: 'Weekly digest',
    summary: 'Digest complete',
    occurredAt: '2026-07-27T12:00:00.000Z',
    startedAt: null,
    completedAt: '2026-07-27T12:05:00.000Z',
    sessionId: null,
    resultUrl: '/agent-schedules/weekly',
    profileId: null,
    projectId: 'project-b',
  },
  {
    id: 'optimizer-failed',
    source: 'optimizer',
    status: 'failed',
    title: 'Skill refinement loop',
    summary: 'Review required',
    occurredAt: '2026-07-26T12:00:00.000Z',
    startedAt: null,
    completedAt: '2026-07-26T12:05:00.000Z',
    sessionId: 'loop-session',
    resultUrl: null,
    profileId: null,
    projectId: 'project-a',
  },
];

test('issue-1232-c1: Agents keeps its primary categories in the compact overflow menu', () => {
  // Regression caught: category navigation returns to a permanent segmented
  // row that consumes scarce transcript/list height on mobile.
  assert.match(agentsSource, /accessibilityLabel="Agents menu"/);
  assert.match(agentsSource, /title=\{`Chats/);
  assert.match(agentsSource, /title=\{`Scheduled Tasks/);
  assert.match(agentsSource, /title=\{`Background Loops/);
  assert.match(agentsSource, /title="Activity"/);
  assert.doesNotMatch(agentsSource, /<SegmentedButtons/);
  assert.doesNotMatch(chatListSource, /Show active chats|Show completed chats|Show archived chats/);
});

test('issue-1232-c2: every primary category exposes its current item count', () => {
  // Regression caught: category labels render without counts or count activity
  // sources in the wrong bucket.
  assert.equal(typeof categoryService.getAgentCategoryCounts, 'function');
  assert.deepEqual(
    categoryService.getAgentCategoryCounts(
      [{ id: 'chat-a' }, { id: 'chat-b' }],
      activities,
    ),
    { chats: 2, scheduled: 2, background: 1 },
  );
  assert.match(agentsSource, /counts\.chats/);
  assert.match(agentsSource, /counts\.scheduled/);
  assert.match(agentsSource, /counts\.background/);
});

test('issue-1232-c3: each category has a specific, actionable empty state', () => {
  // Regression caught: empty categories show the old generic activity message,
  // leaving users unable to tell what belongs there or where to create it.
  assert.match(chatListSource, /No chats yet/);
  assert.match(activityFeedSource, /emptyTitle/);
  assert.match(agentsSource, /No scheduled tasks yet/);
  assert.match(agentsSource, /Open Scheduled Tasks/);
  assert.match(agentsSource, /No background loops yet/);
});

test('issue-1232-c4: category rows deep-link to the corresponding chat or tool detail', () => {
  // Regression caught: a scheduled run opens the generic feed, or a loop
  // session loses its project-aware chat destination.
  assert.equal(
    getActivityDeepLink(activities[0]),
    '/tools/schedules?selectedId=morning',
  );
  assert.equal(
    getActivityDeepLink(activities[2]),
    '/agents/chats/loop-session',
  );
  assert.match(activityFeedSource, /projectId:\s*item\.projectId/);
});

test('issue-1232-c5: search and status filters apply inside the selected category without cross-category leakage', () => {
  // Regression caught: search/status controls filter the whole feed and show
  // scheduled work under Background Loops (or vice versa).
  assert.equal(typeof categoryService.filterAgentActivities, 'function');
  assert.deepEqual(
    categoryService
      .filterAgentActivities(activities, {
        category: 'scheduled',
        query: 'brief',
        status: 'active',
      })
      .map((item) => item.id),
    ['scheduled-active'],
  );
  assert.deepEqual(
    categoryService
      .filterAgentActivities(activities, {
        category: 'background',
        query: '',
        status: 'all',
      })
      .map((item) => item.id),
    ['optimizer-failed'],
  );
  assert.match(activityFeedSource, /Search/);
  assert.match(activityFeedSource, /statusFilter/);
});
