import { expect, test, type Page } from '@playwright/test';

// Covers issue: inline image thumbnails for hosted chat attachments (user file parts and
// tool-result attachments), while non-image attachments (e.g. PDFs) stay filename/mime chips.
// Modeled on the openControlledLive() harness in post-m1-phase-4-session-lifecycle.live.redspec.ts,
// trimmed to just what this spec needs (no WS, no pagination, no cancel/resume routes).

const API = 'http://127.0.0.1:4198';
const ENGINE = 'http://127.0.0.1:4197';
const LOCAL_ID = 'attach-thumb-session';
const SDK_ID = 'ses_attachthumb';
const NOW = '2026-09-28T18:00:00.000Z';

// 1x1 transparent PNG, reused both as a `data:` URL and as the mocked /artifacts/ response body.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type CanonicalPart = Record<string, unknown> & { id: string; type: string };

const canonicalSession = (patch: Record<string, unknown> = {}) => ({
  id: LOCAL_ID,
  profileId: 'profile-thumb',
  opencodeAgentId: 'build',
  status: 'idle',
  statusMessage: null,
  sdkSessionId: SDK_ID,
  cwd: '/workspace/rhythm',
  name: 'Attachment thumbnail session',
  projectId: null,
  providerId: 'omlx',
  modelId: 'gpt-oss-20b-MXFP4-Q8',
  archivedAt: null,
  category: 'chat',
  parentSessionId: null,
  worktreeName: null,
  worktreePath: null,
  worktreeBranch: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

const message = (id: number, role: 'input' | 'output', sdkMessageId: string, parts: CanonicalPart[]) => ({
  id,
  sessionId: LOCAL_ID,
  role,
  rawText: '',
  strippedText: '',
  createdAt: NOW,
  sdkMessageId,
  parts,
  tokens: null,
  cost: null,
});

async function openWithMessages(page: Page, messages: ReturnType<typeof message>[]) {
  const artifactRequests: Array<{ path: string; headers: Record<string, string> }> = [];
  const session = canonicalSession();

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== API && url.origin !== ENGINE) { await route.continue(); return; }

    if (url.origin === ENGINE && url.pathname === '/global/health') {
      await route.fulfill({ status: 200, json: { healthy: true } });
    } else if (url.pathname === '/health') {
      await route.fulfill({ status: 200, json: { status: 'ok' } });
    } else if (url.pathname === '/agent-configs' && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: [{
        id: 'profile-thumb', label: 'Thumbnail profile', icon: 'T', enabled: true,
        isAgent: true, isManager: false, sessionSelectable: true,
        modelProvider: 'omlx', modelId: 'gpt-oss-20b-MXFP4-Q8', ocAgent: 'build',
        allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{}',
        allowedDelegatesJson: '[]', sortOrder: 0, updatedAt: NOW,
      }] });
    } else if (url.pathname === '/agent-sessions' && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { sessions: [session] } });
    } else if (url.pathname === `/agent-sessions/${LOCAL_ID}` && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { session, messages, transcriptPage: { nextCursor: null, hasMore: false } } });
    } else if (url.pathname.startsWith('/artifacts/') && request.method() === 'GET') {
      artifactRequests.push({ path: url.pathname, headers: request.headers() });
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') });
    } else {
      await route.fulfill({ status: 501, json: { error: `Unhandled contract route ${request.method()} ${url.pathname}` } });
    }
  });

  // Attachment fetches don't go through the session WebSocket, but the shell still opens one
  // on session select — stub it so that doesn't hang the page.
  await page.routeWebSocket(`ws://127.0.0.1:4198/ws/agents`, () => {});

  await page.goto('/#/agents');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Attachment thumbnail session' })).toBeVisible();
  return { artifactRequests };
}

test('renders a thumbnail for a data: URL user file part', async ({ page }) => {
  await openWithMessages(page, [
    message(1, 'input', 'msg_data_file', [
      { id: 'in-file', type: 'file', mime: 'image/png', filename: 'chapel-front.jpg', url: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]),
  ]);
  const wrap = page.getByTestId('message-msg_data_file').locator('.attachment-thumbnail-wrap');
  await expect(wrap).toBeVisible();
  await expect(wrap.locator('img.attachment-thumbnail')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(wrap).toContainText('chapel-front.jpg');
});

test('fetches a tool attachment through /artifacts/ with the X-Rhythm-Project header', async ({ page }) => {
  const { artifactRequests } = await openWithMessages(page, [
    message(1, 'output', 'msg_tool_attachment', [
      {
        id: 'out-tool', type: 'tool', callID: 'call_read_image', tool: 'read',
        state: {
          status: 'completed', title: 'Read chapel-front.jpg', output: 'Read 1 image',
          attachments: [{ type: 'file', mime: 'image/png', url: '/artifacts/img-42', artifactId: 'img-42', artifactProject: 'proj-visalia', size: 68 }],
        },
      },
    ]),
  ]);
  const details = page.locator('.tool-block');
  await details.locator('summary').click();
  const wrap = details.locator('.attachment-thumbnail-wrap');
  await expect(wrap.locator('img.attachment-thumbnail')).toBeVisible();
  await expect.poll(() => artifactRequests.some((request) => request.path === '/artifacts/img-42' && request.headers['x-rhythm-project'] === 'proj-visalia')).toBe(true);
});

test('keeps a PDF attachment as a chip, not a thumbnail', async ({ page }) => {
  await openWithMessages(page, [
    message(1, 'input', 'msg_pdf_file', [
      { id: 'in-pdf', type: 'file', mime: 'application/pdf', filename: 'facility-agreement.pdf', url: '/artifacts/pdf-7', artifactId: 'pdf-7', artifactProject: 'proj-visalia' },
    ]),
  ]);
  const message1 = page.getByTestId('message-msg_pdf_file');
  await expect(message1.locator('[data-testid="file-in-pdf"]')).toBeVisible();
  await expect(message1.locator('[data-testid="file-in-pdf"]')).toContainText('facility-agreement.pdf');
  await expect(message1.locator('img.attachment-thumbnail')).toHaveCount(0);
});
