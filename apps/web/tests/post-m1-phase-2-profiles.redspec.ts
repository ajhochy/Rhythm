import { expect, test, type Page, type Request, type Route } from '@playwright/test';

const canonicalProfile = {
  id: 'phase-2-canonical-profile',
  label: 'Phase 2 Canonical Profile',
  icon: 'P2',
  enabled: true,
  isAgent: true,
  isManager: false,
  systemPrompt: 'Preserve canonical profile identity.',
  allowedMcpsJson: '["rhythm"]',
  allowedSkillsJson: '["verification"]',
  corePermissionsJson: '{"shell":"ask"}',
  allowedDelegatesJson: '[]',
  presetId: null,
  sortOrder: 42,
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  ocAgent: 'phase-2-canonical-profile',
  sessionSelectable: true,
  modelTierHint: null,
  defaultAnthropicAccountId: null,
};

function jsonBody(request: Request): Record<string, unknown> {
  return request.postDataJSON() as Record<string, unknown>;
}

type ApiHandler = (route: Route) => Promise<boolean> | boolean;
const corsHeaders = {
  'access-control-allow-origin': 'http://127.0.0.1:4173',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

const fulfillJson = (route: Route, status: number, json: unknown) => route.fulfill({ status, headers: corsHeaders, json });

async function openLiveGateway(page: Page, apiHandler?: ApiHandler) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.route('http://127.0.0.1:4097/**', (route) => fulfillJson(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (apiHandler) {
      if (await apiHandler(route)) return;
    }
    const { pathname } = new URL(route.request().url());
    if (pathname === '/agent-configs') return fulfillJson(route, 200, [canonicalProfile]);
    if (pathname === '/agent-sessions') return fulfillJson(route, 200, { sessions: [] });
    if (pathname === '/health') return fulfillJson(route, 200, { healthy: true });
    return fulfillJson(route, 404, { error: { code: 'NOT_FOUND' } });
  });
  await page.goto('/#/profiles');
  await expect(page.getByTestId('profile-create')).toBeVisible();
}

test('post-m1-p2-c1a: list and selection preserve canonical profile and model identifiers', async ({ page }) => {
  // Regression caught: the renderer ignores the API catalog and keeps using display-only
  // Profile.provider/Profile.model fixture rows; the canonical profile-id assertion fails.
  await openLiveGateway(page);

  await expect(page.getByTestId(`profile-${canonicalProfile.id}`)).toBeVisible();
  await page.getByTestId(`profile-${canonicalProfile.id}`).click();
  await expect(page.getByTestId('profile-provider')).toHaveValue(canonicalProfile.modelProvider);
  await expect(page.getByTestId('profile-model')).toHaveValue(canonicalProfile.modelId);
  await expect(page.getByText(/Anthropic · claude-sonnet-4-6/)).toHaveCount(0);
});

test('post-m1-p2-c1b: create posts canonical modelProvider/modelId and adopts the server id', async ({ page }) => {
  // Regression caught: Create mutates fixture state with a client-generated id and never POSTs
  // canonical modelProvider/modelId; the captured-request assertion fails.
  const posts: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/agent-configs') {
      posts.push(jsonBody(request));
    }
  });

  await openLiveGateway(page, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/agent-configs' && request.method() === 'POST') {
      await fulfillJson(route, 201, { ...canonicalProfile, ...jsonBody(request), id: 'phase-2-server-id', label: 'Canonical Create' });
      return true;
    }
    return false;
  });
  await page.getByTestId('profile-create').click();
  await page.getByTestId('profile-label').fill('Canonical Create');
  await page.getByTestId('profile-provider').selectOption({ label: 'Anthropic' });
  await page.getByTestId('profile-model').selectOption('claude-sonnet-4');
  await page.getByTestId('profile-save').click();

  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    label: 'Canonical Create',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4',
  });
  expect(posts[0]).not.toHaveProperty('provider');
  expect(posts[0]).not.toHaveProperty('model');
  await expect(page.getByTestId('profile-phase-2-server-id')).toBeVisible();
});

