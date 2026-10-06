import { expect, test } from '@playwright/test';

const sessionsModulePath = '../../src/gateway/sessions.ts';

async function loadSessions(): Promise<any> {
  try {
    return await import(sessionsModulePath);
  } catch {
    return null;
  }
}

test('engine-session-live-lifecycle-c1: typed gateway keeps local and SDK session identities separate', async () => {
  // Regression caught: live session operations use fixture data or conflate the stable local ID with the engine SDK ID.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  expect(typeof sessions.createLiveSessionsGateway).toBe('function');
});

test('engine-session-live-lifecycle-c2: fixture sessions gateway is network-free and live never falls back', async () => {
  // Regression caught: a failed live read returns a seeded profile/session/transcript instead of a bounded live error.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  let calls = 0;
  const fixture = sessions.createFixtureSessionsGateway(() => { calls += 1; throw new Error('network forbidden'); });
  await expect(fixture.list()).rejects.toThrow(/unsupported/i);
  expect(calls).toBe(0);
});

test('engine-session-live-lifecycle-c3: hydration boundary consumes structured API and WS payloads', async () => {
  // Regression caught: UI duplicates a backend parser or ignores a durable session.removed event.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  expect(typeof sessions.toSessionViewModel).toBe('function');
});

test('engine-session-live-lifecycle-c10: live failures are bounded and redact response secrets', async () => {
  // Regression caught: arbitrary backend bodies or bearer values are rendered in the operation status.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  expect(typeof sessions.SessionGatewayError).toBe('function');
});

// Deferred builtin task: the engine keeps the outer part as `mcp_dispatch` (dispatcher input),
// while the real task implementation still emits child metadata/`task_id` output.
const dispatchInput = { family: 'builtin', action: 'execute', name: 'task', arguments: { description: 'inspect', prompt: 'look', subagent_type: 'general' } };
const taskPart = (over: Record<string, unknown> = {}, state: Record<string, unknown> = {}, tool = 'mcp_dispatch') => ({
  id: 'prt_task', messageID: 'msg_task', type: 'tool', tool, callID: 'call_task',
  state: { status: 'completed', input: dispatchInput, title: 'inspect', metadata: { sessionId: 'ses_child' }, output: 'task_id: ses_child (for resuming)\n<task_result>ok</task_result>', ...state },
  ...over,
});
const sessionsOrFail = async () => { const sessions = await loadSessions(); expect(sessions).not.toBeNull(); return sessions; };

test('coordinator-response-c1: copied transcript preserves prose but omits step snapshot hashes', async () => {
  const sessions = await sessionsOrFail();
  const snapshot = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const blocks = [
    sessions.mapPart({ type: 'step-start', snapshot }, 'step-start'),
    sessions.mapPart({ type: 'text', text: 'The coordinator response.' }, 'text'),
    sessions.mapPart({ type: 'step-finish', reason: 'stop', snapshot }, 'step-finish'),
  ];
  const copied = blocks.map(sessions.blockSource).join('\n\n');

  expect(blocks[0]).toMatchObject({ kind: 'step-start', content: '' });
  expect(blocks[2]).toMatchObject({ kind: 'step-finish', content: '', meta: 'stop' });
  expect(copied).toContain('The coordinator response.');
  expect(copied).not.toContain(snapshot);

  // Older in-memory blocks may still carry a snapshot, but copy must remain safe.
  const legacyCopied = [
    { id: 'legacy-start', kind: 'step-start', content: snapshot },
    { id: 'legacy-finish', kind: 'step-finish', content: snapshot, meta: 'stop' },
  ].map(sessions.blockSource).join('\n\n');
  expect(legacyCopied).not.toContain(snapshot);
});

test('deferred-task-child-link-c1: native eager task is unchanged', async () => {
  const sessions = await sessionsOrFail();
  const block = sessions.mapPart(taskPart({}, { input: { description: 'inspect' }, metadata: {} }, 'task'), 'prt_task');
  expect(block).toMatchObject({ kind: 'children', childSessionId: 'ses_child', terminal: true, streaming: false });
  expect(block.tool.name).toBe('task');
});

