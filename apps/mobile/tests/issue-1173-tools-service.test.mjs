import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RhythmToolsService,
  sanitizeToolCache,
  serializeProfileScope,
  TOOL_SCREEN_MANIFEST,
} from '../providers/services/rhythm-tools-service.ts';

function recordingTransport(origin) {
  const calls = [];
  return {
    calls,
    async request(path, init) {
      calls.push({ origin, path, init });
      return { items: [] };
    },
  };
}

test('issue-1173-c1: tool transports stay origin and credential isolated', async () => {
  const cloud = recordingTransport('cloud');
  const paired = recordingTransport('paired');
  const service = new RhythmToolsService({ cloud, paired });

  await service.listEmailSignals();
  await service.listGalleryDesigns();
  await service.listBrain();
  await service.listResearch();

  assert.deepEqual(cloud.calls.map((call) => call.path), [
    '/integrations/gmail-signals?limit=20',
    '/agent-designs',
  ]);
  assert.deepEqual(paired.calls.map((call) => call.path), [
    '/mobile-gateway/tools/agent-memory',
    '/mobile-gateway/tools/agent-research',
  ]);
  assert.doesNotMatch(JSON.stringify([...cloud.calls, ...paired.calls]), /authorization|deviceToken|sessionToken/i);
});

test('issue-1173-c5: webhook secrets remain one-time and uncached', () => {
  const cached = sanitizeToolCache('webhooks', [{
    id: 'webhook-1',
    name: 'Planning Center',
    url: 'https://mac.example/mobile/webhook/webhook-1',
    secret: 'show-once',
    signingSecret: 'show-once-too',
    token: 'never-cache',
  }]);
  assert.deepEqual(cached, [{
    id: 'webhook-1',
    name: 'Planning Center',
    url: 'https://mac.example/mobile/webhook/webhook-1',
  }]);
  assert.doesNotMatch(JSON.stringify(cached), /show-once|secret|token/i);
});

test('issue-1173-c6: Profile edits preserve scope and projection ordering', () => {
  assert.deepEqual(serializeProfileScope(undefined), { permissionScope: null });
  assert.deepEqual(serializeProfileScope([]), { permissionScope: [] });
  assert.deepEqual(serializeProfileScope(['pco', 'gmail']), {
    permissionScope: ['pco', 'gmail'],
  });
});

test('issue-1173-c9: cloud tools survive paired host outage without sensitive caching', () => {
  const cached = sanitizeToolCache('email', [{
    id: 'signal-1',
    from: 'person@example.com',
    subject: 'Volunteer reply',
    snippet: 'I can serve Sunday',
    body: 'Full private body must not be cached',
    oauthToken: 'oauth-secret',
    headers: { authorization: 'Bearer secret' },
  }]);
  assert.deepEqual(cached, [{
    id: 'signal-1',
    from: 'person@example.com',
    subject: 'Volunteer reply',
    snippet: 'I can serve Sunday',
  }]);
});

test('issue-1173-c11: every screen declares resilient accessible states', () => {
  assert.deepEqual(
    TOOL_SCREEN_MANIFEST.map((screen) => screen.id),
    [
      'brain',
      'research',
      'schedules',
      'webhooks',
      'profiles',
      'cookbook',
      'review',
      'report-card',
      'email',
      'gallery',
      'skills',
      'playbooks',
      'mcp',
      'models',
    ],
  );
  for (const screen of TOOL_SCREEN_MANIFEST) {
    assert.equal(screen.states.includes('loading'), true);
    assert.equal(screen.states.includes('empty'), true);
    assert.equal(screen.states.includes('offline-cache'), true);
    assert.equal(screen.states.includes('expired-auth'), true);
    assert.equal(screen.states.includes('forbidden'), true);
    assert.equal(screen.states.includes('error'), true);
    assert.ok(screen.accessibilityLabel.length > 0);
  }
});
