import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Node 20 (CI) cannot import .ts. Transpile the actual service and its local
// dependencies, preserving module boundaries and every behavioral assertion.
async function sourceModule(url) {
  const source = await readFile(url, 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const imports = [...output.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)];
  for (const [, , specifier] of imports) {
    const dependency = await sourceModule(new URL(specifier, url));
    output = output.replaceAll(`'${specifier}'`, `'${dependency}'`).replaceAll(`"${specifier}"`, `"${dependency}"`);
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}

const {
  canCancelResearchRun,
  canFinishResearchRun,
  canResumeResearchRun,
  ResearchContractError,
  researchReportReady,
  researchRunActive,
  ResearchWorkflowUnavailableError,
  RhythmToolsService,
  sanitizeToolCache,
  serializeProfileScope,
  TOOL_SCREEN_MANIFEST,
  validateResearchBudgetField,
} = await import(await sourceModule(new URL('../providers/services/rhythm-tools-service.ts', import.meta.url)));

function recordingTransport(origin) {
  const calls = [];
  return {
    calls,
    async request(path, init) {
      calls.push({ origin, path, init });
      return { items: [] };
    },
  };
}

test('issue-1173-c1: tool transports stay origin and credential isolated', async () => {
  const cloud = recordingTransport('cloud');
  const paired = recordingTransport('paired');
  const service = new RhythmToolsService({
    cloud,
    paired,
    projectId: 'project-test',
  });

  await service.listEmailSignals();
  await service.listGalleryDesigns();
  await service.listBrain();
  await service.listResearch();

  assert.deepEqual(cloud.calls.map((call) => call.path), [
    '/integrations/gmail-signals?limit=20',
  ]);
  // Gallery designs moved to the paired gateway; this expectation was stale before CI ran it.
  assert.deepEqual(paired.calls.map((call) => call.path), [
    '/mobile-gateway/tools/agent-designs',
    '/mobile-gateway/tools/agent-memory',
    '/mobile-gateway/tools/agent-research',
  ]);
  assert.doesNotMatch(JSON.stringify([...cloud.calls, ...paired.calls]), /authorization|deviceToken|sessionToken/i);
});

test('issue-1173-c5: webhook secrets remain one-time and uncached', () => {
  const cached = sanitizeToolCache('webhooks', [{
    id: 'webhook-1',
    name: 'Planning Center',
    url: 'https://mac.example/mobile/webhook/webhook-1',
    secret: 'show-once',
    signingSecret: 'show-once-too',
    token: 'never-cache',
  }]);
  assert.deepEqual(cached, [{
    id: 'webhook-1',
    name: 'Planning Center',
    url: 'https://mac.example/mobile/webhook/webhook-1',
  }]);
  assert.doesNotMatch(JSON.stringify(cached), /show-once|secret|token/i);
});

// ---- Research projects/runs: canonical eleven operations (real service, recording transport) ----------------------------

const project = (extra = {}) => ({
  id: 'p1', ownerUserId: 7, name: 'Name', question: 'Question?', goals: [], domain: null, profileId: 'research',
  passConfig: [], modelPolicy: {}, criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null,
  budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 }, archivedAt: null,
  createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', ...extra,
});
const run = (extra = {}) => ({
  id: 'r1', projectId: 'p1', ownerUserId: 7, triggerType: 'manual', configSnapshot: {}, status: 'done',
  progress: { stages: [] }, diagnostics: {}, startedAt: null, completedAt: null, createdAt: '2026-10-06T00:00:00.000Z',
  canonicalArtifact: null, artifacts: [], sources: [], usage: { tokens: 0, costUsd: 0 }, ...extra,
});
const stage = (role, status = 'done', extra = {}) => ({ id: `${role}-1`, role, status, ...extra });