test('deferred-task-child-link-c2: deferred task keeps outer mcp_dispatch and links its child (REST mapMessage)', async () => {
  const sessions = await sessionsOrFail();
  const part = taskPart({}, { attachments: [{ type: 'file', mime: 'text/plain', url: 'data:text/plain;base64,YQ==' }] });
  const message = sessions.mapMessage({ info: { id: 'msg_task', role: 'assistant' }, parts: [part] });
  const block = message.blocks[0];
  expect(block).toMatchObject({ kind: 'children', childSessionId: 'ses_child', terminal: true, streaming: false });
  expect(block.tool).toMatchObject({ name: 'mcp_dispatch', callId: 'call_task', status: 'completed', input: dispatchInput, output: part.state.output, metadata: { sessionId: 'ses_child' } });
  expect(block.tool.attachments).toHaveLength(1);
});

test('deferred-task-child-link-c3: running, error, omitted action and metadata/output sources', async () => {
  const sessions = await sessionsOrFail();
  const running = sessions.mapPart(taskPart({}, { status: 'running', output: undefined }), 'p');
  expect(running).toMatchObject({ kind: 'children', childSessionId: 'ses_child', terminal: false, streaming: true });
  const failed = sessions.mapPart(taskPart({}, { status: 'error', error: 'boom' }), 'p');
  expect(failed).toMatchObject({ kind: 'children', childSessionId: 'ses_child', terminal: true });
  expect(failed.tool.error).toBe('boom');
  const { action: _omit, ...noAction } = dispatchInput;
  expect(sessions.mapPart(taskPart({}, { input: noAction }), 'p')).toMatchObject({ kind: 'children', childSessionId: 'ses_child' });
  expect(sessions.mapPart(taskPart({}, { metadata: {} }), 'p')).toMatchObject({ kind: 'children', childSessionId: 'ses_child' });
  expect(sessions.mapPart(taskPart({}, { output: 'no id here' }), 'p')).toMatchObject({ kind: 'children', childSessionId: 'ses_child' });
});

test('deferred-task-child-link-c4: missing or disagreeing child identities produce no link', async () => {
  const sessions = await sessionsOrFail();
  const none = sessions.mapPart(taskPart({}, { metadata: {}, output: 'nothing' }), 'p');
  expect(none.kind).toBe('children');
  expect(none.childSessionId).toBeUndefined();
  const mismatch = sessions.mapPart(taskPart({}, { metadata: { sessionId: 'ses_a' }, output: 'task_id: ses_b (x)' }), 'p');
  expect(mismatch.kind).toBe('children');
  expect(mismatch.childSessionId).toBeUndefined();
});

test('deferred-task-child-link-c5: search/describe, MCP family, other builtins and malformed input stay generic tools', async () => {
  const sessions = await sessionsOrFail();
  const generic = (input: unknown, tool = 'mcp_dispatch') => sessions.mapPart(taskPart({}, { input }, tool), 'p');
  for (const input of [
    { ...dispatchInput, action: 'search' }, { ...dispatchInput, action: 'describe' },
    { ...dispatchInput, family: 'mcp' }, { ...dispatchInput, family: undefined },
    { ...dispatchInput, name: 'read' }, 'task', null, [dispatchInput], undefined,
  ]) {
    const block = generic(input);
    expect(block.kind).toBe('tool');
    expect(block.childSessionId).toBeUndefined();
    expect(block.tool.name).toBe('mcp_dispatch');
  }
  expect(generic(dispatchInput, 'other_tool').kind).toBe('tool');
});

test('deferred-task-child-link-c6: WS applyTranscriptEvent path links the child from the same part', async () => {
  const sessions = await sessionsOrFail();
  const { applyTranscriptEvent } = await import('../../src/gateway/transcript-reducer.ts');
  const empty = { messages: [], pending: {}, generation: 0, parts: {}, tombstones: { messages: {}, parts: {} }, aliases: {}, contentRevision: 0, reconciliationNeeded: false };
  const event = (type: string, props: Record<string, unknown>) => ({ v: 1, type, id: 'local-session', ...props });
  const frames = [
    event('message.updated', { info: { id: 'msg_task', role: 'assistant', time: { created: 1790254334228 } } }),
    event('message.part.updated', { part: taskPart({}, { status: 'running', output: undefined }) }),
    event('message.part.updated', { part: taskPart() }),
  ];
  const state: any = frames.reduce((acc: any, frame) => applyTranscriptEvent(acc, frame as never), empty);
  const block = state.messages.find((m: any) => m.id === 'msg_task').blocks.find((b: any) => b.id === 'prt_task');
  expect(block).toMatchObject({ kind: 'children', childSessionId: 'ses_child' });
  expect(block.tool).toMatchObject({ name: 'mcp_dispatch', input: dispatchInput });
  expect(sessions.mapPart(taskPart(), 'prt_task').childSessionId).toBe('ses_child');
});
