import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadSubject() {
  try {
    const source = await readFile(
      new URL('../../providers/open-project-session.ts', import.meta.url),
      'utf8',
    );
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    return await import(`data:text/javascript,${encodeURIComponent(output)}`);
  } catch {
    return null;
  }
}

const subject = await loadSubject();

function requireSubject() {
  assert.ok(
    subject,
    'open-project-session.ts must provide the atomic opening state machine',
  );
  return subject;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function fakeClock() {
  let nextId = 0;
  let now = 0;
  const tasks = new Map();
  return {
    clearTimeout(id) {
      tasks.delete(id);
    },
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      tasks.set(id, { at: now + delayMs, callback });
      return id;
    },
    advance(delayMs) {
      now += delayMs;
      const ready = [...tasks.entries()]
        .filter(([, task]) => task.at <= now)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, task] of ready) {
        tasks.delete(id);
        task.callback();
      }
    },
  };
}

function session(projectId, id) {
  return {
    id,
    projectId,
    rhythm: {
      profileId: 'coding',
      opencodeAgentId: 'build',
      profileAvailability: 'available',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      thinkingBudget: 8192,
      permissionMode: 'plan',
    },
  };
}

function createHarness(overrides = {}) {
  const api = requireSubject();
  const commits = [];
  const states = [];
  let subscriptions = 0;
  let creates = 0;
  const projects = new Set(['project-a', 'project-b']);
  const sessionsByProject = new Map([
    ['project-a', [session('project-a', 'session-a')]],
    ['project-b', [session('project-b', 'session-b')]],
  ]);
  const transport = {
    async confirmProject(projectId) {
      return projects.has(projectId);
    },
    async listSessions(projectId) {
      return sessionsByProject.get(projectId) ?? [];
    },
    async loadSessionState(projectId, sessionId, targetSession) {
      return {
        messages: [{ id: `message-${sessionId}` }],
        session: targetSession,
        projectId,
        sessionId,
      };
    },
    ...overrides.transport,
  };
  const controller = api.createOpenProjectSessionController({
    clock: overrides.clock,
    timeoutMs: overrides.timeoutMs,
    transport,
    commit(payload) {
      commits.push(payload);
      subscriptions += 1;
      overrides.commit?.(payload);
    },
    onStateChange(state) {
      states.push(state);
    },
  });
  return {
    api,
    commits,
    controller,
    get creates() {
      return creates;
    },
    get subscriptions() {
      return subscriptions;
    },
    projects,
    sessionsByProject,
    states,
    transport,
    createSession() {
      creates += 1;
    },
  };
}

test('issue-4-c1: cross-project deep link commits one complete snapshot', async () => {
  // Regression caught: selectProject clears the current selection before the
  // target project sessions/transcript are loaded.
  let selectedProject = 'project-a';
  const harness = createHarness({
    commit(payload) {
      selectedProject = payload.projectId;
    },
  });

  const opening = harness.controller.openProjectSession(
    'project-b',
    'session-b',
  );
  assert.equal(selectedProject, 'project-a');
  const result = await opening;

  assert.equal(result.kind, 'ready');
  assert.equal(selectedProject, 'project-b');
  assert.equal(harness.commits.length, 1);
  assert.deepEqual(harness.commits[0], {
    messages: [{ id: 'message-session-b' }],
    projectId: 'project-b',
    session: session('project-b', 'session-b'),
    sessionId: 'session-b',
  });
});

test('issue-4-c2: rapid navigation cannot commit the stale first target', async () => {
  // Regression caught: a slower first route finishes after a newer route and
  // overwrites the newer project/session selection.
  const first = deferred();
  const harness = createHarness({
    transport: {
      async loadSessionState(projectId, sessionId, targetSession) {
        if (sessionId === 'session-a') return first.promise;
        return { projectId, sessionId, session: targetSession, messages: [] };
      },
    },
  });

  const staleOpen = harness.controller.openProjectSession(
    'project-a',
    'session-a',
  );
  const latestOpen = harness.controller.openProjectSession(
    'project-b',
    'session-b',
  );
  assert.equal((await latestOpen).kind, 'ready');
  first.resolve({
    projectId: 'project-a',
    sessionId: 'session-a',
    session: session('project-a', 'session-a'),
    messages: [],
  });
  await staleOpen;

  assert.deepEqual(
    harness.commits.map(({ projectId, sessionId }) => ({
      projectId,
      sessionId,
    })),
    [{ projectId: 'project-b', sessionId: 'session-b' }],
  );
});

test('issue-4-c3: the documented loading deadline terminates in timeout', async () => {
  // Regression caught: an unresolved gateway request leaves "Opening chat"
  // visible forever.
  const clock = fakeClock();
  const pending = deferred();
  const harness = createHarness({
    clock,
    transport: {
      async loadSessionState() {
        return pending.promise;
      },
    },
  });

  const opening = harness.controller.openProjectSession(
    'project-a',
    'session-a',
  );
  await Promise.resolve();
  await Promise.resolve();
  clock.advance(harness.api.OPEN_PROJECT_SESSION_TIMEOUT_MS);
  const result = await opening;

  assert.equal(harness.api.OPEN_PROJECT_SESSION_TIMEOUT_MS, 15_000);
  assert.equal(result.kind, 'timeout');
  assert.equal(harness.commits.length, 0);
  pending.resolve({});
});

