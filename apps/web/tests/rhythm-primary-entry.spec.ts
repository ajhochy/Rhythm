import { expect, test, type Page } from '@playwright/test';

type SetupMode = 'single' | 'multiple' | 'retry';

const localApi = 'http://127.0.0.1:65534';
const localEngine = 'http://127.0.0.1:65533';
const signedOrigin = 'https://rhythm-primary-entry.invalid';

const session = (id: string, projectId: string, name: string) => ({
  id,
  name,
  status: 'idle',
  category: 'chat',
  profileId: 'profile-a',
  cwd: `/fixture/${id}`,
  projectId,
  createdAt: '2026-10-05T16:00:00.000Z',
});

const rootConversation = () => ({
  schemaVersion: 3,
  id: 'conversation-rhythm-root',
  sessionId: 'rhythm-root',
  projectId: 'project-rhythm',
  controlRevision: 1,
  primaryOwnerRoot: true,
  ownerUserId: 4189,
  commandDedupe: [],
  goals: [],
  continuations: [],
});

// These labels deliberately exercise the longest ordinary catalog labels that
// prompted the reported overflow. Their fixture IDs remain opaque server data;
// the client does not choose a default profile.
const specialistProfileChoices = [
  { id: 'profile-coding-workflow', label: 'Coding Workflow' },
  { id: 'profile-workflow-retrospective', label: 'Workflow Retrospective' },
  { id: 'profile-worship-planning', label: 'Worship Planning' },
  { id: 'profile-worship-production', label: 'Worship Production' },
  { id: 'profile-theological-researcher', label: 'Theological Researcher' },
] as const;

const context = () => {
  const available = { state: 'available' };
  return {
    timeZone: 'America/Los_Angeles',
    asOf: '2026-10-05T16:00:00.000Z',
    today: '2026-10-05',
    yesterday: '2026-10-04',
    availability: {
      tasks: available,
      schedules: available,
      workstreams: available,
      receipts: available,
      manualActivity: available,
      rhythms: available,
    },
    todayTasks: [],
    waitingForReply: [],
    doneWithUnknownCompletionDate: [],
    scheduledPriorities: [],
    activeWorkstreams: [],
    executionSucceededGoalUnverified: [],
    staleExecutions: [],
    verifiedYesterday: [],
    usageHolds: [],
    receipts: [],
    coverage: {},
    activeRhythms: [],
    manualActivity: [],
    manualActivityDependency: null,
    modelContext: {},
  };
};

type FixtureState = {
  resolveCalls: number;
  resolveBodies: Record<string, unknown>[];
  setupBodies: Record<string, unknown>[];
  coordinatorOpenCalls: number;
  historyCalls: number;
  sessionInputFrames: Record<string, unknown>[];
  rootExists: boolean;
  retryFailed: boolean;
  setupRelease?: () => void;
};

