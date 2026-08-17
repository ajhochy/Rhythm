import { expect, type Page, type Route } from '@playwright/test';

export const localSessionId = 'phase-5-local-session';
export const sdkSessionId = 'phase-5-sdk-session';

export const canonicalProfile = {
  id: 'phase-5-profile',
  label: 'Phase 5 profile',
  icon: 'P5',
  enabled: true,
  isAgent: true,
  isManager: true,
  systemPrompt: 'Exercise permissioned controls.',
  allowedMcpsJson: null,
  allowedSkillsJson: null,
  corePermissionsJson: '{"bash":"ask"}',
  allowedDelegatesJson: '["phase-5-child-profile"]',
  presetId: null,
  sortOrder: 5,
  modelProvider: 'openai',
  modelId: 'gpt-5.6',
  ocAgent: 'build',
  sessionSelectable: true,
  modelTierHint: null,
  defaultAnthropicAccountId: null,
};

export const canonicalSession = {
  id: localSessionId,
  sdkSessionId,
  profileId: canonicalProfile.id,
  opencodeAgentId: 'build',
  parentSessionId: null,
  ownerUserId: 41,
  delegationDepth: 0,
  name: 'Phase 5 live session',
  cwd: '/workspace/phase-5',
  status: 'idle',
  permissionMode: 'default',
  providerId: 'openai',
  modelId: 'gpt-5.6',
  createdAt: '2026-08-15T12:00:00.000Z',
  updatedAt: '2026-08-15T12:00:01.000Z',
};

const canonicalMessages = [{
  info: { id: 'phase-5-output', role: 'output', time: '2026-08-15T12:00:01.000Z' },
  parts: [{ id: 'phase-5-text', type: 'text', text: 'Waiting for a human decision.' }],
}];

// Reflects the request's own Origin instead of a fixed port: a hardcoded port broke every
// mocked response as soon as this suite's webServer port was remapped for worktree isolation.
const corsHeaders = (route: Route) => ({
  'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval',
});

export const fulfillJson = (route: Route, status: number, json: unknown) =>
  route.fulfill({ status, headers: corsHeaders(route), json });

export type BoundaryRequest = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
  headers: Record<string, string>;
};

export type LiveBoundaryOptions = {
  sessions?: Array<Record<string, unknown>>;
  messagesBySession?: Record<string, unknown[]>;
  handleApi?: (route: Route, request: BoundaryRequest) => Promise<boolean> | boolean;
};

export async function openInterceptedLiveApp(
  page: Page,
  hash = '/#/agents',
  options: LiveBoundaryOptions = {},
) {
  const sessions = options.sessions ?? [canonicalSession];
  const requests: BoundaryRequest[] = [];
  const socketFrames: unknown[] = [];
  let sendToRenderer: ((frame: unknown) => void) | undefined;

  await page.routeWebSocket('ws://127.0.0.1:4098/ws/agents', (socket) => {
    sendToRenderer = (frame) => socket.send(JSON.stringify(frame));
    socket.onMessage((message) => {
      try { socketFrames.push(JSON.parse(String(message))); }
      catch { socketFrames.push(String(message)); }
    });
  });
  await page.route('http://127.0.0.1:4097/**', (route) => fulfillJson(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const raw = route.request();
    if (raw.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route) });
    const url = new URL(raw.url());
    const request: BoundaryRequest = {
      method: raw.method(),
      pathname: url.pathname,
      search: url.search,
      body: raw.postData() ? raw.postDataJSON() : undefined,
      headers: raw.headers(),
    };
    requests.push(request);
    if (options.handleApi && await options.handleApi(route, request)) return;
    if (url.pathname === '/health') return fulfillJson(route, 200, { healthy: true });
    if (url.pathname === '/agent-configs') return fulfillJson(route, 200, [canonicalProfile]);
    if (url.pathname === '/agent-sessions') return fulfillJson(route, 200, { sessions });
    const detail = url.pathname.match(/^\/agent-sessions\/([^/]+)$/);
    if (detail && raw.method() === 'GET') {
      const id = decodeURIComponent(detail[1]);
      const session = sessions.find((entry) => entry.id === id) ?? sessions[0];
      return fulfillJson(route, 200, {
        session,
        messages: options.messagesBySession?.[id] ?? canonicalMessages,
      });
    }
    return fulfillJson(route, 404, { error: { code: 'NOT_FOUND' } });
  });

  await page.goto(hash);
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toContainText('Environment: Live');
  await expect.poll(() => Boolean(sendToRenderer)).toBe(true);

  return {
    requests,
    socketFrames,
    send(frame: unknown) {
      if (!sendToRenderer) throw new Error('WebSocket route was not connected');
      sendToRenderer(frame);
    },
  };
}
