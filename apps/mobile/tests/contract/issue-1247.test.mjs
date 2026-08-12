import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the fake server`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not parse ${name}`);
}

async function loadHandleSse(state) {
  const source = await readFile(
    new URL('../fake-opencode/server.mjs', import.meta.url),
    'utf8',
  );
  const definition = extractFunction(source, 'handleSse');
  return Function('state', `${definition}; return handleSse;`)(state);
}

function createResponse() {
  const writes = [];
  return {
    writes,
    writeHead() {},
    flushHeaders() {},
    write(chunk) {
      writes.push(chunk);
    },
  };
}

test('issue-1247-c1: a permission created before SSE subscription is replayed by the ready handshake', async () => {
  // Regression caught: prompt_async emits permission.asked while the reconnecting
  // browser has no SSE client, permanently losing the only approval event.
  const permission = {
    id: 'permission-1',
    sessionID: 'session-1',
    permission: 'edit_file',
  };
  const state = {
    nextEventId: 1,
    pendingPermissions: [permission],
    pendingQuestions: [],
    project: { worktree: '/workspace/demo-project' },
    scenario: 'permission',
    sseClients: new Map(),
  };
  const handleSse = await loadHandleSse(state);
  const response = createResponse();

  handleSse({ on() {} }, response);

  const events = response.writes.map((frame) =>
    JSON.parse(frame.trim().replace(/^data: /, '')),
  );
  assert.deepEqual(
    events.map((event) => event.payload.type),
    ['server.connected', 'permission.asked'],
  );
  assert.deepEqual(events[1].payload.properties, permission);
});
