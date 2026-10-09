import { mkdir } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';
import { canonicalProfile, canonicalSession } from './post-m1-phase-5-live-fixtures';

const a = canonicalSession.id;
const b = 'e16-session-b';
const child = 'e16-sdk-child';
const profiles = () => [
  { ...canonicalProfile, defaultAnthropicAccountId: 'account-old' },
  { ...canonicalProfile, id: 'phase-5-child-profile', label: 'Delegate', isManager: false, defaultAnthropicAccountId: null },
];
const messages = [{ info: { id: 'task-output', role: 'output' }, parts: [{ id: 'task-part', type: 'tool', tool: 'task', state: { title: 'E16 child', status: 'completed', output: `task_id: ${child} (for resuming)` } }] }];

async function open(page: Page, options: { working?: boolean; disabled?: boolean; delayMention?: boolean; delayChild?: boolean } = {}) {
  const denied: string[] = [];
  const requests: { method: string; path: string; body: any }[] = [];
  const frames: any[] = [];
  const rows = [canonicalSession, { ...canonicalSession, id: b, sdkSessionId: 'sdk-b', name: 'E16 B', cwd: '/workspace/e16-b' }].map((row) => ({ ...row, status: options.working ? 'working' : options.disabled ? 'closed' : 'idle', sdkSessionId: options.disabled ? null : row.sdkSessionId }));
  const records = profiles();
  let releaseMention: (() => Promise<void>) | undefined;
  let releaseChild: (() => Promise<void>) | undefined;
  await page.routeWebSocket('**/*', (socket) => {
    if (socket.url() !== 'ws://127.0.0.1:4098/ws/agents') { socket.close(); return; }
    socket.onMessage((data) => frames.push(JSON.parse(String(data))));
  });
  await page.route('**/*', async (route: Route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.origin === 'http://127.0.0.1:4188') return route.continue();
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4188', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PATCH,OPTIONS' };
    const reply = (json: unknown) => route.fulfill({ headers, json });
    if (['http://127.0.0.1:4098', 'http://127.0.0.1:4097', 'https://api.vcrcapps.com'].includes(url.origin)) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      requests.push({ method: req.method(), path: url.pathname + url.search, body: req.postData() ? req.postDataJSON() : null });
      if (req.method() === 'GET') {
        if (url.pathname === '/agents/usage-budget') return reply({ providers: [] });
        if (url.pathname === '/workspaces/me/members') return reply([]);
        if (/^\/agent-sessions\/[^/]+\/model-provenance$/.test(url.pathname)) return route.fulfill({ status: 404, headers, json: { error: 'No provenance yet' } });
        if (url.pathname === '/agents/models/catalog') return reply([{ provider: 'openai', modelId: 'gpt-5.6', displayName: 'GPT', authorized: true }]);
        if (url.pathname === '/opencode/auth/openai/accounts') return reply({ accounts: [], defaultAccountId: null });
        if (url.pathname === '/opencode/auth/accounts') return reply({ accounts: ['account-old', 'account-edited'].map(id => ({ id, label: id })), defaultId: null });
        if (['/projects', '/shares', '/question'].includes(url.pathname)) return reply([]);
        // Do not accept the renderer's /agent-sessions//... requests.
        if (/^\/agent-sessions\/[^/]+\/todo$/.test(url.pathname)) return reply([]);
        if (/^\/agent-sessions\/[^/]+\/memory-provenance$/.test(url.pathname)) return reply({ recorded: false, memoryIds: [], notePaths: [], items: [] });
        if (url.pathname === '/health') return reply({ healthy: true });
        if (['', a, b].some((id) => url.pathname === `/agent-run-outcomes/${id}`)) return route.fulfill({ status: 404, headers, json: { error: 'No outcome yet' } });
        if (['/message-threads', '/agent-approvals', '/notifications', '/opencode/commands', '/opencode/mcp', '/opencode/skills'].includes(url.pathname)) return reply([]);
        if (url.pathname === '/agent-configs') return reply(records);
        if (url.pathname === '/agent-sessions') return reply({ sessions: rows });
        for (const row of rows) {
          if (url.pathname === `/agent-sessions/${row.id}`) return reply({ session: row, messages: row.id === a ? messages : [] });
          if (url.pathname === `/agent-sessions/${row.id}/pending-permissions` || url.pathname === `/agent-sessions/${row.id}/pending-questions`) return reply([]);
        }
        if (url.pathname === `/agent-sessions/${a}/files/find-files`) return reply(['a-only.txt']);
        if (url.pathname === `/agent-sessions/${a}/files/content`) {
          releaseMention = () => reply({ content: 'A private mention', mimeType: 'text/plain' });
          if (!options.delayMention) await releaseMention();
          return;
        }
        if (url.pathname === `/agent-sessions/${a}/children/${child}/messages`) {
          releaseChild = () => reply({ messages: [{ info: { id: 'child-output', role: 'output' }, parts: [{ type: 'text', text: 'Child-only transcript' }] }] });
          if (!options.delayChild) await releaseChild();
          return;
        }
      }
      if (req.method() === 'PATCH' && url.pathname === `/agent-configs/${canonicalProfile.id}`) {
        Object.assign(records[0], req.postDataJSON());
        return reply(records[0]);
      }
    }
    denied.push(`${req.method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  await page.goto('/#/agents');
  await expect(page.getByTestId(`session-${a}`)).toBeVisible();
  await page.getByTestId(`session-${a}`).click();
  await expect(page.getByRole('heading', { name: canonicalSession.name, exact: true })).toBeVisible();
  return { denied, requests, frames, records,
    releaseMention: async () => { await expect.poll(() => Boolean(releaseMention)).toBe(true); await releaseMention!(); },
    releaseChild: async () => { await expect.poll(() => Boolean(releaseChild)).toBe(true); await releaseChild!(); },
  };
}

type DroppedFile = { name: string; type: string; bytes?: number[]; content?: string; size?: number };

async function dispatchComposerFileEvent(page: Page, eventType: 'dragenter' | 'dragover' | 'dragleave' | 'drop', files: DroppedFile[]) {
  return page.locator('[data-od-id="agent-composer"]').evaluate((element, input) => {
    const transfer = new DataTransfer();
    for (const file of input.files) {
      const content = file.size === undefined ? file.content ?? new Uint8Array(file.bytes ?? []) : new Uint8Array(file.size);
      transfer.items.add(new File([content], file.name, { type: file.type }));
    }
    return !element.dispatchEvent(new DragEvent(input.eventType, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { eventType, files });
}

test('e16-c1: bulk Cancel deselects without stopping either working agent', async ({ page }) => {
  const net = await open(page, { working: true });
  for (const id of [a, b]) await page.getByTestId(`session-${id}`).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('toolbar', { name: 'Selected session actions' })).toContainText('2 selected');
  await page.getByRole('toolbar').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Selected session actions' })).toHaveCount(0);
  for (const id of [a, b]) {
    await expect(page.getByTestId(`session-${id}`)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId(`session-${id}`)).toContainText('Working');
  }
  expect(net.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  expect(net.frames.filter((f) => /cancel|stop|input/.test(f.type))).toEqual([]);
  expect(net.denied).toEqual([]);
});

test('e16-c2: A files and delayed mention remain with A across A → B → A', async ({ page }) => {
  const net = await open(page, { delayMention: true });
  await page.getByTestId('composer-live-file-input').setInputFiles({ name: 'a-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('A private upload') });
  await page.getByTestId('composer-input').fill('@a-only');
  await page.getByTestId('mention-option-live-0').click();
  await page.getByTestId(`session-${b}`).click();
  await net.releaseMention();
  await expect(page.getByTestId('composer-input')).toHaveValue('');
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  await page.getByTestId('composer-input').fill('B only');
  await page.getByTestId('composer-send').click();
  await expect.poll(() => net.frames.filter((f) => f.type === 'session.input')).toEqual([
    { v: 1, type: 'session.input', id: b, data: 'B only', modelOverride: { providerId: 'openai', modelId: 'gpt-5.6' } },
  ]);
  await page.getByTestId(`session-${a}`).click();
  await expect(page.locator('.attachment-chip')).toHaveCount(2);
  await page.getByTestId('composer-input').fill('A only');
  await page.getByTestId('composer-send').click();
  await expect.poll(() => net.frames.filter((f) => f.type === 'session.input').at(-1)).toEqual({
    v: 1, type: 'session.input', id: a, parts: [{ type: 'text', text: 'A only' }, { type: 'text', text: 'A private mention' }, { type: 'text', text: 'A private upload' }], modelOverride: { providerId: 'openai', modelId: 'gpt-5.6' },
  });
  expect(net.requests.filter((r) => r.path.includes('/files/'))).toEqual([
    { method: 'GET', path: `/agent-sessions/${a}/files/find-files?query=a-only&limit=20&type=file`, body: null },
    { method: 'GET', path: `/agent-sessions/${a}/files/content?path=a-only.txt`, body: null },
  ]);
  expect(net.denied).toEqual([]);
});

test('composer-drop-c1: real dropped files stay on chat, preview, and use the existing send pipeline', async ({ page }) => {
  // Regression: browser drops navigated away because only the hidden file input accepted Files;
  // the status, pending rows, URL, and emitted image data URL assertions fail if that returns.
  const net = await open(page);
  const url = page.url();
  const files = [
    { name: 'screenshot.png', type: 'image/png', bytes: [137, 80, 78, 71] },
    { name: 'notes.txt', type: 'text/plain', content: 'notes' },
  ];

  await dispatchComposerFileEvent(page, 'dragenter', files);
  await expect(page.getByText('Drop files to attach', { exact: true })).toBeVisible();
  await mkdir('../../docs/ai/runs/artifacts/composer-drop-provider-model-search', { recursive: true });
  await page.screenshot({ path: '../../docs/ai/runs/artifacts/composer-drop-provider-model-search/composer-drag-active.png' });
  await dispatchComposerFileEvent(page, 'dragover', files);
  await dispatchComposerFileEvent(page, 'dragleave', files);
  await expect(page.getByText('Drop files to attach', { exact: true })).toHaveCount(0);
  await dispatchComposerFileEvent(page, 'dragenter', files);
  const prevented = await dispatchComposerFileEvent(page, 'drop', files);

  expect(prevented).toBe(true);
  await expect(page.getByText('Drop files to attach', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('screenshot.png');
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('image/png');
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('notes.txt');
  await page.screenshot({ path: '../../docs/ai/runs/artifacts/composer-drop-provider-model-search/composer-dropped-screenshot.png' });

  await page.getByTestId('composer-send').click();
  await expect.poll(() => net.frames.filter((frame) => frame.type === 'session.input').at(-1)).toMatchObject({
    id: a,
    parts: [
      { type: 'file', mime: 'image/png', filename: 'screenshot.png', url: expect.stringMatching(/^data:image\/png;base64,/) },
      { type: 'text', text: 'notes' },
    ],
  });
});

test('composer-drop-c2: PDF, other binary, and oversized drops retain selected bytes and send behavior', async ({ page }) => {
  // Regression: routing dropped Files around the existing resolver could lose PDF data URLs,
  // selected binary bytes, or the pre-send 20 MiB rejection that keeps the file pending.
  const net = await open(page);
  await dispatchComposerFileEvent(page, 'drop', [
    { name: 'document.pdf', type: 'application/pdf', bytes: [37, 80, 68, 70] },
    { name: 'archive.bin', type: 'application/octet-stream', bytes: [0, 1, 2] },
  ]);
  await page.getByTestId('composer-send').click();
  await expect.poll(() => net.frames.filter((frame) => frame.type === 'session.input').at(-1)).toMatchObject({
    id: a,
    parts: [
      { type: 'file', mime: 'application/pdf', filename: 'document.pdf', url: expect.stringMatching(/^data:application\/pdf;base64,/) },
      { type: 'file', mime: 'application/octet-stream', filename: 'archive.bin', url: expect.stringMatching(/^data:application\/octet-stream;base64,/) },
    ],
  });
  const binary = net.frames.filter((frame) => frame.type === 'session.input').at(-1)?.parts?.[1];
  expect([...Buffer.from(binary.url.split(',')[1], 'base64')]).toEqual([0, 1, 2]);

  const sentFrames = net.frames.filter((frame) => frame.type === 'session.input').length;
  await dispatchComposerFileEvent(page, 'drop', [
    { name: 'too-large.bin', type: 'application/octet-stream', size: 20 * 1024 * 1024 + 1 },
  ]);
  await page.getByTestId('composer-send').click();
  const feedback = page.getByTestId('attachment-feedback');
  await expect(feedback).toHaveAttribute('role', 'alert');
  await expect(feedback).toContainText('Could not send: too-large.bin is larger than the 20 MiB limit.');
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('too-large.bin');
  await page.waitForTimeout(100);
  expect(net.frames.filter((frame) => frame.type === 'session.input')).toHaveLength(sentFrames);
});

test('composer-drop-c4: disabled live composer blocks navigation and explains rejected files', async ({ page }) => {
  // Regression: disabled controls did not cover the form drop target; pending attachments and
  // missing feedback assertions fail if read-only sessions silently accept or navigate on drop.
  await open(page, { disabled: true });
  const prevented = await dispatchComposerFileEvent(page, 'drop', [{ name: 'blocked.txt', type: 'text/plain', content: 'blocked' }]);
  expect(prevented).toBe(true);
  await expect(page.getByTestId('live-attachment-list')).toHaveCount(0);
  await expect(page.getByTestId('attachment-feedback')).toContainText('This run has ended.');
});

test('e16-c3: ephemeral child cannot compose to parent and rail selection exits child', async ({ page }) => {
  const net = await open(page);
  await page.getByTestId(`open-child-${child}`).click();
  await expect(page.getByText('Child-only transcript', { exact: true })).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveCount(0);
  await expect(page.getByTestId('composer-send')).toHaveCount(0);
  await expect(page.getByTestId('composer-live-file-input')).toHaveCount(0);
  await page.getByTestId(`session-${b}`).click();
  await expect(page.getByTestId('child-back')).toHaveCount(0);
  await expect(page.getByText('Child-only transcript', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  expect(net.frames.filter((f) => f.type === 'session.input')).toEqual([]);
  expect(net.denied).toEqual([]);
});

test('e16-c3-race: delayed child response cannot replace another rail session', async ({ page }) => {
  const net = await open(page, { delayChild: true });
  await page.getByTestId(`open-child-${child}`).click();
  await page.getByTestId(`session-${b}`).click();
  await net.releaseChild();
  await expect(page.getByRole('heading', { name: 'E16 B', exact: true })).toBeVisible();
  await expect(page.getByTestId('child-back')).toHaveCount(0);
  expect(net.denied).toEqual([]);
});

// Profiles is a column browser: open a setting group before using its controls.
const openGroup = (page: Page, name: string) => page.getByTestId('settings-column-groups').getByRole('option', { name, exact: true }).click();

test('e16-c4-policy: edited permission/delegates override stale raw JSON and survive reload', async ({ page }) => {
  const net = await open(page);
  if (await page.getByTestId('rail-more').getAttribute('aria-expanded') !== 'true') await page.getByTestId('rail-more').click(); await page.getByTestId('tool-profiles').click();
  await page.getByTestId(`profile-${canonicalProfile.id}`).click();
  await openGroup(page, 'Permissions');
  await expect(page.getByTestId('profile-permissions')).toHaveValue('{"bash":"ask"}');
  await page.getByText('Advanced (JSON)', { exact: true }).click();
  await page.getByTestId('profile-permissions').fill('{"bash":"deny"}');
  await openGroup(page, 'Delegation');
  await expect(page.getByTestId('delegate-phase-5-child-profile')).toBeChecked();
  await page.getByTestId('delegate-phase-5-child-profile').uncheck();
  await page.getByTestId('profile-save').click();
  await expect.poll(() => net.requests.filter((r) => r.method === 'PATCH').length).toBe(1);
  expect(net.requests.find((r) => r.method === 'PATCH')).toEqual({ method: 'PATCH', path: `/agent-configs/${canonicalProfile.id}`, body: {
    corePermissionsJson: '{"bash":"deny"}', allowedDelegatesJson: '[]',
  } });
  expect(net.records[0]).toEqual({ ...canonicalProfile, corePermissionsJson: '{"bash":"deny"}', allowedDelegatesJson: '[]', defaultAnthropicAccountId: 'account-old' });
  await page.reload();
  await page.getByTestId(`profile-${canonicalProfile.id}`).click();
  await expect(page.getByTestId('delegate-phase-5-child-profile')).not.toBeChecked();
  await openGroup(page, 'Permissions');
  await expect(page.getByTestId('profile-permissions')).toHaveValue('{"bash":"deny"}');
  expect(net.denied).toEqual([]);
});

test('e16-c4-account: canonical account ID edit and clear survive reload', async ({ page }) => {
  const net = await open(page);
  if (await page.getByTestId('rail-more').getAttribute('aria-expanded') !== 'true') await page.getByTestId('rail-more').click(); await page.getByTestId('tool-profiles').click();
  await page.getByTestId(`profile-${canonicalProfile.id}`).click();
  await openGroup(page, 'Provider, model & account');
  await expect(page.getByTestId('profile-account')).toHaveValue('account-old');
  for (const account of ['account-edited', '']) {
    await page.getByTestId('profile-account').selectOption(account);
    await page.getByTestId('profile-save').click();
    await expect.poll(() => net.records[0].defaultAnthropicAccountId).toBe(account || null);
    expect(net.requests.filter((r) => r.method === 'PATCH').at(-1)?.body.defaultAnthropicAccountId).toBe(account || null);
    await page.reload();
    await page.getByTestId(`profile-${canonicalProfile.id}`).click();
    await expect(page.getByTestId('profile-account')).toHaveValue(account);
  }
  expect(net.denied).toEqual([]);
});

test('e16-c4-unsupported: managed skills cannot claim to save; canonical auto-approve stays opt-in', async ({ page }) => {
  const net = await open(page);
  if (await page.getByTestId('rail-more').getAttribute('aria-expanded') !== 'true') await page.getByTestId('rail-more').click(); await page.getByTestId('tool-profiles').click();
  await page.getByTestId(`profile-${canonicalProfile.id}`).click();
  await openGroup(page, 'Availability & defaults');
  await expect(page.getByTestId('profile-managed-skills')).toBeDisabled();
  await expect(page.getByText('Managed skills cannot be saved by this editor.')).toBeVisible();
  await openGroup(page, 'Provider, model & account');
  await page.getByTestId('profile-account').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e16-profile-controls.png' });
  await openGroup(page, 'Permissions');
  await expect(page.getByTestId('profile-auto-approve')).not.toBeChecked();
  expect(net.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  expect(net.denied).toEqual([]);
});
