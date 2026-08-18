import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const PROJECT_ID = '59243d52-8a77-4d81-94e8-df8d6acec734';
const SESSION_ID = 'ses_0075a8b2fffe3nXy5pBAsc1V6L';
const DEVICE_TOKEN = 'offline_mirror_contract_device_token_1387';

async function importTranspiled(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(output)}`);
}

async function loadOpenController() {
  const source = await readFile(
    new URL('../../providers/open-project-session.ts', import.meta.url),
    'utf8',
  );
  return importTranspiled(source);
}

async function loadProductionConfirmProject() {
  const source = await readFile(
    new URL('../../providers/opencode-provider.tsx', import.meta.url),
    'utf8',
  );
  const sourceFile = ts.createSourceFile(
    'opencode-provider.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let method;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(sourceFile) === 'openProjectSessionRuntimeRef.current' &&
      ts.isObjectLiteralExpression(node.right)
    ) {
      method = node.right.properties.find(
        (property) =>
          ts.isMethodDeclaration(property) &&
          property.name.getText(sourceFile) === 'confirmProject',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(method, 'provider must define its production confirmProject gate');

  const exactMethod = method.getText(sourceFile);
  const compiled = await importTranspiled(`
    export function buildProductionConfirmProject(state) {
      const {
        connection,
        pairedHostMessage,
        pairedHostRecord,
        pairedHostState,
        serverProjects,
      } = state;
      const runtime = { ${exactMethod} };
      return runtime.confirmProject.bind(runtime);
    }
  `);
  return compiled.buildProductionConfirmProject;
}

test('issue-1387-c17: desktop-offline relay opens a cached session from the mirrored transcript', async () => {
  // Regression caught: the production confirmProject gate treats an offline
  // Mac as a dead Cloud Gateway and returns "Opening chat" before the mobile
  // flow can issue its read-only mirrored-transcript request. The assertion on
  // result.kind fails with "offline" while that preflight still blocks reads.
  const [{ createOpenProjectSessionController }, buildConfirmProject] =
    await Promise.all([
      loadOpenController(),
      loadProductionConfirmProject(),
    ]);
  const cachedSession = {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    title: 'Relay QA Renamed',
  };
  const confirmProject = buildConfirmProject({
    // The Cloud Gateway is reachable and has already supplied the cached
    // catalog. Only Mac presence is offline.
    connection: {
      status: 'desktop-offline',
      message: 'Connected to Rhythm Cloud Gateway; Mac is offline.',
    },
    pairedHostMessage:
      'Rhythm Cloud Gateway cannot reach your Mac. Check that Rhythm is running on the Mac and try again.',
    pairedHostRecord: {
      hostId: 'rhythm-mac',
      relayUrl: 'https://api.vcrcapps.com/relay',
    },
    pairedHostState: 'tailscaleUnavailable',
    serverProjects: [{ id: PROJECT_ID }],
  });

  const relayRequests = [];
  const commits = [];
  const controller = createOpenProjectSessionController({
    commit(payload) {
      commits.push(payload);
    },
    transport: {
      confirmProject,
      async listSessions(projectId) {
        assert.equal(projectId, PROJECT_ID);
        return [cachedSession];
      },
      async loadSessionState(projectId, sessionId, session) {
        const request = {
          method: 'GET',
          path: `/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/message`,
          headers: {
            Authorization: `Device ${DEVICE_TOKEN}`,
            'X-Rhythm-Project-ID': projectId,
          },
        };
        relayRequests.push(request);

        // The actual relay HTTP route is separately covered as a real-server
        // boundary. This boundary response is its production engine shape.
        const mirroredTranscript = [{
          info: {
            id: 'msg_ff8e51097001ptN307TEpNkZz5',
            role: 'assistant',
            sessionID: SESSION_ID,
          },
          parts: [{
            id: 'prt_relay_cached_text',
            type: 'text',
            text: 'served from the relay mirror while the Mac is offline',
          }],
        }];
        return {
          messages: mirroredTranscript,
          projectId,
          session,
          sessionId,
        };
      },
    },
  });

  const result = await controller.openProjectSession(PROJECT_ID, SESSION_ID);

  assert.equal(
    result.kind,
    'ready',
    'desktop-offline presence must not block the read-only mirrored transcript path',
  );
  assert.deepEqual(relayRequests, [{
    method: 'GET',
    path: `/mobile-gateway/opencode/session/${SESSION_ID}/message`,
    headers: {
      Authorization: `Device ${DEVICE_TOKEN}`,
      'X-Rhythm-Project-ID': PROJECT_ID,
    },
  }]);
  assert.equal(commits.length, 1);
  assert.equal(
    commits[0].messages[0].parts[0].text,
    'served from the relay mirror while the Mac is offline',
  );
});