test('issue-4-c4: every terminal state has distinct copy plus Retry and Back', async () => {
  // Regression caught: failures collapse into a spinner or a generic one-
  // action screen, so the user cannot leave without quitting the app.
  const api = requireSubject();
  const terminalKinds = [
    'missing-session',
    'unauthorized-project',
    'offline',
    'timeout',
    'transient-error',
  ];
  const presentations = terminalKinds.map((kind) =>
    api.getOpenProjectSessionPresentation(kind));

  assert.equal(new Set(presentations.map(({ title }) => title)).size, 5);
  for (const presentation of presentations) {
    assert.equal(presentation.retryLabel, 'Retry');
    assert.equal(presentation.backLabel, 'Back to chats');
    assert.ok(presentation.message.length > 0);
  }

  const routeSource = await readFile(
    new URL('../../app/agents/chats/[sessionId].tsx', import.meta.url),
    'utf8',
  );
  assert.match(routeSource, /cancelOpenProjectSession/);
  assert.match(routeSource, /router\.replace\(['"]\/\(tabs\)\/agents['"]\)/);
  assert.match(routeSource, /retryLabel/);
  assert.match(routeSource, /backLabel/);
});

test('issue-4-c5: retry is idempotent and never creates a session or duplicates a subscription', async () => {
  // Regression caught: retry falls through ensureActiveSession, creates a new
  // chat, and mounts a second project subscription.
  let attempts = 0;
  const harness = createHarness({
    transport: {
      async loadSessionState(projectId, sessionId, targetSession) {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary gateway failure');
        return { projectId, sessionId, session: targetSession, messages: [] };
      },
    },
  });

  assert.equal(
    (await harness.controller.openProjectSession('project-a', 'session-a')).kind,
    'transient-error',
  );
  assert.equal(
    (await harness.controller.openProjectSession('project-a', 'session-a')).kind,
    'ready',
  );
  assert.equal(harness.creates, 0);
  assert.equal(harness.subscriptions, 1);
  assert.equal(harness.commits.length, 1);
});

test('issue-4-c6: Back cancels pending work before returning to the chat list', async () => {
  // Regression caught: Back navigates away, but the pending open later commits
  // and changes provider state behind the session list.
  const pending = deferred();
  const harness = createHarness({
    transport: {
      async loadSessionState() {
        return pending.promise;
      },
    },
  });
  const opening = harness.controller.openProjectSession(
    'project-b',
    'session-b',
  );

  harness.controller.cancelOpenProjectSession();
  pending.resolve({
    projectId: 'project-b',
    sessionId: 'session-b',
    session: session('project-b', 'session-b'),
    messages: [],
  });
  const result = await opening;

  assert.equal(result.kind, 'cancelled');
  assert.equal(harness.controller.getState().kind, 'idle');
  assert.equal(harness.commits.length, 0);
});

test('issue-4-c7: cold start commits only the requested existing session', async () => {
  // Regression caught: the provider bootstrap chooses the first session or
  // creates one before a cold-start deep link can load its requested target.
  const harness = createHarness();
  const result = await harness.controller.openProjectSession(
    'project-b',
    'session-b',
  );

  assert.equal(result.kind, 'ready');
  assert.equal(harness.creates, 0);
  assert.deepEqual(
    harness.commits.map(({ sessionId }) => sessionId),
    ['session-b'],
  );
  assert.equal(
    harness.states.some(
      (state) =>
        state.kind === 'ready' && state.sessionId !== 'session-b',
    ),
    false,
  );
});

test('issue-4-c8: background resume is idempotent for the committed target', async () => {
  // Regression caught: a route effect reruns on resume and reopens the same
  // session, duplicating the active project subscription.
  const harness = createHarness();
  assert.equal(
    (await harness.controller.openProjectSession('project-a', 'session-a')).kind,
    'ready',
  );
  assert.equal(
    (await harness.controller.openProjectSession('project-a', 'session-a')).kind,
    'ready',
  );

  assert.equal(harness.commits.length, 1);
  assert.equal(harness.subscriptions, 1);
});

test('issue-4-c9: offline gateway failure is terminal and preserves selection', async () => {
  // Regression caught: a network failure leaves the opening state pending and
  // clears the prior project/session selection.
  let selectedProject = 'project-a';
  const harness = createHarness({
    commit(payload) {
      selectedProject = payload.projectId;
    },
    transport: {
      async listSessions() {
        throw Object.assign(new Error('network unavailable'), {
          code: 'NETWORK_ERROR',
          status: 0,
        });
      },
    },
  });

  const result = await harness.controller.openProjectSession(
    'project-b',
    'session-b',
  );
  assert.equal(result.kind, 'offline');
  assert.equal(selectedProject, 'project-a');
  assert.equal(harness.commits.length, 0);
});

test('issue-4-c10: missing unauthorized and transient failures stay distinct', async () => {
  // Regression caught: target lookup and authorization failures are flattened
  // into a generic error, making Retry misleading and diagnostics impossible.
  const missing = createHarness();
  const unauthorized = createHarness({
    transport: {
      async listSessions() {
        throw Object.assign(new Error('project registration is stale'), {
          status: 404,
        });
      },
    },
  });
  const transient = createHarness({
    transport: {
      async loadSessionState() {
        throw new Error('gateway reset');
      },
    },
  });

  const missingResult = await missing.controller.openProjectSession(
    'project-a',
    'not-there',
  );
  const unauthorizedResult =
    await unauthorized.controller.openProjectSession(
      'project-a',
      'session-a',
    );
  const transientResult = await transient.controller.openProjectSession(
    'project-a',
    'session-a',
  );

  assert.equal(missingResult.kind, 'missing-session');
  assert.equal(unauthorizedResult.kind, 'unauthorized-project');
  assert.equal(transientResult.kind, 'transient-error');
  assert.equal(
    missing.commits.length +
      unauthorized.commits.length +
      transient.commits.length,
    0,
  );
});
