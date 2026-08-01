import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildAgentChatReadModel,
} from '../../providers/services/agent-chat-service.ts';
import {
  filterAgentActivities,
} from '../../providers/services/agent-category-service.ts';
import {
  normalizeToolScreenResponse,
  RhythmToolsService,
  TOOL_SCREEN_MANIFEST,
} from '../../providers/services/rhythm-tools-service.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [agentsSource, chatListSource, toolScreenSource, sessionSheetSource, providerSource] =
  await Promise.all([
    read('../../app/(tabs)/agents.tsx'),
    read('../../components/chat/chat-list.tsx'),
    read('../../app/tools/[tool].tsx'),
    read('../../components/chat/session-configuration-sheet.tsx'),
    read('../../providers/opencode-provider.tsx'),
  ]);

test('issue-1285-c1: Agents overflow owns chat actions and selectors while Search chats stays visible', () => {
  // Regression caught: the composing Agents route renders a second Chats title
  // row plus project/lifecycle rows instead of placing those controls in its
  // existing top-right overflow. The forbidden ChatList assertions fail.
  assert.match(chatListSource, /accessibilityLabel="Search chats"/);
  assert.doesNotMatch(chatListSource, /<Appbar\.Header/);
  assert.doesNotMatch(chatListSource, /<SegmentedButtons/);
  assert.doesNotMatch(chatListSource, /accessibilityLabel="Filter chats by project"/);

  for (const label of [
    'Open workspace',
    'Open terminal',
    'Create chat',
    'Filter chats by project',
    'All chat states',
    'Active chats',
    'Completed chats',
    'Archived chats',
  ]) {
    assert.match(
      agentsSource,
      new RegExp(label),
      `${label} must be reachable from the Agents overflow`,
    );
  }
});

test('issue-1285-c2: desktop human sessions compose into Chats without leaking scheduled or optimizer runs', () => {
  // Regression caught: the read model treats every global session as a Chat,
  // or the composing provider never supplies desktop/global sessions at all.
  // Inputs mirror OpenCode GlobalSession plus /agent-activity response shapes.
  const sessions = [
    {
      id: 'ses-desktop-human',
      slug: 'desktop-human',
      projectID: '',
      project: null,
      directory: '/Users/person/Documents/Rhythm',
      title: 'Desktop planning chat',
      version: '1.14.49',
      status: { type: 'idle' },
      time: { created: 1_000, updated: 4_000 },
    },
    {
      id: 'ses-scheduled',
      slug: 'scheduled',
      projectID: '',
      project: null,
      directory: '/Users/person/Documents/Rhythm',
      title: 'Daily planning run',
      version: '1.14.49',
      status: { type: 'idle' },
      time: { created: 2_000, updated: 5_000 },
    },
    {
      id: 'ses-optimizer',
      slug: 'optimizer',
      projectID: '',
      project: null,
      directory: '/Users/person/Documents/Rhythm',
      title: 'Organization optimizer run',
      version: '1.14.49',
      status: { type: 'idle' },
      time: { created: 3_000, updated: 6_000 },
    },
  ];
  const activities = [
    activity('human:ses-desktop-human', 'human', 'ses-desktop-human'),
    activity('scheduler:ses-scheduled', 'scheduler', 'ses-scheduled'),
    activity('optimizer:ses-optimizer', 'optimizer', 'ses-optimizer'),
  ];

  const chats = buildAgentChatReadModel(sessions, {
    lifecycle: 'all',
    activities,
  });
  assert.deepEqual(chats.map(({ id }) => id), ['ses-desktop-human']);
  assert.deepEqual(
    filterAgentActivities(activities, {
      category: 'scheduled',
      query: '',
      status: 'all',
    }).map(({ id }) => id),
    ['scheduler:ses-scheduled'],
  );
  assert.deepEqual(
    filterAgentActivities(activities, {
      category: 'background',
      query: '',
      status: 'all',
    }).map(({ id }) => id),
    ['optimizer:ses-optimizer'],
  );
});

test('issue-1285-c3: Review Queue and Gallery load the authorized records visible on desktop', async () => {
  // Regression caught: Review Queue asks for the nonexistent "pending" status
  // and Gallery reads an empty cloud catalog instead of the paired desktop
  // catalog that owns the user's designs. Either mismatch empties the screen.
  const proposal = {
    id: 'proposal-1',
    status: 'proposed',
    title: 'Tighten the secretary handoff',
    risk: 'high',
  };
  const design = {
    id: 'design-1',
    title: 'Sunday service graphic',
    provider: 'built-in',
  };
  const cloud = recordingTransport(() => []);
  const paired = recordingTransport((path) => {
    if (path === '/mobile-gateway/tools/agent-org-proposals?status=proposed') {
      return [proposal];
    }
    if (path === '/mobile-gateway/tools/agent-designs') return [design];
    return [];
  });
  const service = new RhythmToolsService({
    cloud,
    paired,
    projectId: '/Users/person/Documents/Rhythm',
  });

  assert.deepEqual(await service.loadScreen('review'), [proposal]);
  assert.deepEqual(await service.loadScreen('gallery'), [design]);
  assert.deepEqual(
    TOOL_SCREEN_MANIFEST
      .filter(({ id }) => id === 'review' || id === 'gallery')
      .map(({ id, origin }) => [id, origin]),
    [
      ['review', 'paired'],
      ['gallery', 'paired'],
    ],
  );
});

