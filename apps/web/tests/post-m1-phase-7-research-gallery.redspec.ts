import { expect, test } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const project = {
  id: 'research-project-7', ownerUserId: 7, name: 'Phase 7 research', question: 'What evidence survives?',
  goals: ['Preserve evidence'], domain: 'operations', profileId: 'research',
  passConfig: [{ role: 'evidence', profileId: 'research' }], modelPolicy: {},
  criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null,
  budget: { maxPasses: 1, maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
  archivedAt: null, createdAt: '2026-08-15T10:00:00.000Z', updatedAt: '2026-08-15T10:00:00.000Z',
};

const run = {
  id: 'research-run-7', projectId: project.id, ownerUserId: 7, triggerType: 'manual',
  configSnapshot: project, status: 'complete', progress: { passes: [] }, diagnostics: {},
  startedAt: '2026-08-15T10:01:00.000Z', completedAt: '2026-08-15T10:02:00.000Z',
  createdAt: '2026-08-15T10:01:00.000Z', canonicalArtifact: { id: 'artifact-7' },
  artifacts: [{ id: 'artifact-7', artifact_role: 'canonical' }],
  sources: [{ id: 'source-7', title: 'Primary source' }], usage: { tokens: 321, costUsd: 0.12 },
};

test('post-m1-p7-c2a: live research CRUD submits and preserves every canonical project field', async ({ page }) => {
  // Regression caught: project creation mutates local state and sends no canonical API payload.
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/deep-research', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-research/projects') {
      await fulfillJson(route, request.method() === 'POST' ? 201 : 200, request.method() === 'POST' ? project : [project]);
      return true;
    }
    if (url.pathname === `/agent-research/projects/${project.id}/runs`) {
      await fulfillJson(route, 200, [run]);
      return true;
    }
    return false;
  });

  await page.getByTestId('research-new-project').click();
  await page.getByLabel('Project name').fill(project.name);
  await page.getByLabel('Research question').fill(project.question);
  await page.getByTestId('research-project-create').click();

  await expect.poll(() => matching(seen, 'POST', '/agent-research/projects')[0]?.body).toMatchObject({
    name: project.name,
    question: project.question,
    goals: project.goals,
    domain: project.domain,
    profileId: project.profileId,
    passConfig: project.passConfig,
    modelPolicy: project.modelPolicy,
    criticConfig: project.criticConfig,
    synthesisConfig: project.synthesisConfig,
    scheduleRef: project.scheduleRef,
    budget: project.budget,
  });
  await expect(page.getByTestId(`research-project-${project.id}`)).toBeVisible();
});

test('post-m1-p7-c2c: selected live research run exposes evidence recovery export and discussion contracts', async ({ page }) => {
  // Regression caught: every evidence tab and action only updates a local request-shaped trace.
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/deep-research', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-research/projects') return fulfillJson(route, 200, [project]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs`) return fulfillJson(route, 200, [run]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs/${run.id}`) return fulfillJson(route, 200, run).then(() => true);
    if (url.pathname.endsWith('/discussions')) return fulfillJson(route, 201, { sessionId: 'session-discussion-7', contextHash: 'hash-7' }).then(() => true);
    if (url.pathname.endsWith('/magazine')) return fulfillJson(route, 200, { title: 'Magazine', sections: [] }).then(() => true);
    if (url.pathname.endsWith('/export')) return fulfillJson(route, 200, '<html></html>').then(() => true);
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', `/agent-research/projects/${project.id}/runs/${run.id}`).length).toBeGreaterThan(0);
  await expect(page.getByText('Primary source')).toBeVisible();
  await expect(page.getByText('321')).toBeVisible();
  await page.getByTestId('research-discuss').click();
  await expect.poll(() => matching(seen, 'POST', `/agent-research/projects/${project.id}/runs/${run.id}/discussions`).length).toBe(1);
  await expect(page).toHaveURL(/agents/);
});

test('post-m1-p7-c2d: Gallery browses authorized rows opens the real artifact and launches from canonical context', async ({ page }) => {
  // Regression caught: the Gallery renders three constants and its open/launch buttons never cross a live boundary.
  const seen: SeenRequest[] = [];
  const design = {
    id: 'design-7', title: 'Phase 7 deliverable', artifactUrl: '/agent-designs/design-7/artifact',
    projectUrl: '#/projects/project-7', canvaUrl: null, artifactType: 'html', thumbnailUrl: '/agent-designs/design-7/thumbnail',
    sessionId: 'session-source-7', createdAt: '2026-08-15T09:00:00.000Z',
  };
  await openPhase7Live(page, '/tools/gallery', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-designs') return fulfillJson(route, 200, [design]).then(() => true);
    if (url.pathname === design.artifactUrl) return route.fulfill({ status: 200, body: '<html>deliverable</html>' }).then(() => true);
    if (url.pathname === '/agent-sessions' && request.method() === 'POST') return fulfillJson(route, 201, { id: 'session-creative-7', sdkSessionId: 'sdk-creative-7', status: 'idle' }).then(() => true);
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', '/agent-designs').length).toBeGreaterThan(0);
  await expect(page.getByTestId(`design-${design.id}`)).toBeVisible();
  await page.getByTestId(`gallery-open-${design.id}`).click();
  await expect.poll(() => matching(seen, 'GET', design.artifactUrl).length).toBe(1);
  await page.getByTestId('gallery-launch').click();
  await expect.poll(() => matching(seen, 'POST', '/agent-sessions')[0]?.body).toMatchObject({ designId: design.id });
});