function researchService(respond) {
  const calls = [];
  const paired = {
    async request(path, init) {
      calls.push({ path, init });
      return respond({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    },
  };
  return { calls, service: new RhythmToolsService({ cloud: paired, paired, projectId: 'mac-project' }) };
}

const BASE = '/mobile-gateway/tools/agent-research';

test('research project/run service: exactly eleven operations with exact method, path, body, project header and abort signal', async () => {
  const fixtures = {
    list: [project()], one: project(), runs: [run()], single: run(), markdown: { markdown: 'text' },
  };
  const plan = [
    ['listResearchProjects', [], 'GET', `${BASE}/projects`, undefined, fixtures.list],
    ['createResearchProject', [{ name: 'N', question: 'Q', goals: ['g'] }], 'POST', `${BASE}/projects`, { name: 'N', question: 'Q', goals: ['g'] }, fixtures.one],
    ['getResearchProject', ['p1'], 'GET', `${BASE}/projects/p1`, undefined, fixtures.one],
    ['updateResearchProject', ['p1', { budget: { maxPasses: 0 } }], 'PATCH', `${BASE}/projects/p1`, { budget: { maxPasses: 0 } }, fixtures.one],
    ['listResearchProjectRuns', ['p1'], 'GET', `${BASE}/projects/p1/runs`, undefined, fixtures.runs],
    ['startResearchProjectRun', ['p1'], 'POST', `${BASE}/projects/p1/runs`, { triggerType: 'manual' }, fixtures.single],
    ['getResearchProjectRun', ['p1', 'r1'], 'GET', `${BASE}/projects/p1/runs/r1`, undefined, fixtures.single],
    ['cancelResearchProjectRun', ['p1', 'r1'], 'POST', `${BASE}/projects/p1/runs/r1/cancel`, undefined, fixtures.single],
    ['resumeResearchProjectRun', ['p1', 'r1'], 'POST', `${BASE}/projects/p1/runs/r1/resume`, undefined, fixtures.single],
    ['finishResearchProjectRun', ['p1', 'r1'], 'POST', `${BASE}/projects/p1/runs/r1/finish`, undefined, fixtures.single],
    ['exportResearchProjectRunMarkdown', ['p1', 'r1'], 'GET', `${BASE}/projects/p1/runs/r1/export?format=markdown`, undefined, fixtures.markdown],
  ];
  assert.equal(plan.length, 11);
  for (const [method, args, httpMethod, path, requestBody, response] of plan) {
    const { calls, service } = researchService(() => response);
    await service[method](...args);
    assert.equal(calls.length, 1, `${method} makes exactly one request`);
    assert.equal(calls[0].path, path, `${method} path`);
    assert.equal(calls[0].init.method ?? 'GET', httpMethod, `${method} method`);
    assert.deepEqual(calls[0].init.body === undefined ? undefined : JSON.parse(calls[0].init.body), requestBody, `${method} body`);
    assert.equal(calls[0].init.headers['X-Rhythm-Project-ID'], 'mac-project', `${method} Mac project header`);
    assert.ok(calls[0].init.signal instanceof AbortSignal, `${method} abort signal`);
  }
});

test('research project/run service: IDs are separately encoded and empty identities never reach the transport', async () => {
  const { calls, service } = researchService(() => run({ id: 'r/1', projectId: 'a/b c' }));
  await service.getResearchProjectRun('a/b c', 'r/1');
  assert.equal(calls[0].path, `${BASE}/projects/a%2Fb%20c/runs/r%2F1`);
  for (const bad of ['', '   ', undefined, null, 5]) {
    await assert.rejects(() => service.getResearchProject(bad));
    await assert.rejects(() => service.cancelResearchProjectRun('p1', bad));
    await assert.rejects(() => service.exportResearchProjectRunMarkdown(bad, 'r1'));
  }
  assert.equal(calls.length, 1);
});

test('research project/run service: strict DTO and export-envelope validation with a safe contract error', async () => {
  const bad = [
    ['getResearchProject', ['p1'], project({ ownerUserId: undefined })],
    ['getResearchProject', ['p1'], { ...project(), budget: 'nope' }],
    ['listResearchProjects', [], { items: [] }],
    ['listResearchProjectRuns', ['p1'], [run({ usage: { tokens: 'x', costUsd: 0 } })]],
    ['getResearchProjectRun', ['p1', 'r1'], run({ triggerType: 'cron' })],
    ['getResearchProjectRun', ['p1', 'r1'], run({ progress: [] })],
    ['exportResearchProjectRunMarkdown', ['p1', 'r1'], { markdown: 1 }],
    ['exportResearchProjectRunMarkdown', ['p1', 'r1'], { markdown: 'x', extra: true }],
    ['exportResearchProjectRunMarkdown', ['p1', 'r1'], 'raw markdown text'],
  ];
  for (const [method, args, response] of bad) {
    const { service } = researchService(() => response);
    await assert.rejects(() => service[method](...args), (error) => {
      assert.ok(error instanceof ResearchContractError, `${method} rejects with the contract error`);
      assert.equal(error.message, 'The paired Mac returned an unexpected Research response.');
      return true;
    });
  }
  // Opaque canonical fields are kept intact (not run through the legacy cache projection).
  const opaque = project({ modelPolicy: { lead: { providerId: 'x', modelId: 'y' }, unknownPolicy: [1, 2] }, magazineArtifactId: 'm' });
  const { service } = researchService(() => opaque);
  assert.deepEqual(await service.getResearchProject('p1'), opaque);
  const markdown = 'Ünïcode — “quotes” \'single\'\nline two\n\n```ts\nconst a = "b";\n```\n';
  const exported = researchService(() => ({ markdown }));
  assert.equal(await exported.service.exportResearchProjectRunMarkdown('p1', 'r1'), markdown);
});

test('research project/run service: only the exact older-gateway rejections mean workflow unavailable', async () => {
  const reject = (status, code, message) => Object.assign(new Error(message), { status, code });
  const throwing = (error) => researchService(() => { throw error; }).service;
  const unavailableCases = [
    ['listResearchProjects', [], reject(404, 'NOT_FOUND', 'ResearchJob not found')],
    ['listResearchProjects', [], reject(404, 'NOT_FOUND', 'MobileToolOperation not found')],
    ['listResearchProjectRuns', ['p1'], reject(404, 'NOT_FOUND', 'MobileToolOperation not found')],
    ['createResearchProject', [{ name: 'N', question: 'Q', goals: [] }], reject(404, 'NOT_FOUND', 'MobileToolOperation not found')],
    ['cancelResearchProjectRun', ['p1', 'r1'], reject(404, 'NOT_FOUND', 'MobileToolOperation not found')],
    ['exportResearchProjectRunMarkdown', ['p1', 'r1'], reject(404, 'NOT_FOUND', 'MobileToolOperation not found')],
  ];
  for (const [method, args, error] of unavailableCases) {
    await assert.rejects(() => throwing(error)[method](...args), (reason) => reason instanceof ResearchWorkflowUnavailableError, method);
  }
  // 'ResearchJob not found' means unavailable ONLY for the project list; elsewhere and for real entities it stays a real 404.
  const keepers = [
    ['getResearchProject', ['p1'], reject(404, 'NOT_FOUND', 'ResearchJob not found')],
    ['getResearchProjectRun', ['p1', 'r1'], reject(404, 'NOT_FOUND', 'ResearchJob not found')],
    ['getResearchProject', ['p1'], reject(404, 'NOT_FOUND', 'ResearchProject not found')],
    ['getResearchProjectRun', ['p1', 'r1'], reject(404, 'NOT_FOUND', 'ResearchProjectRun not found')],
    ['listResearchProjects', [], reject(404, 'NOT_FOUND', 'Mac project not found')],
    ['listResearchProjects', [], reject(404, 'PROJECT_NOT_FOUND', 'MobileToolOperation not found')],
    ['listResearchProjects', [], reject(401, 'UNAUTHORIZED', 'ResearchJob not found')],
    ['listResearchProjects', [], reject(403, 'FORBIDDEN', 'MobileToolOperation not found')],
    ['listResearchProjects', [], Object.assign(new Error('offline'), { status: 0, retryable: true })],
  ];
  for (const [method, args, error] of keepers) {
    await assert.rejects(() => throwing(error)[method](...args), (reason) => reason === error, `${method} keeps ${error.message}`);
  }
  // A successful list never proves capability: it is just a validated list, with no probing or extra request.
  const ok = researchService(() => [project()]);
  assert.equal((await ok.service.listResearchProjects()).length, 1);
  assert.equal(ok.calls.length, 1);
});

test('research run predicates match the desktop workflow and the stricter report readiness', () => {
  for (const status of ['pending', 'running', 'resumable', 'working']) assert.equal(researchRunActive({ status }), true, status);
  for (const status of ['done', 'error', 'canceled', 'stopped']) assert.equal(researchRunActive({ status }), false, status);
  const withStages = (status, stages, diagnostics = {}) => run({ status, progress: { stages }, diagnostics });
  assert.equal(canCancelResearchRun(withStages('running', [])), true);
  assert.equal(canCancelResearchRun(withStages('error', [])), false);
  assert.equal(canResumeResearchRun(withStages('error', [])), true);
  assert.equal(canResumeResearchRun(withStages('canceled', [])), false);
  // Finish: not active, a done evidence stage, and either no done synthesis or an exhausted budget.
  assert.equal(canFinishResearchRun(withStages('error', [stage('researcher')])), true);
  assert.equal(canFinishResearchRun(withStages('running', [stage('researcher')])), false);
  assert.equal(canFinishResearchRun(withStages('error', [stage('plan'), stage('critic')])), false, 'no evidence');
  assert.equal(canFinishResearchRun(withStages('error', [stage('researcher'), stage('synthesis')])), false, 'synthesis already done');
  assert.equal(canFinishResearchRun(withStages('error', [stage('researcher'), stage('synthesis')], { budgetExhausted: true })), true);
  assert.equal(canFinishResearchRun(withStages('error', [stage('researcher')], { budgetExhausted: 'yes' })), true, 'not an exhausted-budget claim, but no synthesis yet');
  // Report readiness: the FIRST done synthesis stage must hold a nonblank string report.
  assert.equal(researchReportReady(withStages('done', [stage('synthesis', 'done', { report: '# R' })])), true);
  assert.equal(researchReportReady(withStages('done', [stage('synthesis', 'done', { report: '   ' })])), false, 'done + blank');
  assert.equal(researchReportReady(withStages('done', [stage('synthesis', 'done')])), false);
  assert.equal(researchReportReady(withStages('done', [stage('synthesis', 'done', { report: 5 })])), false);
  assert.equal(researchReportReady(withStages('running', [stage('synthesis', 'running', { report: 'partial' })])), false);
  assert.equal(
    researchReportReady(run({ status: 'done', progress: { stages: [] }, canonicalArtifact: { id: 'a' } })),
    false,
    'status done or a canonical artifact alone is insufficient',
  );
  assert.equal(
    researchReportReady(withStages('done', [stage('synthesis', 'done', { report: '' }), stage('synthesis', 'done', { report: 'later' })])),
    false,
    'the first done synthesis stage decides',
  );
});

test('research budget bounds match the server and keep zero passes valid', () => {
  assert.equal(validateResearchBudgetField('maxPasses', 0), null);
  assert.equal(validateResearchBudgetField('maxPasses', 10), null);
  assert.notEqual(validateResearchBudgetField('maxPasses', 11), null);
  assert.notEqual(validateResearchBudgetField('maxPasses', 1.5), null);
  assert.equal(validateResearchBudgetField('maxTokens', 50_000), null);
  assert.notEqual(validateResearchBudgetField('maxTokens', 49_999), null);
  assert.equal(validateResearchBudgetField('maxCostUsd', 0), null);
  assert.equal(validateResearchBudgetField('maxCostUsd', 0.25), null);
  assert.notEqual(validateResearchBudgetField('maxCostUsd', 1_000.01), null);
  assert.equal(validateResearchBudgetField('maxWallClockMs', 60_000), null);
  assert.equal(validateResearchBudgetField('maxWallClockMs', 90_000), null, 'precise non-minute time is valid');
  assert.notEqual(validateResearchBudgetField('maxWallClockMs', 59_999), null);
  assert.notEqual(validateResearchBudgetField('maxPasses', Number.NaN), null);
  assert.notEqual(validateResearchBudgetField('maxPasses', '3'), null);
});

test('research cache keeps server-owned canRetry only as a strict boolean', () => {
  const cached = sanitizeToolCache('research', [
    { id: 'r-true', query: 'a', status: 'error', canRetry: true, token: 'never-cache' },
    { id: 'r-false', query: 'b', status: 'error', canRetry: false },
    { id: 'r-missing', query: 'c', status: 'error' },
    { id: 'r-string', query: 'd', status: 'error', canRetry: 'true' },
    { id: 'r-number', query: 'e', status: 'error', canRetry: 1 },
    { id: 'r-null', query: 'f', status: 'error', canRetry: null },
  ]);
  const byId = Object.fromEntries(cached.map((record) => [record.id, record]));
  assert.equal(byId['r-true'].canRetry, true);
  assert.equal(byId['r-false'].canRetry, false);
  for (const id of ['r-missing', 'r-string', 'r-number', 'r-null']) {
    assert.equal('canRetry' in byId[id], false, `${id} drops non-strict eligibility`);
  }
  assert.equal('token' in byId['r-true'], false);
  // Other tools never gain the field.
  assert.equal('canRetry' in sanitizeToolCache('brain', [{ id: 'b', canRetry: true }])[0], false);
});

test('issue-1173-c6: Profile edits preserve scope and projection ordering', () => {
  assert.deepEqual(serializeProfileScope(undefined), { permissionScope: null });
  assert.deepEqual(serializeProfileScope([]), { permissionScope: [] });
  assert.deepEqual(serializeProfileScope(['pco', 'gmail']), {
    permissionScope: ['pco', 'gmail'],
  });
});

test('issue-1173-c9: cloud tools survive paired host outage without sensitive caching', () => {
  const cached = sanitizeToolCache('email', [{
    id: 'signal-1',
    from: 'person@example.com',
    subject: 'Volunteer reply',
    snippet: 'I can serve Sunday',
    body: 'Full private body must not be cached',
    oauthToken: 'oauth-secret',
    headers: { authorization: 'Bearer secret' },
  }]);
  assert.deepEqual(cached, [{
    id: 'signal-1',
    from: 'person@example.com',
    subject: 'Volunteer reply',
    snippet: 'I can serve Sunday',
  }]);
});

test('issue-1173-c11: every screen declares resilient accessible states', () => {
  assert.deepEqual(
    TOOL_SCREEN_MANIFEST.map((screen) => screen.id),
    [
      'brain',
      'research',
      'schedules',
      'webhooks',
      'profiles',
      'cookbook',
      'review',
      'report-card',
      'email',
      'gallery',
      'skills',
      'playbooks',
      'mcp',
      'models',
    ],
  );
  for (const screen of TOOL_SCREEN_MANIFEST) {
    assert.equal(screen.states.includes('loading'), true);
    assert.equal(screen.states.includes('empty'), true);
    assert.equal(screen.states.includes('offline-cache'), true);
    assert.equal(screen.states.includes('expired-auth'), true);
    assert.equal(screen.states.includes('forbidden'), true);
    assert.equal(screen.states.includes('error'), true);
    assert.ok(screen.accessibilityLabel.length > 0);
  }
});