test('issue-1285-c4: large tool catalogs expose search grouping and deterministic A-Z sorting', () => {
  // Regression caught: Skills, MCP Servers, Agent Profiles, and Providers &
  // Models render transport order with no way to find or group an entry.
  assert.match(
    toolScreenSource,
    /['"]skills['"][\s\S]*?['"]mcp['"][\s\S]*?['"]profiles['"][\s\S]*?['"]models['"]|['"]profiles['"][\s\S]*?['"]skills['"][\s\S]*?['"]mcp['"][\s\S]*?['"]models['"]/,
    'the four large catalogs must share one organization contract',
  );
  assert.match(toolScreenSource, /Search \$\{manifest\.title\}|Search catalog/);
  assert.match(toolScreenSource, /Group by/);
  assert.match(toolScreenSource, /Sort by/);
  assert.match(toolScreenSource, /<List\.Section/);

  const fixtures = {
    skills: [
      { name: 'Zulu skill', source: 'managed' },
      { name: 'Alpha skill', source: 'personal' },
    ],
    mcp: {
      zulu: { status: 'disabled' },
      alpha: { status: 'connected' },
    },
    profiles: [
      { id: 'zulu', label: 'Zulu profile', isManager: false },
      { id: 'alpha', label: 'Alpha profile', isManager: true },
    ],
  };
  for (const [tool, input] of Object.entries(fixtures)) {
    assert.deepEqual(
      normalizeToolScreenResponse(tool, input).map(({ id }) => id),
      tool === 'skills'
        ? ['Alpha skill', 'Zulu skill']
        : ['alpha', 'zulu'],
      `${tool} must default to deterministic A-Z order`,
    );
  }
});

test('issue-1285-c5: Providers & Models explains and limits the catalog to configured or available entries', () => {
  // Regression caught: every provider known to the upstream engine is shown,
  // including providers never configured or made available in Rhythm.
  const records = normalizeToolScreenResponse('models', {
    providers: {
      all: [
        { id: 'unused', name: 'Never configured' },
        { id: 'openai', name: 'OpenAI' },
        { id: 'anthropic', name: 'Anthropic' },
      ],
      connected: ['anthropic'],
    },
    auth: {
      anthropic: [{ type: 'oauth', label: 'Anthropic account' }],
      openai: [{ type: 'api', label: 'OpenAI API key' }],
      unused: [{ type: 'api', label: 'Unused API key' }],
    },
    config: { enabled_providers: ['openai'] },
  });

  assert.deepEqual(
    records.map(({ id }) => id),
    ['anthropic', 'openai'],
  );
  assert.match(
    toolScreenSource,
    /Only [^.]*providers[^.]*models[^.]*(?:configured|available)[^.]*Rhythm/i,
    'the screen must explain why a provider/model is in this catalog',
  );
});

test('issue-1285-c6: native Agents and Tools paths cannot emit Fragment-prop or invalid-icon warnings', async () => {
  // Regression caught: Paper clones Dialog.Actions children with `compact`,
  // which React rejects when the direct child is a Fragment; server-supplied
  // profile icon strings can also be invalid MaterialCommunityIcons names.
  assert.doesNotMatch(
    sessionSheetSource,
    /<Dialog\.Actions>[\s\S]*?<>[\s\S]*?<\/Dialog\.Actions>/,
  );
  assert.doesNotMatch(
    sessionSheetSource,
    /profile\.display\?\.icon\s*\|\|/,
    'untrusted profile icon metadata must be normalized before reaching Paper',
  );

  const glyphs = JSON.parse(
    await readFile(
      new URL(
        '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const relevantSource = `${agentsSource}\n${chatListSource}\n${toolScreenSource}\n${sessionSheetSource}`;
  const staticIcons = [
    ...relevantSource.matchAll(
      /(?:name|icon|leadingIcon|trailingIcon)=["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
  for (const icon of staticIcons) {
    assert.ok(glyphs[icon], `invalid MaterialCommunityIcons name: ${icon}`);
  }
});

test('issue-1285-c10: initial open awaits messages only and defers supplemental state', () => {
  // Regression caught: the Opening chat screen waits for diff calculation,
  // todos, permissions, and questions even after the bounded transcript page
  // is available. The messages-first assertion fails on that blocking path.
  const loadStart = providerSource.indexOf('async loadSessionState(');
  const loadEnd = providerSource.indexOf('\n    commit(payload)', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const loadSource = providerSource.slice(loadStart, loadEnd);
  assert.match(loadSource, /const messages = await svcGetSessionMessages/);
  assert.doesNotMatch(
    loadSource,
    /await Promise\.all\(\[\s*svcGetSessionMessages[\s\S]*?svcGetSessionTodos[\s\S]*?listPendingInteractions/,
  );
  assert.match(loadSource, /supplemental|defer|background/i);
});

function activity(id, source, sessionId) {
  return {
    id,
    source,
    status: 'completed',
    title: id,
    summary: null,
    occurredAt: '2026-07-31T15:00:00.000Z',
    startedAt: '2026-07-31T14:59:00.000Z',
    completedAt: '2026-07-31T15:00:00.000Z',
    sessionId,
    resultUrl: null,
    profileId: null,
    projectId: null,
  };
}

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
