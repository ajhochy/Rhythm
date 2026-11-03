import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadCommonJs(url, require) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}

const transport = await loadCommonJs(
  new URL('../src/gateway/coordinator-conversations.ts', import.meta.url),
  () => { throw new Error('coordinator transport has no runtime imports'); },
);

const dayflowSourceConsent = await loadCommonJs(
  new URL('../src/gateway/dayflow-source-consent.ts', import.meta.url),
  () => { throw new Error('Dayflow source-consent transport has no runtime imports'); },
);

const emptyDomain = new Proxy({}, {
  get(_target, key) {
    if (key === '__esModule') return true;
    return () => ({});
  },
});

const gatewayModule = await loadCommonJs(
  new URL('../src/gateway/index.ts', import.meta.url),
  (specifier) => {
    if (specifier === './coordinator-conversations') return transport;
    if (specifier === './dayflow-source-consent') return dayflowSourceConsent;
    if (specifier === './sessions') {
      // This narrow stand-in lets the actual index composition expose the
      // ordinary local fetcher without pulling unrelated renderer domains.
      return {
        createLiveSessionsGateway: (apiBase, _taskToken, localFetcher) => ({
          list: () => localFetcher(`${apiBase}/agent-sessions?scope=chats`, {
            headers: { authorization: 'Bearer must-be-stripped-for-ordinary-local-route' },
          }),
        }),
      };
    }
    if (specifier === '../../../shared/production-api-base.mjs') {
      return { normalizeRemoteProductionApiBase: (value) => String(value).replace(/\/$/, '') };
    }
    return emptyDomain;
  },
);

const config = (taskToken) => ({
  mode: 'live',
  apiBase: 'http://127.0.0.1:4701',
  expectedApiBase: 'http://127.0.0.1:4701',
  engineBase: 'http://127.0.0.1:4702',
  expectedEngineBase: 'http://127.0.0.1:4702',
  productionApiBase: 'https://coordinator.example.test',
  taskToken,
});

const coordinatorConversation = {
  schemaVersion: 1,
  id: 'conversation-1',
  sessionId: 'local-root-1',
  projectId: 'registered-project-1',
  controlRevision: 1,
  goals: [],
};

test('live composition sends the signed-in bearer only to coordinator while ordinary local routes stay stripped', async () => {
  const requests = [];
  const fetcher = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      authorization: new Headers(init?.headers).get('authorization'),
      body: init?.body,
    });
    if (url.endsWith('/coordinator-conversations/open')) {
      return { status: 201, json: async () => ({ kind: 'created', conversation: coordinatorConversation }) };
    }
    return { status: 200, json: async () => [] };
  };
  const gateway = gatewayModule.createLiveGateway(config('invented-signed-in-token'), fetcher);

  await gateway.domains.coordinatorConversations.open({
    sessionId: 'local-root-1',
    projectId: 'registered-project-1',
  });
  await gateway.domains.sessions.list();

  assert.deepEqual(requests, [
    {
      url: 'http://127.0.0.1:4701/coordinator-conversations/open',
      authorization: 'Bearer invented-signed-in-token',
      body: JSON.stringify({ sessionId: 'local-root-1', projectId: 'registered-project-1' }),
    },
    {
      url: 'http://127.0.0.1:4701/agent-sessions?scope=chats',
      authorization: null,
      body: undefined,
    },
  ]);
  assert.equal(JSON.stringify(requests[0].body).includes('invented-signed-in-token'), false);
});

test('live composition holds anonymous and rejected coordinator requests without an SDK or ordinary-route fallback', async () => {
  let calls = 0;
  const fetcher = async (input, init) => {
    calls += 1;
    assert.equal(String(input).endsWith('/coordinator-conversations/open'), true);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer invented-expired-token');
    return { status: 401, json: async () => ({ error: 'unauthorized' }) };
  };
  const scope = { sessionId: 'local-root-1', projectId: 'registered-project-1' };
  const anonymous = gatewayModule.createLiveGateway(config(undefined), fetcher);
  await assert.rejects(
    () => anonymous.domains.coordinatorConversations.open(scope),
    (error) => error.name === 'CoordinatorTransportError' && error.status === 401 && error.retryable === false,
  );
  assert.equal(calls, 0);

  const expired = gatewayModule.createLiveGateway(config('invented-expired-token'), fetcher);
  await assert.rejects(
    () => expired.domains.coordinatorConversations.open(scope),
    (error) => error.name === 'CoordinatorTransportError' && error.status === 401 && error.retryable === false,
  );
  assert.equal(calls, 1);
});

test('live composition sends an exact authenticated Dayflow source-consent request and keeps unavailable results closed', async () => {
  const requests = [];
  const fetcher = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      authorization: new Headers(init?.headers).get('authorization'),
      body: init?.body,
    });
    if (url.endsWith('/dayflow-agent/source-consent')) {
      return { status: 202, json: async () => ({ schemaVersion: 1, status: 'accepted' }) };
    }
    return { status: 200, json: async () => [] };
  };
  const gateway = gatewayModule.createLiveGateway(config('invented-signed-in-token'), fetcher);
  assert.deepEqual(await gateway.domains.dayflowSourceConsent.setSourceConsent({
    action: 'grant', sessionId: 'local-root-1', projectId: 'registered-project-1',
  }), { status: 'accepted' });
  assert.deepEqual(requests, [{
    url: 'http://127.0.0.1:4701/dayflow-agent/source-consent',
    authorization: 'Bearer invented-signed-in-token',
    body: JSON.stringify({ schemaVersion: 1, action: 'grant', sessionId: 'local-root-1', projectId: 'registered-project-1' }),
  }]);
  assert.equal(requests[0].body.includes('invented-signed-in-token'), false);

  const anonymous = gatewayModule.createLiveGateway(config(undefined), fetcher);
  assert.deepEqual(await anonymous.domains.dayflowSourceConsent.setSourceConsent({
    action: 'revoke', sessionId: 'local-root-1', projectId: 'registered-project-1',
  }), { status: 'unavailable' });
  assert.equal(requests.length, 1);

  const denied = gatewayModule.createLiveGateway(config('invented-expired-token'), async () => ({
    status: 403,
    json: async () => ({ schemaVersion: 1, status: 'unavailable' }),
  }));
  assert.deepEqual(await denied.domains.dayflowSourceConsent.setSourceConsent({
    action: 'revoke', sessionId: 'local-root-1', projectId: 'registered-project-1',
  }), { status: 'unavailable' });
});
