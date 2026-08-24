import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const testsDir = dirname(fileURLToPath(import.meta.url));
const axePath = resolve(testsDir, '../node_modules/axe-core/axe.min.js');
const evidenceRoot = process.env.RHYTHM_VISUAL_EVIDENCE_DIR ?? '/private/tmp';
await mkdir(evidenceRoot, { recursive: true });

const profile = { id: 'visual-profile', label: 'Visual Profile', icon: null, enabled: true, isAgent: true, isManager: false, sessionSelectable: true, isDefault: true, modelProvider: 'openai', modelId: 'gpt-5.6', systemPrompt: '', allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{}', allowedDelegatesJson: '[]', updatedAt: '2026-08-22T00:00:00.000Z' };
const session = { id: 'visual-session', name: 'Visual session', status: 'idle', scope: 'chats', profileId: profile.id, projectId: 'rhythm', projectName: 'Rhythm', cwd: '/workspace/rhythm', branch: 'main', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z' };
const proposal = { id: 'visual-tool', title: 'Install verified planning tool', kind: 'tool-install', risk: 'high', status: 'sandbox-vetted', outcomeStatus: 'unproven', rationale: 'Adds a vetted planning capability.', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:05:00.000Z', changeJson: '{"secret":"must-not-render"}', experimentSummary: { collectingProgress: 'collecting', eligibleCount: 3, missingCount: 1, treatmentIntegrity: 'ok', guardrailStatus: 'ok', terminalReason: null, testedBaselineHash: 'abc', testedCandidateHash: 'def', staleBeforeApplyConflict: false, calibrationStatus: 'calibrated', calibratedConfidence: 0.8 }, toolSafety: { state: 'ready', verdict: 'conditional', tool: { name: 'planner-tool', packageSource: 'local-tarball:sha256:abc' }, forbiddenPathViolations: [], networkCalls: [{ host: 'registry.npmjs.org', count: 1 }], workspaceWriteCount: 0, credentialAccessAttemptsCount: 0, scenarioAttemptsCount: 3, sandboxDurationMs: 150, reason: 'network allowlist review' } };

async function fulfill(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const browser = await chromium.launch({ headless: true });
const evidence = [];
for (const scale of [100, 200]) {
  const context = await browser.newContext({ viewport: scale === 100 ? { width: 1440, height: 900 } : { width: 720, height: 450 }, colorScheme: 'light' });
  await context.addInitScript({ path: axePath });
  const page = await context.newPage();
  await page.route('http://127.0.0.1:4097/**', (route) => fulfill(route, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/health' || url.pathname === '/global/health') return fulfill(route, { healthy: true });
    if (url.pathname === '/agent-configs') return fulfill(route, [profile]);
    if (url.pathname === '/agent-sessions') return fulfill(route, { sessions: [session] });
    if (url.pathname === `/agent-sessions/${session.id}`) return fulfill(route, { session, messages: [], transcriptPage: { hasMore: false, nextCursor: null } });
    if (url.pathname === '/notifications' || url.pathname === '/agent-approvals' || url.pathname.includes('/permissions/pending')) return fulfill(route, []);
    if (url.pathname === '/agent-org-proposals') return fulfill(route, url.searchParams.get('status') === 'sandbox-vetted' ? [proposal] : []);
    if (url.pathname === '/optimizer/auto-promotion') return fulfill(route, { availability: true, state: { autoPromotionEnabled: false, enabledAt: null, autoPromotionEligible: true, totalVerified: 5, totalRegressions: 0, trustThreshold: 5 } });
    return fulfill(route, []);
  });

  for (const surface of ['review', 'settings']) {
    const url = surface === 'review' ? 'http://127.0.0.1:4181/#/tools/review' : 'http://127.0.0.1:4181/#/tools/agent-settings';
    const selector = surface === 'review' ? '[data-testid="tool-page-review"]' : '[data-testid="auto-promotion"]';
    await page.goto(url);
    if (surface === 'review') await page.getByTestId('review-filter').selectOption('sandbox-vetted');
    await page.locator(selector).waitFor({ state: 'visible' });
    const violations = await page.locator(selector).evaluate(async (root) => {
      const results = await globalThis.axe.run(root);
      return results.violations.filter((entry) => entry.impact === 'serious' || entry.impact === 'critical').map((entry) => entry.id);
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const content = await page.locator(selector).innerText();
    if (violations.length) throw new Error(`${surface} ${scale}% accessibility violations: ${violations.join(', ')}`);
    if (overflow > 1) throw new Error(`${surface} ${scale}% horizontal overflow: ${overflow}px`);
    if (content.includes('must-not-render')) throw new Error(`${surface} leaked raw tool payload`);
    const screenshotPath = join(evidenceRoot, `rhythm-electron-${surface}-${scale}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.push({ surface, scale, violations: violations.length, overflow, path: screenshotPath });
    if (scale === 200) {
      const action = page.getByTestId(surface === 'review' ? 'proposal-approve-visual-tool' : 'auto-promotion-toggle');
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox();
      if (!box || box.y < 0 || box.y + box.height > 450) throw new Error(`${surface} ${scale}% primary action is not reachable in the viewport`);
      const actionPath = join(evidenceRoot, `rhythm-electron-${surface}-${scale}-action.png`);
      await page.screenshot({ path: actionPath });
      evidence.push({ surface, scale, actionReachable: true, path: actionPath });
    }
  }
  await context.close();
}
await browser.close();
console.log(JSON.stringify(evidence, null, 2));