async function openRhythmFixture(page: Page, options: {
  mode?: SetupMode;
  existingRoot?: boolean;
  holdSetup?: boolean;
} = {}): Promise<FixtureState> {
  const state: FixtureState = {
    resolveCalls: 0,
    resolveBodies: [],
    setupBodies: [],
    coordinatorOpenCalls: 0,
    historyCalls: 0,
    sessionInputFrames: [],
    rootExists: options.existingRoot ?? false,
    retryFailed: false,
  };
  const origin = session('ordinary-root', 'project-ordinary', 'Ordinary chat');
  const alternateOrigin = session('ordinary-other-root', 'project-other', 'Another ordinary chat');
  const rhythmRoot = session('rhythm-root', 'project-rhythm', 'Rhythm');
  let releaseSetup = () => {};
  const heldSetup = new Promise<void>((resolve) => { releaseSetup = resolve; });
  state.setupRelease = releaseSetup;

  await page.routeWebSocket(/\/ws\/agents$/, (socket) => {
    socket.onMessage((frame) => {
      try {
        const value = JSON.parse(String(frame)) as Record<string, unknown>;
        if (value.type === 'session.input' || value.type === 'session.command') state.sessionInputFrames.push(value);
      } catch {
        // The fixture only records valid client frames; malformed data never reaches a provider.
      }
    });
  });
  await page.route((url) => [localApi, localEngine, signedOrigin].includes(url.origin), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (json: unknown, status = 200) => route.fulfill({ status, json });
    const body = request.postDataJSON() as Record<string, unknown> | null;

    if (url.pathname.startsWith('/coordinator-conversations/')) {
      expect(request.headers().authorization).toBe('Bearer synthetic-rhythm-entry-token');
      if (url.pathname.endsWith('/resolve')) {
        state.resolveCalls += 1;
        state.resolveBodies.push(body ?? {});
        return state.rootExists
          ? respond({ kind: 'resolved', created: false, sessionId: rhythmRoot.id, projectId: rhythmRoot.projectId, conversation: rootConversation() })
          : respond({ kind: 'setup_unavailable' }, 503);
      }
      if (url.pathname.endsWith('/setup')) {
        expect(body).toBeTruthy();
        state.setupBodies.push(body!);
        if (options.holdSetup && state.setupBodies.length === 1) await heldSetup;
        if (options.mode === 'retry' && !state.retryFailed) {
          state.retryFailed = true;
          return respond({ kind: 'setup_unavailable' }, 503);
        }
        if (options.mode === 'multiple' && body?.profileId === undefined) {
          return respond({
            kind: 'setup_profile_choice_required',
            profileChoices: specialistProfileChoices,
          });
        }
        state.rootExists = true;
        return respond({
          kind: 'setup_created',
          sessionId: rhythmRoot.id,
          projectId: rhythmRoot.projectId,
          profileId: String(body?.profileId ?? specialistProfileChoices[0].id),
          workspaceGeneration: 1,
          conversation: rootConversation(),
        }, 201);
      }
      if (url.pathname.endsWith('/open')) {
        state.coordinatorOpenCalls += 1;
        return respond({ kind: 'replay', conversation: rootConversation() });
      }
      if (url.pathname.endsWith('/status')) {
        return respond({ kind: 'status', conversation: rootConversation(), context: context() });
      }
      if (url.pathname.endsWith('/history')) {
        state.historyCalls += 1;
        return respond({
          kind: 'history',
          conversation: rootConversation(),
          messages: [{
            id: 1,
            sessionId: rhythmRoot.id,
            role: 'output',
            rawText: 'Persisted Rhythm history',
            strippedText: 'Persisted Rhythm history',
            createdAt: '2026-10-05T15:59:00.000Z',
            sdkMessageId: 'sdk-rhythm-history-1',
            parts: [{ id: 'history-text', type: 'text', text: 'Persisted Rhythm history' }],
            tokens: null,
            cost: null,
          }],
          nextCursor: null,
          hasMore: false,
        });
      }
      return respond({ error: 'Unexpected coordinator operation' }, 500);
    }

    if (request.method() === 'GET' && url.pathname === '/agent-sessions') {
      const sessions = state.rootExists ? [rhythmRoot, origin, alternateOrigin] : [origin, alternateOrigin];
      return respond({ sessions, ancestors: [], pageInfo: { nextCursor: null, hasMore: false } });
    }
    if (request.method() === 'GET' && url.pathname === `/agent-sessions/${origin.id}`) {
      return respond({ session: origin, messages: [] });
    }
    if (request.method() === 'GET' && url.pathname === `/agent-sessions/${alternateOrigin.id}`) {
      return respond({ session: alternateOrigin, messages: [] });
    }
    if (request.method() === 'GET' && url.pathname === `/agent-sessions/${rhythmRoot.id}`) {
      return respond({ session: rhythmRoot, messages: [] });
    }
    if (request.method() === 'GET' && url.pathname === '/agent-configs') {
      return respond([{ id: 'profile-a', label: 'Current profile', enabled: true, sessionSelectable: true, isDefault: true }]);
    }
    if (request.method() === 'GET' && (url.pathname === '/opencode/auth/accounts' || url.pathname === '/opencode/auth/openai/accounts')) {
      return respond({ accounts: [] });
    }
    if (request.method() === 'GET' && url.pathname === '/agents/models/catalog') return respond([]);
    if (request.method() === 'GET' && url.pathname === '/projects') return respond([]);
    if (request.method() === 'GET' && url.pathname.includes('health')) return respond({ healthy: true, status: 'ready' });
    if (request.method() === 'GET') return respond([]);
    return respond({ error: 'Unexpected mutation' }, 500);
  });

  await page.route('**/tests/rhythm-primary-entry-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Rhythm primary entry fixture</title></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/.vite/deps/react-dom_client.js');
    const {FixtureProvider} = await import('/src/store.tsx');
    const {composeGateway} = await import('/src/gateway/index.ts');
    const {GatewayProvider} = await import('/src/gateway/context.tsx');
    const {AuthUserProvider} = await import('/src/gateway/auth.tsx');
    const {AgentsWorkspace} = await import('/src/components/AgentsWorkspace.tsx');
    await import('/src/styles.css');
    history.replaceState(null, '', '#/agents');
    const gateway = composeGateway({mode:'live',apiBase:'${localApi}',expectedApiBase:'${localApi}',engineBase:'${localEngine}',expectedEngineBase:'${localEngine}',productionApiBase:'${signedOrigin}',taskToken:'synthetic-rhythm-entry-token'});
    const h = React.createElement;
    createRoot(document.getElementById('root')).render(h(AuthUserProvider,{user:{id:4189,name:'Fixture user',email:'fixture@example.invalid',role:'user'}},h(GatewayProvider,{gateway},h(FixtureProvider,null,h('main',{style:{height:'900px'}},h(AgentsWorkspace))))));
  </script></body></html>` }));
  await page.goto('/tests/rhythm-primary-entry-fixture.html');
  await expect(page.getByTestId('rhythm-primary-entry')).toBeVisible();
  return state;
}

async function expectRhythmRoot(page: Page, state: FixtureState) {
  await expect(page.getByTestId('coordinator-conversation-card')).toBeVisible();
  await expect(page.getByText('Persisted Rhythm history', { exact: true })).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await expect.poll(() => state.historyCalls).toBeGreaterThan(0);
  expect(state.sessionInputFrames).toEqual([]);
}

async function expectSpecialistChoiceLayout(page: Page, expectedColumns: 1 | 2) {
  const dialog = page.getByTestId('rhythm-setup-dialog');
  const list = page.getByTestId('rhythm-setup-choice-list');
  await expect(list).toBeVisible();
  await expect(page.getByTestId('rhythm-setup-footer')).toBeVisible();
  const dialogWidth = await dialog.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(dialogWidth.scrollWidth).toBeLessThanOrEqual(dialogWidth.clientWidth + 1);
  const layout = await list.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      list: { left: bounds.left, right: bounds.right },
      buttons: [...element.querySelectorAll('button')].map((button) => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
      }),
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.buttons).toHaveLength(specialistProfileChoices.length);
  for (const button of layout.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.left).toBeGreaterThanOrEqual(layout.list.left - 1);
    expect(button.right).toBeLessThanOrEqual(layout.list.right + 1);
  }
  if (expectedColumns === 2) {
    expect(Math.abs(layout.buttons[0].top - layout.buttons[1].top)).toBeLessThanOrEqual(1);
    expect(layout.buttons[2].top).toBeGreaterThan(layout.buttons[0].top + 1);
  } else {
    for (let index = 1; index < layout.buttons.length; index += 1) {
      expect(Math.abs(layout.buttons[index].left - layout.buttons[0].left)).toBeLessThanOrEqual(1);
      expect(layout.buttons[index].top).toBeGreaterThan(layout.buttons[index - 1].top + 1);
    }
  }
  await expect(dialog).toContainText('This does not change permissions.');
}

test('first primary-entry click visibly sets up one eligible profile, opens the server root, and never sends an SDK prompt', async ({ page }) => {
  const state = await openRhythmFixture(page, { mode: 'single', holdSetup: true });
  await page.getByTestId('rhythm-primary-entry').click();
  const status = page.getByTestId('rhythm-primary-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Setting up Rhythm');
  expect(state.setupBodies).toHaveLength(1);
  expect(state.setupBodies[0]).toMatchObject({ commandKey: expect.any(String) });
  expect(state.setupBodies[0]).not.toHaveProperty('profileId');
  state.setupRelease?.();
  await expectRhythmRoot(page, state);
  expect(state.resolveCalls).toBe(1);
  expect(state.coordinatorOpenCalls).toBe(1);
});

test('multiple server-offered profiles reopen after Escape or keep-chat without another setup request', async ({ page }) => {
  const state = await openRhythmFixture(page, { mode: 'multiple' });
  await page.getByTestId('rhythm-primary-entry').click();
  const dialog = page.getByTestId('rhythm-setup-dialog');
  await expect(dialog).toBeVisible();
  for (const choice of specialistProfileChoices) await expect(dialog).toContainText(choice.label);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByTestId('rhythm-primary-entry').click();
  await expect(dialog).toBeVisible();
  expect(state.setupBodies).toHaveLength(1);
  await page.getByTestId('rhythm-setup-keep-ordinary').click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('rhythm-primary-entry').click();
  await expect(dialog).toBeVisible();
  expect(state.setupBodies).toHaveLength(1);
  await page.getByTestId('rhythm-setup-profile-profile-worship-production').click();
  await expectRhythmRoot(page, state);
  expect(state.setupBodies).toHaveLength(2);
  expect(state.setupBodies[0]).toEqual({ commandKey: state.setupBodies[0].commandKey });
  expect(state.setupBodies[1]).toEqual({ commandKey: state.setupBodies[0].commandKey, profileId: 'profile-worship-production' });
});

test('five long server-offered profile choices remain contained and touchable at desktop, 390px, and 320px widths', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const state = await openRhythmFixture(page, { mode: 'multiple' });
  await page.getByTestId('rhythm-primary-entry').click();
  await expectSpecialistChoiceLayout(page, 2);
  expect(state.setupBodies).toHaveLength(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectSpecialistChoiceLayout(page, 1);
  await page.setViewportSize({ width: 320, height: 720 });
  await expectSpecialistChoiceLayout(page, 1);
  expect(state.setupBodies).toHaveLength(1);
});

test('a setup hold is visible and retries the exact setup request rather than leaving setup buried in the chat menu', async ({ page }) => {
  const state = await openRhythmFixture(page, { mode: 'retry' });
  await page.getByTestId('rhythm-primary-entry').click();
  const dialog = page.getByTestId('rhythm-setup-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('rhythm-setup-retry')).toBeVisible();
  await page.getByTestId('rhythm-setup-retry').click();
  await expectRhythmRoot(page, state);
  expect(state.setupBodies).toHaveLength(2);
  expect(state.setupBodies[1]).toEqual(state.setupBodies[0]);
});

test('an existing server root reopens after navigation and repeated entry clicks do not create another setup request', async ({ page }) => {
  const state = await openRhythmFixture(page, { existingRoot: true });
  await page.getByTestId('group-project-project-other').click();
  await page.getByTestId('session-ordinary-other-root').click();
  await expect(page.getByTestId('session-ordinary-other-root')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('rhythm-primary-entry').dblclick();
  await expectRhythmRoot(page, state);
  expect(state.setupBodies).toEqual([]);
  expect(state.resolveCalls).toBe(1);
  expect(state.resolveBodies).toEqual([{ projectId: 'project-other' }]);
  await page.reload();
  await expect(page.getByTestId('rhythm-primary-entry')).toBeVisible();
  await page.getByTestId('rhythm-primary-entry').click();
  await expectRhythmRoot(page, state);
  expect(state.setupBodies).toEqual([]);
  expect(state.resolveCalls).toBe(2);
});
