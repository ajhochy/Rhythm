import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import path from 'node:path';

const apiBase = 'http://127.0.0.1:4098';
const screenshotPath = (testInfo: TestInfo, name: string) => (
  process.env.RHYTHM_CAPTURE_EVIDENCE === '1'
    ? path.resolve(import.meta.dirname, `../../../docs/ai/runs/evidence/${name}`)
    : testInfo.outputPath(name)
);
const assetIcon = 'assets/agents/release-steward/avatar.png';
const profile = {
  id: 'asset-profile', label: 'Asset Path', icon: assetIcon, enabled: true, isAgent: true,
  isManager: false, sessionSelectable: true, isDefault: true, modelProvider: 'openai', modelId: 'gpt-5.6',
  systemPrompt: 'Original prompt', allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{}',
  allowedDelegatesJson: '[]', updatedAt: '2026-08-20T00:00:00.000Z',
};
const session = {
  id: 'rendered-session', name: 'Rendered session', status: 'idle', scope: 'chats', profileId: profile.id,
  projectId: 'rhythm-project', projectName: 'Rhythm', cwd: '/workspace/rhythm', branch: 'main',
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installLiveRoutes(page: Page, override?: (route: Route, url: URL) => Promise<boolean>) {
  await page.route('http://127.0.0.1:4097/**', (route) => fulfillJson(route, { healthy: true }));
  await page.route(`${apiBase}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (override && await override(route, url)) return;
    if (url.pathname === '/health') return fulfillJson(route, { healthy: true });
    if (url.pathname === '/global/health') return fulfillJson(route, { healthy: true });
    if (url.pathname === '/agent-configs') return fulfillJson(route, [profile]);
    if (url.pathname === '/agent-sessions') return fulfillJson(route, route.request().method() === 'POST' ? session : { sessions: [session] }, route.request().method() === 'POST' ? 201 : 200);
    if (url.pathname === `/agent-sessions/${session.id}`) return fulfillJson(route, { session, messages: [], transcriptPage: { hasMore: false, nextCursor: null } });
    if (url.pathname === '/notifications') return fulfillJson(route, []);
    if (url.pathname === '/agent-approvals') return fulfillJson(route, []);
    if (url.pathname.includes('/permissions/pending')) return fulfillJson(route, []);
    return fulfillJson(route, []);
  });
}

test('bucket-a-rendered-profile: asset icon renders initials and unrelated PATCH preserves the full path', async ({ page }, testInfo) => {
  // Regression caught: a Flutter asset path appears as text/broken media or is truncated to three characters on save.
  let patch: Record<string, unknown> | undefined;
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === `/agent-configs/${profile.id}` && route.request().method() === 'PATCH') {
      patch = route.request().postDataJSON();
      await fulfillJson(route, { ...profile, ...patch });
      return true;
    }
    if (url.pathname === '/opencode/mcp' || url.pathname.startsWith('/opencode/skills')) { await fulfillJson(route, []); return true; }
    return false;
  });
  await page.goto('/#/profiles');
  const row = page.getByTestId(`profile-${profile.id}`);
  await expect(row.locator('.profile-avatar')).toHaveText('AP');
  await expect(row.locator('img')).toHaveCount(0);
  await expect(row).not.toContainText(assetIcon);
  await page.getByTestId('profile-system-prompt').fill('Unrelated prompt edit');
  await page.getByTestId('profile-save').click();
  await expect.poll(() => patch?.icon).toBe(assetIcon);
  await page.screenshot({ path: screenshotPath(testInfo, 'bucket-a-profile-asset-fallback.png') });
});

test('bucket-a-rendered-session: cwd edit resets branch and omits it from POST', async ({ page }, testInfo) => {
  // Regression caught: a non-current branch selected for one cwd leaks into a session created in another cwd.
  let createBody: Record<string, unknown> | undefined;
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/projects/rhythm-project/branches') {
      await fulfillJson(route, { current: 'main', recent: ['feature/rendered'], local: ['main', 'feature/rendered'] });
      return true;
    }
    if (url.pathname === '/agent-sessions' && route.request().method() === 'POST') {
      createBody = route.request().postDataJSON();
      await fulfillJson(route, { ...session, id: 'created-rendered', name: createBody?.name, cwd: createBody?.cwd }, 201);
      return true;
    }
    return false;
  });
  await page.goto('/#/agents');
  await page.getByTestId('new-session-advanced').click();
  await page.getByTestId('advanced-name').fill('Cwd branch reset');
  await page.getByTestId('advanced-branch').selectOption('feature/rendered');
  await page.getByTestId('advanced-cwd').fill('/workspace/other');
  await expect(page.getByTestId('advanced-branch')).toHaveValue('');
  await expect(page.getByTestId('advanced-branch').locator('option:checked')).toHaveText("Use cwd's current branch");
  await page.screenshot({ path: screenshotPath(testInfo, 'bucket-a-session-cwd-branch-reset.png') });
  await page.getByTestId('advanced-create').click();
  await expect.poll(() => createBody).toBeTruthy();
  expect(createBody).not.toHaveProperty('branch');
});

test('bucket-a-rendered-gallery: broken image and video replace media with type fallbacks', async ({ page }, testInfo) => {
  // Regression caught: failed preview requests leave broken image/video elements instead of the generic artifact icon.
  const designs = [
    { id: 'broken-image', title: 'Broken image', provider: 'test', artifactType: 'png', artifactUrl: 'http://127.0.0.1:4181/broken.png', thumbnailUrl: null, projectUrl: null, canvaUrl: null, sessionId: null, createdAt: '2026-08-20T00:00:00.000Z' },
    { id: 'broken-video', title: 'Broken video', provider: 'test', artifactType: 'mp4', artifactUrl: 'http://127.0.0.1:4181/broken.mp4', thumbnailUrl: null, projectUrl: null, canvaUrl: null, sessionId: null, createdAt: '2026-08-20T00:00:00.000Z' },
  ];
  await page.route('**/broken.*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 404, body: '' });
  });
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/agent-designs') { await fulfillJson(route, designs); return true; }
    return false;
  });
  await page.goto('/#/tools/gallery', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('design-broken-image').locator('img')).toBeAttached();
  await expect(page.getByTestId('design-broken-video').locator('video')).toBeAttached();
  await expect(page.getByTestId('design-broken-image').locator('img')).toHaveCount(0);
  await expect(page.getByTestId('design-broken-video').locator('video')).toHaveCount(0);
  await expect(page.getByTestId('design-broken-image').locator('svg')).toBeVisible();
  await expect(page.getByTestId('design-broken-video').locator('svg')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'bucket-a-gallery-media-fallback.png') });
});

test('bucket-a-rendered-skills: delayed, rejected list, and rejected content remain distinct and honest', async ({ page }, testInfo) => {
  // Regression caught: pending/rejected live requests render the empty fixture or leave content saying Loading forever.
  let listMode: 'delayed' | 'rejected' = 'delayed';
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/opencode/skills' && url.searchParams.get('withMetadata') === 'true') {
      if (listMode === 'rejected') { await fulfillJson(route, { error: 'catalog denied' }, 503); return true; }
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fulfillJson(route, [{ name: 'honest-skill', description: 'Live metadata', source: 'managed', managed: true, metadata: {} }]);
      return true;
    }
    if (url.pathname === '/opencode/skills/honest-skill/content') { await fulfillJson(route, { error: 'content denied' }, 503); return true; }
    return false;
  });
  await page.goto('/#/tools/skills');
  await expect(page.getByText('Loading skills…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No managed skills found' })).toHaveCount(0);
  const content = page.locator('pre.managed-body');
  await expect(content).toHaveAttribute('role', 'alert');
  await expect(content).not.toHaveText('Loading…');
  await expect(page.getByTestId('tool-page-skills')).not.toContainText('fixture://skills');
  await expect(page.getByTestId('tool-page-skills')).not.toContainText(/Post score\s+\d|Uses\s+\d/);
  listMode = 'rejected';
  await page.reload();
  await expect(page.getByTestId('skills-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No managed skills found' })).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'bucket-a-skills-loading-error.png') });
});

test('bucket-a-rendered-settings: fixture honesty and live loading/error/empty states never expose asset paths', async ({ page }, testInfo) => {
  // Regression caught: fixture Settings claims connectivity or live loading/rejection collapses into empty/raw asset text.
  await page.goto('http://127.0.0.1:4180/#/tools/agent-settings');
  await expect(page.getByTestId('tool-page-agent-settings')).toContainText('Fixture preview · not connected');

  let mode: 'delayed' | 'rejected' | 'empty' = 'delayed';
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname !== '/agent-configs') return false;
    if (mode === 'rejected') { await fulfillJson(route, { error: 'settings denied' }, 503); return true; }
    if (mode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 500));
    await fulfillJson(route, mode === 'empty' ? [] : [profile]);
    return true;
  });
  await page.goto('http://127.0.0.1:4181/#/tools/agent-settings');
  await expect(page.getByText('Loading agent settings…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No agent profiles configured' })).toHaveCount(0);
  const setting = page.getByTestId(`agent-setting-${profile.id}`);
  await expect(setting.locator('.profile-avatar')).toHaveText('AP');
  await expect(setting).not.toContainText(assetIcon);
  await page.screenshot({ path: screenshotPath(testInfo, 'bucket-a-settings-honesty.png') });

  mode = 'rejected';
  await page.reload();
  await expect(page.getByTestId('agent-settings-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No agent profiles configured' })).toHaveCount(0);
  mode = 'empty';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No agent profiles configured' })).toBeVisible();
  await expect(page.getByTestId('agent-settings-error')).toHaveCount(0);
});

test('self-improvement-review-live: closed tool safety, conditional confirmation, history, and server failures stay truthful', async ({ page }) => {
  const calls: string[] = [];
  const tool = { id: 'tool-1', title: 'Install verified tool', kind: 'tool-install', risk: 'high', status: 'sandbox-vetted', outcomeStatus: 'unproven', rationale: 'Required for service planning.', createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T11:00:00.000Z', changeJson: '{"secret":"never-render"}', experimentSummary: { collectingProgress: 'collecting', eligibleCount: 3, missingCount: 1, treatmentIntegrity: 'ok', guardrailStatus: 'ok', terminalReason: null, testedBaselineHash: 'abc', testedCandidateHash: 'def', staleBeforeApplyConflict: false, calibrationStatus: 'calibrated', calibratedConfidence: 0.8 }, toolSafety: { state: 'ready', verdict: 'conditional', tool: { name: 'planner-tool', packageSource: 'local-tarball:sha256:abc' }, forbiddenPathViolations: [], networkCalls: [], workspaceWriteCount: 0, credentialAccessAttemptsCount: 0, scenarioAttemptsCount: 3, sandboxDurationMs: 150, reason: 'sandbox_candidate_failed' } };
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/agent-org-proposals') { const requested = url.searchParams.get('status'); calls.push(`GET ${url.pathname}?${url.searchParams}`); await fulfillJson(route, requested === 'sandbox-vetted' ? [tool] : requested === 'pending' ? [{ ...tool, status: 'pending', toolSafety: { state: 'missing', verdict: 'unknown' } }] : requested === 'active' ? [{ ...tool, status: 'active', outcomeStatus: 'verified' }] : []); return true; }
    if (url.pathname === '/agent-org-proposals/tool-1/approve') { calls.push(`POST approve ${route.request().postData()}`); await fulfillJson(route, { ...tool, status: 'approved' }); return true; }
    if (url.pathname === '/agent-org-proposals/tool-1/revert') { calls.push('POST revert'); await fulfillJson(route, { ...tool, status: 'reverted' }); return true; }
    return false;
  });
  await page.goto('http://127.0.0.1:4181/#/tools/review');
  await page.getByTestId('review-filter').selectOption('sandbox-vetted');
  const card = page.getByTestId('proposal-tool-1');
  await expect(page.getByText('1 proposal', { exact: true })).toBeVisible();
  await expect(card).toContainText('Deployment: sandbox-vetted');
  await expect(card).toContainText('Outcome: unproven');
  await expect(card).toContainText('planner-tool');
  await expect(card).toContainText('Collecting · 3 eligible · 1 missing');
  await expect(card).toContainText('Integrity: ok · Guardrails: ok');
  await expect(card).not.toContainText('never-render');
  await expect(page.getByTestId('proposal-reject-tool-1')).toBeVisible();
  await page.getByTestId('proposal-approve-tool-1').click();
  await expect(page.getByTestId('proposal-conditional-dialog')).toBeVisible();
  await page.getByTestId('proposal-conditional-confirm').click();
  await expect.poll(() => calls).toContain('POST approve {"toolSafetyConfirmation":"approve-conditional-tool-install"}');
  await page.getByTestId('review-filter').selectOption('pending');
  await expect(page.getByTestId('proposal-reject-tool-1')).toBeVisible();
  await expect(page.getByTestId('proposal-approve-tool-1')).toHaveCount(0);
  await page.getByTestId('review-filter').selectOption('active');
  await expect(page.getByText('Applied Changes')).toBeVisible();
  await expect(card).toContainText('Deployment: active');
  await expect(card).toContainText('Outcome: verified');
  await page.getByTestId('proposal-revert-tool-1').click();
  await expect(page.getByTestId('proposal-revert-dialog')).toBeVisible();
  await page.getByTestId('proposal-revert-confirm').click();
  await expect.poll(() => calls).toContain('POST revert');
});

test('self-improvement-review-mutation-error: failed decisions stay visible after authoritative refresh', async ({ page }) => {
  const proposal = { id: 'proposal-1', title: 'Refine skill', kind: 'refine-skill', risk: 'low', status: 'proposed', outcomeStatus: 'unproven', rationale: null, createdAt: null, updatedAt: null, changeJson: null };
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/agent-org-proposals') { await fulfillJson(route, [proposal]); return true; }
    if (url.pathname === '/agent-org-proposals/proposal-1/approve') { await fulfillJson(route, { error: 'conflict' }, 409); return true; }
    return false;
  });
  await page.goto('http://127.0.0.1:4181/#/tools/review');
  await page.getByTestId('proposal-approve-proposal-1').click();
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByTestId('review-error')).toContainText('current state');
});

test('self-improvement-run-feedback-live: outcome loads, posts an explicit verdict, refreshes, and disappears for 404', async ({ page }) => {
  const calls: string[] = []; let present = true; let latest = 'partial';
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/agent-run-outcomes/rendered-session' || url.pathname === '/agent-run-outcomes/rendered-session/feedback') {
      calls.push(`${route.request().method()} ${url.pathname}`);
      if (!present) { await fulfillJson(route, { error: 'not found' }, 404); return true; }
      if (route.request().method() === 'POST') latest = 'success';
      await fulfillJson(route, { explicitUserVerdict: latest }); return true;
    }
    return false;
  });
  await page.goto('http://127.0.0.1:4181/#/agents');
  await expect(page.getByTestId('run-feedback')).toBeVisible();
  await expect(page.getByTestId('run-feedback-partial')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('run-feedback-success').click();
  await expect.poll(() => calls).toContain('POST /agent-run-outcomes/rendered-session/feedback');
  await expect(page.getByTestId('run-feedback-success')).toHaveAttribute('aria-pressed', 'true');
  present = false;
  await page.getByTestId('run-feedback-refresh').click();
  await expect(page.getByTestId('run-feedback')).toHaveCount(0);
});

test('self-improvement-run-feedback-race-and-error: old sessions cannot overwrite selection and failed feedback remains visible', async ({ page }) => {
  const other = { ...session, id: 'other-session', name: 'Other session', updatedAt: '2026-08-21T00:00:00.000Z' };
  let oldStarted = false;
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/agent-sessions' && route.request().method() === 'GET') { await fulfillJson(route, { sessions: [session, other] }); return true; }
    if (url.pathname === `/agent-sessions/${other.id}`) { await fulfillJson(route, { session: other, messages: [], transcriptPage: { hasMore: false, nextCursor: null } }); return true; }
    if (url.pathname === '/agent-run-outcomes/rendered-session') { oldStarted = true; await new Promise((resolve) => setTimeout(resolve, 400)); await fulfillJson(route, { explicitUserVerdict: 'partial' }); return true; }
    if (url.pathname === '/agent-run-outcomes/other-session') { await fulfillJson(route, { explicitUserVerdict: 'success' }); return true; }
    if (url.pathname === '/agent-run-outcomes/other-session/feedback') { await fulfillJson(route, { error: 'conflict' }, 409); return true; }
    return false;
  });
  await page.goto('http://127.0.0.1:4181/#/agents');
  await expect.poll(() => oldStarted).toBe(true);
  await page.getByTestId('session-other-session').click();
  await expect(page.getByTestId('run-feedback-success')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('run-feedback-success')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('run-feedback-failure').click();
  await expect(page.getByTestId('run-feedback')).toContainText('request failed (409)');
});

test('self-improvement-run-feedback-load-error: switching to a failed outcome never shows the prior verdict controls', async ({ page }) => {
  const other = { ...session, id: 'failed-session', name: 'Failed outcome session', updatedAt: '2026-08-21T00:00:00.000Z' };
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/agent-sessions' && route.request().method() === 'GET') { await fulfillJson(route, { sessions: [session, other] }); return true; }
    if (url.pathname === `/agent-sessions/${other.id}`) { await fulfillJson(route, { session: other, messages: [], transcriptPage: { hasMore: false, nextCursor: null } }); return true; }
    if (url.pathname === '/agent-run-outcomes/rendered-session') { await fulfillJson(route, { explicitUserVerdict: 'success' }); return true; }
    if (url.pathname === '/agent-run-outcomes/failed-session') { await fulfillJson(route, { error: 'unavailable' }, 500); return true; }
    return false;
  });
  await page.goto('http://127.0.0.1:4181/#/agents');
  await expect(page.getByTestId('run-feedback-success')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('session-failed-session').click();
  await expect(page.getByTestId('run-feedback')).toContainText('request failed (500)');
  await expect(page.getByRole('group', { name: 'How did this run go?' })).toHaveCount(0);
});

test('self-improvement-auto-promotion-live: default-off gating and explicit cloud-confirmed enable are authoritative', async ({ page }) => {
  const calls: Array<{ method: string; authorization: string | null; confirmation: string | null; body: unknown }> = []; let enabled = false;
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname === '/optimizer/auto-promotion') {
      const headers = route.request().headers();
      calls.push({ method: route.request().method(), authorization: headers.authorization ?? null, confirmation: headers['x-rhythm-auto-promotion-confirmation'] ?? null, body: route.request().postDataJSON() });
      if (route.request().method() === 'POST') enabled = Boolean((route.request().postDataJSON() as { enabled: boolean }).enabled);
      await fulfillJson(route, { availability: true, state: { autoPromotionEnabled: enabled, enabledAt: enabled ? '2026-08-22T00:00:00.000Z' : null, autoPromotionEligible: true, totalVerified: 5, totalRegressions: 0, trustThreshold: 5 } }); return true;
    }
    return false;
  });
  await page.goto('http://127.0.0.1:4181/#/tools/agent-settings');
  await expect(page.getByTestId('auto-promotion')).toContainText('Disabled');
  expect(calls[0].confirmation).toBeNull();
  await page.getByTestId('auto-promotion-toggle').click();
  await expect(page.getByTestId('auto-promotion-dialog')).toBeVisible();
  await page.getByTestId('auto-promotion-cancel').click();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  await page.getByTestId('auto-promotion-toggle').click();
  await page.getByTestId('auto-promotion-confirm').click();
  await expect.poll(() => calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(calls.at(-1)).toMatchObject({ authorization: 'Bearer bucket-a-rendered-disposable', confirmation: 'enable-auto-promotion', body: { enabled: true } });
  await expect(page.getByTestId('auto-promotion')).toContainText('Enabled');
  await page.getByTestId('auto-promotion-toggle').click();
  await page.getByTestId('auto-promotion-confirm').click();
  await expect.poll(() => calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  expect(calls.at(-1)).toMatchObject({ body: { enabled: false } });
  await expect(page.getByTestId('auto-promotion')).toContainText('Disabled');
});

test('self-improvement-auto-promotion-errors: admin denial and stale eligibility remain explicit', async ({ page }) => {
  let mode: 'denied' | 'ready' | 'conflict' = 'denied';
  await installLiveRoutes(page, async (route, url) => {
    if (url.pathname !== '/optimizer/auto-promotion') return false;
    if (mode === 'denied') { await fulfillJson(route, { error: 'forbidden' }, 403); return true; }
    if (route.request().method() === 'POST' && mode === 'conflict') { await fulfillJson(route, { error: 'stale' }, 409); return true; }
    await fulfillJson(route, { availability: true, state: { autoPromotionEnabled: false, enabledAt: null, autoPromotionEligible: true, totalVerified: 5, totalRegressions: 0, trustThreshold: 5 } }); return true;
  });
  await page.goto('http://127.0.0.1:4181/#/tools/agent-settings');
  await expect(page.getByTestId('auto-promotion')).toContainText('Admin/system access required');
  mode = 'ready';
  await page.getByTestId('auto-promotion').getByRole('button', { name: 'Retry' }).click();
  await page.getByTestId('auto-promotion-toggle').click();
  mode = 'conflict';
  await page.getByTestId('auto-promotion-confirm').click();
  await expect(page.getByTestId('auto-promotion')).toContainText('eligibility changed');
});
