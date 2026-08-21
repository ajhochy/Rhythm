import { expect, test, type Page, type Request } from '@playwright/test';

const localId = 'phase6-local-session';
const sdkMessageId = 'msg-phase6-input';
const noncePath = 'phase6/nonce.txt';
const nonceText = 'phase6-real-file-nonce';

const profile = {
  id: 'local-lean',
  label: 'Local Lean',
  enabled: true,
  isAgent: true,
  isManager: false,
  sessionSelectable: true,
  isDefault: true,
  modelProvider: 'omlx',
  modelId: 'gpt-oss-20b-MXFP4-Q8',
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: localId,
    sdkSessionId: 'sdk-phase6-session',
    name: 'Phase 6 live session',
    profileId: profile.id,
    projectId: 'phase6-project',
    projectName: 'Phase 6 project',
    cwd: '/phase6/project',
    branch: 'feature/phase6-current',
    status: 'idle',
    createdAt: '2026-08-15T12:00:00.000Z',
    updatedAt: '2026-08-15T12:00:00.000Z',
    ...overrides,
  };
}

async function openMockedLive(page: Page, overrides: Record<string, unknown> = {}) {
  const requests: Request[] = [];
  const selected = session(overrides);
  await page.route('http://127.0.0.1:4097/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ healthy: true }) }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const request = route.request();
    requests.push(request);
    const url = new URL(request.url());
    if (url.pathname === '/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
    if (url.pathname === '/agent-configs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([profile]) });
    if (url.pathname === '/agent-sessions' && request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [selected] }) });
    if (url.pathname === `/agent-sessions/${localId}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: selected, messages: [{ id: sdkMessageId, info: { id: sdkMessageId, role: 'input' }, parts: [{ type: 'text', text: 'start' }] }] }) });
    if (url.pathname === '/agent-sessions' && request.method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(session({
        id: 'phase6-created-session',
        cwd: '/phase6/resolved-worktree',
        branch: 'opencode/phase6-created',
        worktreeName: 'phase6-created',
        worktreePath: '/phase6/resolved-worktree',
        worktreeBranch: 'opencode/phase6-created',
      })) });
    }
    if (url.pathname === `/agent-sessions/${localId}/files/find-files`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([noncePath]) });
    if (url.pathname === `/agent-sessions/${localId}/files/content`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: nonceText, mimeType: 'text/plain' }) });
    if (url.pathname === `/agent-sessions/${localId}/files/list`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: noncePath, type: 'file' }]) });
    if (url.pathname === `/agent-sessions/${localId}/files/status`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ path: noncePath, status: 'modified' }]) });
    if (url.pathname === `/agent-sessions/${localId}/diff`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ file: noncePath, before: '', after: nonceText, additions: 1, deletions: 0 }]) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto('/#/agents');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  return requests;
}

async function expectRequest(requests: Request[], predicate: (request: Request) => boolean, description: string) {
  await expect.poll(() => requests.some(predicate), { message: description }).toBe(true);
}

test('post-m1-p6-c1a: real file selection classifies canonical parts from selected bytes', async ({ page }) => {
  // Regression caught: the Attach control remains a five-item fixture menu and never opens a real
  // multi-file input; the file-input assertion fails before fabricated fixture metadata can pass.
  await openMockedLive(page);
  await page.getByTestId('composer-attach').click();
  const picker = page.locator('input[type="file"][multiple]');
  await expect(picker, 'live Attach must expose native multi-file selection').toHaveCount(1);
  await picker.setInputFiles([
    { name: 'nonce.txt', mimeType: 'text/plain', buffer: Buffer.from(nonceText) },
    { name: 'nonce.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { name: 'nonce.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 phase6') },
    { name: 'nonce.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0x00, 0xff, 0x06]) },
  ]);
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('nonce.txt');
});

test('post-m1-p6-c1b: @ search requests canonical server-side find-files and content routes', async ({ page }) => {
  // Regression caught: @ filters hard-coded fileFixtures and selection calls addFixture; the two
  // real-request assertions fail even though a convincing fixture suggestion is rendered.
  const requests = await openMockedLive(page);
  await page.getByTestId('composer-input').fill('@nonce');
  await expectRequest(requests, (request) => {
    const url = new URL(request.url());
    return request.method() === 'GET' && url.pathname === `/agent-sessions/${localId}/files/find-files`
      && url.searchParams.get('query') === 'nonce' && url.searchParams.get('type') === 'file'
      && Number(url.searchParams.get('limit')) > 0;
  }, 'typing @nonce must query the selected local session on the server');
  await page.getByRole('option', { name: new RegExp(noncePath) }).click();
  await expectRequest(requests, (request) => new URL(request.url()).pathname === `/agent-sessions/${localId}/files/content`, 'choosing a server result must fetch session-scoped content');
});

test('post-m1-p6-c1c: selected attachments cross live input as canonical parts', async ({ page }) => {
  // Regression caught: sendLiveInput accepts attachments but emits only data; native selection is
  // required first so fixture-only ComposerAttachment objects cannot conceal the transport gap.
  await openMockedLive(page);
  const picker = page.locator('input[type="file"][multiple]');
  await expect(picker).toHaveCount(1);
  await picker.setInputFiles({ name: 'nonce.txt', mimeType: 'text/plain', buffer: Buffer.from(nonceText) });
  await page.getByTestId('composer-input').fill('read the nonce');
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('toast-status')).toContainText(nonceText);
});

test('post-m1-p6-c1d: attachment chips preserve canonical filename and mime until accepted delivery', async ({ page }) => {
  // Regression caught: pending and transcript attachment state uses React-only fileUrl and clears
  // optimistically; the real picker requirement prevents that display shape from satisfying this.
  await openMockedLive(page);
  const picker = page.locator('input[type="file"][multiple]');
  await expect(picker).toHaveCount(1);
  await picker.setInputFiles({ name: 'phase6.txt', mimeType: 'text/plain', buffer: Buffer.from(nonceText) });
  const chip = page.getByRole('region', { name: 'Pending attachments' });
  await expect(chip).toContainText('phase6.txt');
  await expect(chip).toContainText('text/plain');
});

test('post-m1-p6-c1e: an oversized canonical parts payload retains retryable composer state', async ({ page }) => {
  // Regression caught: React cannot deliver parts to the existing 20 MiB boundary and therefore
  // cannot surface its bounded rejection while retaining the selected file for retry.
  await openMockedLive(page);
  const picker = page.locator('input[type="file"][multiple]');
  await expect(picker).toHaveCount(1);
  await picker.setInputFiles({ name: 'oversize.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 0x61) });
  await page.getByTestId('composer-send').click();
  await expect(page.getByRole('alert')).toContainText(/too large|20 MiB/i);
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('oversize.bin');
});

test('post-m1-p6-c2a: Files inspector uses find/list/content/status server results', async ({ page }) => {
  // Regression caught: the panel mutates a route trace while continuing to render fixture files;
  // the network assertions fail unless each real session-scoped operation is performed.
  const requests = await openMockedLive(page);
  await page.getByTestId('inspector-files').click();
  await page.getByTestId('file-search').fill('nonce');
  await page.getByTestId('files-refresh').click();
  for (const suffix of ['/files/find-files', '/files/list', '/files/status']) {
    await expectRequest(requests, (request) => new URL(request.url()).pathname === `/agent-sessions/${localId}${suffix}`, `Files inspector must request ${suffix}`);
  }
  await page.getByText(noncePath, { exact: true }).click();
  await expectRequest(requests, (request) => new URL(request.url()).pathname === `/agent-sessions/${localId}/files/content`, 'opening a file must fetch content');
  await expect(page.getByTestId('files-panel')).toContainText(nonceText);
});

test('post-m1-p6-c2c: Changes inspector fetches canonical session FileDiff', async ({ page }) => {
  // Regression caught: constant diffEntries render without GET /diff; the request assertion fails.
  const requests = await openMockedLive(page);
  await page.getByTestId('inspector-changes').click();
  await expectRequest(requests, (request) => request.method() === 'GET' && new URL(request.url()).pathname === `/agent-sessions/${localId}/diff`, 'Changes must fetch the selected session diff');
  await expect(page.getByTestId('changes-panel')).toContainText('phase6/nonce.txt');
});

test('post-m1-p6-c2d: VCS scopes request only canonical git and branch modes', async ({ page }) => {
  // Regression caught: scope buttons update local labels/traces but send no VCS requests.
  const requests = await openMockedLive(page);
  await page.getByTestId('inspector-changes').click();
  await page.getByTestId('changes-scope-git').click();
  await page.getByTestId('changes-scope-branch').click();
  for (const mode of ['git', 'branch']) {
    await expectRequest(requests, (request) => {
      const url = new URL(request.url());
      return url.pathname === `/agent-sessions/${localId}/vcs/diff` && url.searchParams.get('mode') === mode;
    }, `Changes must request canonical mode=${mode}`);
  }
});

test('post-m1-p6-c2e: patch export requests and preserves raw text/x-diff', async ({ page }) => {
  // Regression caught: Export patch only emits a toast/trace; the raw endpoint assertion fails.
  const requests = await openMockedLive(page);
  await page.getByTestId('inspector-changes').click();
  await page.getByTestId('changes-export').click();
  await expectRequest(requests, (request) => request.method() === 'GET' && new URL(request.url()).pathname === `/agent-sessions/${localId}/vcs/diff/raw`, 'Export must fetch the raw patch');
});

test('post-m1-p6-c2f: Revert posts canonical messageId and refreshes session diff', async ({ page }) => {
  // Regression caught: Revert mutates fixture state and a trace without POSTing messageId.
  const requests = await openMockedLive(page);
  await page.getByTestId('inspector-changes').click();
  await page.getByTestId('changes-revert').click();
  await page.getByTestId('worktree-confirm').click();
  await expectRequest(requests, (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== `/agent-sessions/${localId}/revert`) return false;
    return request.postDataJSON()?.messageId === sdkMessageId;
  }, 'Revert must post the selected SDK messageId');
  await expectRequest(requests, (request) => new URL(request.url()).pathname === `/agent-sessions/${localId}/diff`, 'Revert must refresh the real diff');
});

test('post-m1-p6-c3a: advanced creation sends branch, stash, and createBranch canonical fields', async ({ page }) => {
  // Regression caught: live submit drops all three branch fields although fixture submit retains them.
  const requests = await openMockedLive(page);
  await page.getByTestId('new-session-advanced').click();
  await page.getByTestId('advanced-name').fill('Phase 6 branch create');
  await page.getByTestId('advanced-branch').selectOption('__new__');
  await page.getByTestId('advanced-new-branch').fill('feature/phase6-created');
  await page.getByTestId('advanced-create').click();
  await expectRequest(requests, (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/agent-sessions') return false;
    const body = request.postDataJSON();
    return body.branch === 'feature/phase6-created' && body.createBranch === true && ['stash', 'discard'].includes(body.stash);
  }, 'live create must send canonical branch/createBranch/stash');
});

test('post-m1-p6-c3b: isolated create preserves resolved worktree identity and returned branch', async ({ page }) => {
  // Regression caught: the live mapper drops worktreeName/worktreePath/worktreeBranch and substitutes main.
  await openMockedLive(page);
  await page.getByTestId('new-session-advanced').click();
  await page.getByTestId('advanced-name').fill('Phase 6 isolated create');
  await page.getByTestId('advanced-isolate-worktree').check();
  await page.getByTestId('advanced-worktree-name').fill('phase6-created');
  await page.getByTestId('advanced-create').click();
  await expect(page.getByTestId('context-panel')).toContainText('/phase6/resolved-worktree');
  await expect(page.getByTestId('context-panel')).toContainText('opencode/phase6-created');
});

test('post-m1-p6-c3d: Reset posts the live session worktree route', async ({ page }) => {
  // Regression caught: Reset calls only the fixture store while displaying a truthful-looking trace.
  const requests = await openMockedLive(page, { worktreeName: 'phase6', worktreePath: '/phase6/worktree', worktreeBranch: 'opencode/phase6' });
  await page.getByTestId('inspector-changes').click();
  await page.getByTestId('worktree-reset').click();
  await page.getByTestId('worktree-confirm').click();
  await expectRequest(requests, (request) => request.method() === 'POST' && new URL(request.url()).pathname === `/agent-sessions/${localId}/worktree/reset`, 'Reset must call the live route');
});

test('post-m1-p6-c3e: Remove is closed-only and posts the live session worktree route', async ({ page }) => {
  // Regression caught: the closed-only button calls only fixture removal and clears local metadata.
  const requests = await openMockedLive(page, { status: 'closed', worktreeName: 'phase6', worktreePath: '/phase6/worktree', worktreeBranch: 'opencode/phase6' });
  await page.getByTestId('inspector-changes').click();
  await expect(page.getByTestId('worktree-remove')).toBeEnabled();
  await page.getByTestId('worktree-remove').click();
  await page.getByTestId('worktree-confirm').click();
  await expectRequest(requests, (request) => request.method() === 'POST' && new URL(request.url()).pathname === `/agent-sessions/${localId}/worktree/remove`, 'Remove must call the live route');
});