test('post-m1-p2-c1c: edit patches canonical nullable model fields without display aliases', async ({ page }) => {
  // Regression caught: Save updates only React memory or submits provider/model display aliases;
  // the exact PATCH body assertion fails.
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'PATCH' && url.pathname.startsWith('/agent-configs/')) {
      patches.push({ path: url.pathname, body: jsonBody(request) });
    }
  });

  const coordinator = { ...canonicalProfile, id: 'profile-coordinator', label: 'Rhythm Coordinator' };
  await openLiveGateway(page, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/agent-configs' && request.method() === 'GET') {
      await fulfillJson(route, 200, [coordinator]);
      return true;
    } else if (pathname === '/agent-configs/profile-coordinator' && request.method() === 'PATCH') {
      await fulfillJson(route, 200, { ...coordinator, ...jsonBody(request) });
      return true;
    }
    return false;
  });
  await page.getByTestId('profile-provider').selectOption({ label: 'Anthropic' });
  await page.getByTestId('profile-model').selectOption('claude-sonnet-4');
  await page.getByTestId('profile-save').click();

  await expect.poll(() => patches.length).toBe(1);
  await page.getByTestId('profile-provider').selectOption('');
  await page.getByTestId('profile-model').selectOption('');
  await page.getByTestId('profile-save').click();

  expect(patches).toEqual([
    {
      path: '/agent-configs/profile-coordinator',
      body: expect.objectContaining({ modelProvider: 'anthropic', modelId: 'claude-sonnet-4' }),
    },
    {
      path: '/agent-configs/profile-coordinator',
      body: expect.objectContaining({ modelProvider: null, modelId: null }),
    },
  ]);
  for (const patch of patches) {
    expect(patch.body).not.toHaveProperty('provider');
    expect(patch.body).not.toHaveProperty('model');
  }
});

test('post-m1-p2-c1d: selected profileId stays distinct from local and SDK session ids', async ({ page }) => {
  // Regression caught: the fixture-only session creator never sends the selected Rhythm profileId
  // through the live boundary; the POST assertion fails before identities can be conflated.
  const creates: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/agent-sessions') {
      creates.push(jsonBody(request));
    }
  });

  const localId = 'phase-2-local-session';
  const sdkSessionId = 'phase-2-sdk-session';
  await openLiveGateway(page, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/agent-configs' && request.method() === 'GET') {
      await fulfillJson(route, 200, [{ ...canonicalProfile, id: 'profile-coordinator' }]);
      return true;
    } else if (pathname === '/agent-sessions' && request.method() === 'POST') {
      await fulfillJson(route, 201, {
          id: localId,
          sdkSessionId,
          profileId: 'profile-coordinator',
          providerId: canonicalProfile.modelProvider,
          modelId: canonicalProfile.modelId,
          name: 'Canonical identity session',
          cwd: '/workspace/rhythm',
          status: 'idle',
          createdAt: '2026-08-15T12:00:00.000Z',
          updatedAt: '2026-08-15T12:00:00.000Z',
      });
      return true;
    }
    return false;
  });
  await page.goto('/#/agents');
  await expect(page.getByTestId('new-chat-instant')).toBeVisible();
  await page.getByTestId('new-chat-instant').click();

  await expect.poll(() => creates.length).toBe(1);
  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({ profileId: 'profile-coordinator' });
  expect(creates[0]).not.toHaveProperty('id');
  expect(creates[0]).not.toHaveProperty('sdkSessionId');
  expect(localId).not.toBe(sdkSessionId);
  expect(localId).not.toBe('profile-coordinator');
  expect(sdkSessionId).not.toBe('profile-coordinator');
  await expect(page.getByTestId(`session-${localId}`)).toBeVisible();
  await expect(page.getByTestId(`session-${sdkSessionId}`)).toHaveCount(0);
  await expect(page.getByText('Profile prompt · profile-coordinator')).toBeVisible();
});
