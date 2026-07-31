import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeToolScreenResponse,
  RhythmToolsService,
  sanitizeToolCache,
} from '../providers/services/rhythm-tools-service.ts';
import {
  organizeToolCatalog,
} from '../providers/services/tool-catalog-organizer.ts';

test('Review Queue uses production proposed vocabulary and Gallery uses paired metadata', async () => {
  const proposal = {
    id: 'proposal-real',
    status: 'proposed',
    title: 'Review this change',
    risk: 'high',
  };
  const design = {
    id: 'design-real',
    title: 'Desktop design',
    provider: 'built-in',
  };
  const paired = recordingTransport((path) => {
    if (path === '/mobile-gateway/tools/agent-org-proposals?status=proposed') {
      return [proposal];
    }
    if (path === '/mobile-gateway/tools/agent-designs') return [design];
    throw new Error(`Unexpected paired request: ${path}`);
  });
  const cloud = recordingTransport((path) => {
    throw new Error(`Unexpected cloud request: ${path}`);
  });
  const service = new RhythmToolsService({
    cloud,
    paired,
    projectId: 'project-rhythm',
  });

  assert.deepEqual(await service.loadScreen('review'), [proposal]);
  assert.deepEqual(await service.loadScreen('gallery'), [design]);
  assert.deepEqual(
    paired.calls.map(({ path }) => path),
    [
      '/mobile-gateway/tools/agent-org-proposals?status=proposed',
      '/mobile-gateway/tools/agent-designs',
    ],
  );
  assert.deepEqual(cloud.calls, []);
});

test('large catalogs share search, grouping, and deterministic label/id sorting', () => {
  const fixtures = {
    skills: [
      { id: 'z-2', name: 'Same skill', managed: true },
      { id: 'z-1', name: 'Same skill', managed: true },
      { id: 'a', name: 'Alpha skill', source: 'personal' },
    ],
    mcp: [
      { id: 'z', name: 'Zulu MCP', status: 'disabled' },
      { id: 'a', name: 'Alpha MCP', status: 'connected' },
      { id: 'm', name: 'Middle MCP', status: 'connected' },
    ],
    profiles: [
      { id: 'z', label: 'Zulu profile', isManager: false },
      { id: 'a', label: 'Alpha profile', isManager: true },
      { id: 'm', label: 'Middle profile', isManager: false },
    ],
    models: [
      { id: 'z', name: 'Zulu Provider', connected: false },
      { id: 'a', name: 'Alpha Provider', connected: true },
      { id: 'm', name: 'Middle Provider', connected: true },
    ],
  };

  for (const [tool, items] of Object.entries(fixtures)) {
    const sections = organizeToolCatalog({ tool, items });
    assert.ok(sections.length >= 2, `${tool} should expose useful groups`);
    const ordered = sections.flatMap((section) => section.items);
    const allSorted = organizeToolCatalog({
      tool,
      items,
      groupMode: 'none',
    }).flatMap((section) => section.items);
    assert.deepEqual(
      allSorted.map(({ id }) => id),
      tool === 'skills' ? ['a', 'z-1', 'z-2'] : ['a', 'm', 'z'],
      `${tool} must use label then id sorting`,
    );
    assert.equal(ordered.length, items.length);
    assert.deepEqual(
      organizeToolCatalog({
        tool,
        items,
        query: 'middle',
        groupMode: 'none',
      }).flatMap((section) => section.items).map(({ id }) => id),
      tool === 'skills' ? [] : ['m'],
    );
  }
});

test('Providers & Models filters the upstream universe and preserves safe model metadata', () => {
  const providers = normalizeToolScreenResponse('models', {
    providers: {
      all: [
        { id: 'unused', name: 'Never configured', models: {} },
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-z': { name: 'Zulu model' },
            'gpt-a': { name: 'Alpha model' },
          },
        },
        { id: 'anthropic', name: 'Anthropic', models: {} },
      ],
      connected: ['anthropic'],
    },
    auth: {
      unused: [],
      openai: [{ type: 'api', label: 'API key' }],
      anthropic: [{ type: 'oauth', label: 'Sign in' }],
    },
    config: {
      enabled_providers: ['openai'],
      disabled_providers: ['unused'],
    },
  });

  assert.deepEqual(providers.map(({ id }) => id), ['anthropic', 'openai']);
  assert.deepEqual(providers[1].models, [
    { id: 'gpt-a', name: 'Alpha model' },
    { id: 'gpt-z', name: 'Zulu model' },
  ]);
  assert.equal(providers[0].connected, true);
  assert.equal(providers[1].authMethodCount, 1);
});

test('Gallery cache shaping cannot retain a desktop filesystem path', () => {
  const cached = sanitizeToolCache('gallery', [
    {
      id: 'design-1',
      title: 'Sunday graphic',
      provider: 'built-in',
      artifactType: 'png',
      filePath: '/Users/person/private/sunday.png',
    },
  ]);
  assert.deepEqual(cached, [
    {
      id: 'design-1',
      title: 'Sunday graphic',
      provider: 'built-in',
      artifactType: 'png',
    },
  ]);
});

function recordingTransport(resolve) {
  const calls = [];
  return {
    calls,
    async request(path, init) {
      calls.push({ path, init });
      return resolve(path, init);
    },
  };
}
