import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (url) => ts.transpileModule(readFileSync(url, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const sessionsUrl = dataModule(compile(new URL('../../src/gateway/sessions.ts', import.meta.url)));
const mapper = await import(sessionsUrl);
const reducerSource = compile(new URL('../../src/gateway/transcript-reducer.ts', import.meta.url))
  .replace("from './sessions'", `from '${sessionsUrl}'`);
const reducer = await import(dataModule(reducerSource));
const empty = () => ({ messages: [], pending: {}, generation: 0, parts: {}, tombstones: { messages: {}, parts: {} }, aliases: {}, contentRevision: 0, reconciliationNeeded: false });
const event = (type, props = {}) => ({ v: 1, type, id: 'local-session', ...props });
const info = (id, role = 'assistant', extra = {}) => event('message.updated', { info: { id, role, time: { created: 1790254334228 }, ...extra } });
const snapshot = (messageID, id, type, text, extra = {}) => event('message.part.updated', { part: { messageID, id, type, text, ...extra } });
const delta = (messageId, partId, text) => event('message.part.delta', { messageId, partId, field: 'text', delta: text });
const run = (frames, start = empty()) => frames.reduce(reducer.applyTranscriptEvent, start);
const block = (state, messageId, partId) => state.messages.find(m => m.id === messageId)?.blocks.find(b => b.id === partId);
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/transcript/${name}.jsonl`, import.meta.url), 'utf8').trim());

// Regression: a captured nested-ID snapshot is ignored, so live reasoning appears as answer text.
test('issue-1582-s1-f1: captured reasoning and text finish once in engine part order', () => {
  const source = fixture('reasoning');
  assert.equal(source.kind, 'captured');
  const state = run(source.frames);
  const final = source.final.messages.find(m => m.parts.some(p => p.type === 'reasoning'));
  assert.ok(final, 'captured final REST contains reasoning');
  const message = state.messages.find(m => m.id === final.sdkMessageId || m.id === final.info?.id);
  assert.ok(message);
  for (const part of final.parts.filter(p => p.type === 'reasoning' || p.type === 'text')) {
    assert.equal(block(state, message.id, part.id)?.content, part.text);
    assert.equal(message.blocks.filter(b => b.id === part.id).length, 1);
  }
});

// Regression: equal or repeated chunks are wrongly deduplicated, or stale prefixes shorten Unicode output.
test('issue-1582-s1-f2-f3: repeated Unicode deltas append exactly; nonfinal stale prefix cannot shorten', () => {
  const start = run([info('msg_a'), snapshot('msg_a', 'prt_a', 'reasoning', '')]);
  const streamed = run([delta('msg_a', 'prt_a', '🙂'), delta('msg_a', 'prt_a', '🙂'), delta('msg_a', 'prt_a', 'aba'), delta('msg_a', 'prt_a', 'aba')], start);
  assert.equal(block(streamed, 'msg_a', 'prt_a').content, '🙂🙂abaaba');
  const stale = run([snapshot('msg_a', 'prt_a', 'reasoning', '🙂')], streamed);
  assert.equal(block(stale, 'msg_a', 'prt_a').content, '🙂🙂abaaba');
  assert.equal(block(run([snapshot('msg_a', 'prt_a', 'reasoning', 'short', { time: { end: 1790254335000 } })], stale), 'msg_a', 'prt_a').content, 'short');
});

// Regression: unknown reasoning delta masquerades as markdown or guessed overlapping text.
test('issue-1582-s1-f2: unknown deltas buffer invisibly until an authoritative snapshot', () => {
  const buffered = run([delta('msg_a', 'prt_a', 'aba'), delta('msg_a', 'prt_a', 'aba')]);
  assert.equal(buffered.messages.length, 0);
  assert.equal(Object.keys(buffered.pending).length, 1);
  const merged = reducer.mergeTranscriptPage(buffered, [mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant' }, parts: [{ id: 'prt_a', type: 'reasoning', text: 'aba' }] })], { mode: 'merge', hasMore: false });
  assert.equal(block(merged, 'msg_a', 'prt_a').content, 'aba'); // ambiguous overlap is not guessed
  assert.equal(merged.reconciliationNeeded, true);
});

// Regression: a stale REST read erases WS-active text or deletes an absent live part.
test('issue-1582-s1-f4: old REST pages preserve active parts and terminal WS snapshots', () => {
  const active = run([snapshot('msg_a', 'prt_a', 'text', ''), delta('msg_a', 'prt_a', 'hi'), delta('msg_a', 'prt_a', '!')]);
  const old = mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant' }, parts: [{ id: 'prt_a', type: 'text', text: 'h' }] });
  const merged = reducer.mergeTranscriptPage(active, [old], { mode: 'merge', hasMore: false });
  assert.equal(block(merged, 'msg_a', 'prt_a').content, 'hi!');
  const absent = reducer.mergeTranscriptPage(merged, [mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant' }, parts: [] })], { mode: 'merge', hasMore: false });
  assert.equal(block(absent, 'msg_a', 'prt_a').content, 'hi!');
  const final = run([snapshot('msg_a', 'prt_a', 'text', 'hi', { time: { end: 5 } }), delta('msg_a', 'prt_a', '!')], absent);
  assert.equal(block(final, 'msg_a', 'prt_a').content, 'hi');
  assert.equal(block(reducer.mergeTranscriptPage(final, [old], { mode: 'merge', hasMore: false }), 'msg_a', 'prt_a').content, 'hi');
});

// Regression: repeated REST polls duplicate tools, permission and question parts.
test('issue-1582-s1-f5: captured tool permission and question replay keep unique canonical parts', () => {
  for (const name of ['tool', 'permission', 'question']) {
    const captured = fixture(name);
    const state = run(captured.frames);
    const all = state.messages.flatMap(m => m.blocks.map(b => `${m.id}:${b.id}`));
    assert.equal(new Set(all).size, all.length, name);
    const tools = captured.frames.filter(f => f.type === 'message.part.updated' && f.part?.type === 'tool');
    assert.ok(tools.length, `${name} has a tool`);
    for (const frame of tools) assert.equal(state.messages.find(m => m.id === frame.part.messageID)?.blocks.filter(b => b.id === frame.part.id).length, 1);
  }
});

// Regression: captured interrupted partial text is lost or survives forever as streaming.
test('issue-1582-s1-f6: captured cancellation preserves one interrupted message and settles streaming', () => {
  const captured = fixture('cancel');
  const state = reducer.settleTranscript(run(captured.frames));
  const interrupted = state.messages.filter(m => m.interrupted);
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].blocks.some(b => b.kind === 'markdown' && b.content === 'partial-'), true);
  assert.equal(interrupted[0].blocks.some(b => b.streaming), false);
});

// Regression: provider errors or plain sessions fabricate an empty thinking part.
test('issue-1582-s1-f7-f8-f9: error/plain/redacted reasoning never fabricates text', () => {
  for (const name of ['error', 'plain']) assert.equal(run(fixture(name).frames).messages.flatMap(m => m.blocks).filter(b => b.kind === 'reasoning').length, 0);
  assert.equal(mapper.mapPart({ type: 'reasoning', text: '[REDACTED]' }, 'prt_redacted').content, '');
  assert.equal(mapper.mapMessage({ id: 23, role: 'user' }).createdAt, new Date(0).toISOString());
});

// Regression: identical sends collapse together, and confirmation remounts optimistic UI keys.
test('issue-1582-s1-f10: unique send aliases preserve stable UI keys for identical text and attachments', () => {
  const optimistic = (id, attachments = []) => ({ id, role: 'user', createdAt: '', blocks: [{ id: `${id}-text`, kind: 'markdown', content: 'same' }], attachments });
  let state = reducer.mergeTranscriptPage(empty(), [optimistic('local-user-1'), optimistic('local-user-2')], { mode: 'merge', hasMore: false });
  state = run([info('msg_one', 'user'), snapshot('msg_one', 'prt_one', 'text', 'same')], state);
  assert.equal(state.messages.filter(m => m.role === 'user').length, 2);
  assert.equal(state.messages.find(m => m.id === 'msg_one')?.uiKey, 'local-user-1');
  state = run([info('msg_two', 'user'), snapshot('msg_two', 'prt_two', 'text', 'same')], state);
  assert.equal(state.messages.find(m => m.id === 'msg_two')?.uiKey, 'local-user-2');
  assert.equal(new Set(state.messages.map(m => m.uiKey ?? m.id)).size, 2);
});

// Regression: pagination and background merges truncate old history or churn untouched objects.
test('issue-1582-s1-f11-f12: pages retain history, source order, no-op identity, and revision', () => {
  const first = mapper.mapMessage({ id: 1, role: 'user', parts: [] });
  const newest = mapper.mapMessage({ info: { id: 'msg_new', role: 'assistant' }, parts: [] });
  const state = reducer.mergeTranscriptPage(empty(), [first, newest], { mode: 'merge', hasMore: true, nextCursor: 'older' });
  const next = reducer.mergeTranscriptPage(state, [newest], { mode: 'merge', hasMore: true, nextCursor: 'changed' });
  assert.deepEqual(next.messages.map(m => m.id), ['1', 'msg_new']);
  assert.strictEqual(next.messages[0], state.messages[0]);
  assert.equal(next.cursor, 'older');
  assert.strictEqual(reducer.applyTranscriptEvent(next, event('permission.asked')), next);
  assert.equal(reducer.applyTranscriptEvent(next, event('output.flush')).contentRevision, next.contentRevision);
});

// Regression: missing compaction or explicit removals are resurrected by a delayed page.
test('issue-1582-s1-f13-f14: synthetic compaction and removal tombstones reject stale pages', () => {
  const page = mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant' }, parts: [{ id: 'prt_a', type: 'compaction' }, { id: 'prt_b', type: 'text', text: 'bye' }] });
  let state = reducer.mergeTranscriptPage(empty(), [page], { mode: 'merge', hasMore: false });
  assert.deepEqual(state.messages[0].blocks.map(b => b.kind), ['compaction', 'markdown']);
  state = run([event('message.part.removed', { messageId: 'msg_a', partId: 'prt_b' })], state);
  assert.equal(block(state, 'msg_a', 'prt_b'), undefined);
  state = reducer.mergeTranscriptPage(state, [page], { mode: 'merge', hasMore: false });
  assert.equal(block(state, 'msg_a', 'prt_b'), undefined);
  state = run([event('message.removed', { messageId: 'msg_a' })], state);
  assert.equal(reducer.mergeTranscriptPage(state, [page], { mode: 'merge', hasMore: false }).messages.length, 0);
});

// Regression: a restarted generation accepts stale terminal/delta state from the old turn.
test('issue-1582-s1-f15: generation restart and bounded unknown buffer request reconciliation', () => {
  let state = run([snapshot('msg_a', 'prt_a', 'text', 'done', { time: { end: 4 } })]);
  state = reducer.applyTranscriptEvent(state, event('session.status', { working: true, generation: 2 }));
  assert.equal(state.generation, 2);
  assert.equal(block(run([delta('msg_a', 'prt_a', 'late')], state), 'msg_a', 'prt_a').content, 'done');
  const oversized = run([delta('msg_other', 'prt_unknown', 'x'.repeat(1024 * 1024 + 1))], state);
  assert.equal(oversized.reconciliationNeeded, true);
  assert.equal(Object.keys(oversized.pending).length, 0);
});

// Regression: unknown deltas consume unbounded memory or silently expire without a reconciliation signal.
test('issue-1582-s1-f16: 128 unknown entries and 60-second lifetime are bounded without history truncation', () => {
  let state = run([snapshot('msg_safe', 'prt_safe', 'text', 'history', { time: { end: 1 } })]);
  for (let n = 0; n < 128; n++) state = reducer.applyTranscriptEvent(state, event('message.part.delta', { messageId: 'msg_new', partId: `prt_${n}`, field: 'text', delta: 'a', receivedAt: 1000 }));
  assert.equal(Object.keys(state.pending).length, 128);
  state = reducer.applyTranscriptEvent(state, event('message.part.delta', { messageId: 'msg_new', partId: 'prt_129', field: 'text', delta: 'b', receivedAt: 1001 }));
  assert.equal(state.reconciliationNeeded, true);
  assert.equal(Object.keys(state.pending).length, 128);
  assert.equal(block(state, 'msg_safe', 'prt_safe').content, 'history');
  state = reducer.applyTranscriptEvent(state, event('message.part.delta', { messageId: 'msg_new', partId: 'prt_0', field: 'text', delta: 'c', receivedAt: 61001 }));
  assert.equal(state.pending['msg_new\u0000prt_0'].text, 'c');
  assert.equal(Object.keys(state.pending).length, 1);
});

// Regression: an attachment-only confirmation aliases the wrong row or remounts its UI key.
test('issue-1582-s1-f17: synthetic attachment-only and mixed sends require matching ordered attachments', () => {
  const attachment = { id: 'one', type: 'file', path: '/sandbox/project/a', filename: 'a', mime: 'text/plain', size: 1 };
  let state = reducer.mergeTranscriptPage(empty(), [
    { id: 'local-user-1', role: 'user', createdAt: '', blocks: [], attachments: [attachment] },
    { id: 'local-user-2', role: 'user', createdAt: '', blocks: [{ id: 'text', kind: 'markdown', content: 'same' }], attachments: [attachment] },
  ], { mode: 'merge', hasMore: false });
  state = reducer.mergeTranscriptPage(state, [{ id: 'msg_attachment', role: 'user', createdAt: '', blocks: [], attachments: [attachment] }], { mode: 'merge', hasMore: false });
  assert.equal(state.messages.find(m => m.id === 'msg_attachment')?.uiKey, 'local-user-1');
  state = reducer.mergeTranscriptPage(state, [{ id: 'msg_mixed', role: 'user', createdAt: '', blocks: [{ id: 'prt_text', kind: 'markdown', content: 'same' }], attachments: [attachment] }], { mode: 'merge', hasMore: false });
  assert.equal(state.messages.find(m => m.id === 'msg_mixed')?.uiKey, 'local-user-2');
  assert.equal(new Set(state.messages.map(m => m.uiKey ?? m.id)).size, 2);
});

// Regression: part-before-info loses the role, or info-before-part loses a confirmed canonical ID.
test('issue-1582-s1-f18: info before and after part preserve one canonical user message', () => {
  for (const frames of [[snapshot('msg_user', 'prt_text', 'text', 'hello'), info('msg_user', 'user')], [info('msg_user', 'user'), snapshot('msg_user', 'prt_text', 'text', 'hello')]]) {
    const state = run(frames);
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].role, 'user');
    assert.equal(state.messages[0].blocks[0].content, 'hello');
  }
});

// Regression: fixture drift invents top-level snapshot IDs or silently re-labels a synthetic record captured.
test('issue-1582-s1-f19: seven captured fixtures retain authentic nested IDs and ordered provenance', () => {
  for (const name of ['reasoning', 'plain', 'tool', 'permission', 'question', 'cancel', 'error']) {
    const source = fixture(name);
    assert.equal(source.kind, 'captured');
    assert.equal(source.sourceCommit, 'e93eac6e7f9007eb4f4be4a434784a5fe7e2d3da');
    assert.equal(Array.isArray(source.frames), true);
    assert.ok(source.mid && source.final && source.captureCommand);
    for (const frame of source.frames.filter(f => f.type === 'message.part.updated')) {
      assert.ok(frame.part?.id && frame.part?.messageID);
      assert.equal(frame.messageId, undefined);
      assert.equal(frame.id, source.ids.local);
    }
  }
});

// Regression: message info arriving after a text part erases an already-confirmed alias.
test('issue-1582-s1-repair-info: metadata updates keep canonical blocks and optimistic key', () => {
  const local = { id: 'local-user-1', role: 'user', createdAt: '', blocks: [{ id: 'draft', kind: 'markdown', content: 'hello' }] };
  let state = reducer.mergeTranscriptPage(empty(), [local], { mode: 'merge', hasMore: false });
  state = run([snapshot('msg_user', 'prt_a', 'text', 'hello'), info('msg_user', 'user', { cost: 2 })], state);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].uiKey, 'local-user-1');
  assert.equal(state.messages[0].cost, 2);
  assert.equal(state.messages[0].blocks[0].content, 'hello');
});

// Regression: final REST cannot settle a live block, while a stale nonfinal REST cannot undo terminal WS.
test('issue-1582-s1-repair-terminal: terminal REST beats active WS, nonfinal cannot beat terminal', () => {
  const page = text => mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant' }, parts: [{ id: 'prt_a', type: 'text', text }] });
  const active = run([snapshot('msg_a', 'prt_a', 'text', 'unfinished')]);
  const final = reducer.mergeTranscriptPage(active, [mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant' }, parts: [{ id: 'prt_a', type: 'text', text: 'finished', time: { end: 9 } }] })], { mode: 'merge', hasMore: false });
  assert.equal(block(final, 'msg_a', 'prt_a').content, 'finished');
  assert.equal(block(final, 'msg_a', 'prt_a').streaming, false);
  assert.equal(block(reducer.mergeTranscriptPage(final, [page('stale')], { mode: 'merge', hasMore: false }), 'msg_a', 'prt_a').content, 'finished');
});

// Regression: UTF-16 code units underestimate unknown-buffer size for astral characters.
test('issue-1582-s1-repair-utf8: unknown deltas respect UTF-8 byte ceiling', () => {
  const state = run([delta('msg_a', 'prt_a', '🙂'.repeat(262145))]);
  assert.equal(Object.keys(state.pending).length, 0);
  assert.equal(state.reconciliationNeeded, true);
});

// Regression: replacement accidentally leaves the same revision and removal ignores metadata change.
test('issue-1582-s1-repair-revision: replace and metadata/removal change content revision', () => {
  const first = run([info('msg_a')]);
  const replaced = reducer.mergeTranscriptPage(first, [mapper.mapMessage({ info: { id: 'msg_b', role: 'assistant' }, parts: [] })], { mode: 'replace', hasMore: false });
  assert.deepEqual(replaced.messages.map(m => m.id), ['msg_b']);
  assert.ok(replaced.contentRevision > first.contentRevision);
  const removed = reducer.applyTranscriptEvent(replaced, event('message.removed', { messageId: 'msg_b' }));
  assert.ok(removed.contentRevision > replaced.contentRevision);
});

// Regression: absent creation time silently becomes an epoch timestamp.
test('issue-1582-s1-repair-created: mapper keeps base creation time and interrupted error', () => {
  assert.equal(mapper.mapMessage({ id: 12, role: 'user', createdAt: '2026-09-24T00:00:00.000Z' }).createdAt, '2026-09-24T00:00:00.000Z');
  assert.equal(mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant', error: { name: 'MessageAbortedError' } } }).interrupted, true);
});

// Regression: a system notice sorts behind an assistant answer and a stale REST stand-in clobbers an SDK row.
test('issue-1582-s1-repair-order: chronological insert and canonical SDK beats numeric stand-in', () => {
  let state = run([info('msg_z'), info('msg_b', 'system'), info('msg_a', 'user')]);
  assert.deepEqual(state.messages.map(m => m.id), ['msg_a', 'msg_b', 'msg_z']);
  const canonical = mapper.mapMessage({ info: { id: 'msg_z', role: 'assistant' }, parts: [{ id: 'prt_a', type: 'text', text: 'answer', time: { end: 8 } }] });
  state = reducer.mergeTranscriptPage(state, [canonical], { mode: 'merge', hasMore: false });
  state = reducer.mergeTranscriptPage(state, [mapper.mapMessage({ id: 12, role: 'output', sdkMessageId: 'msg_z', parts: [] })], { mode: 'merge', hasMore: false });
  assert.equal(block(state, 'msg_z', 'prt_a').content, 'answer');
});

// Regression: a newer tool final state is replaced by stale running state; a no-op poll churns objects.
test('issue-1582-s1-repair-tool: tool final status, output, error survive stale pages and duplicate polls', () => {
  let state = run([snapshot('msg_a', 'prt_tool', 'tool', undefined, { tool: 'bash', state: { status: 'running', input: {} } })]);
  state = run([snapshot('msg_a', 'prt_tool', 'tool', undefined, { tool: 'bash', state: { status: 'error', output: 'partial', error: 'denied' } })], state);
  const old = mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant' }, parts: [{ id: 'prt_tool', type: 'tool', tool: 'bash', state: { status: 'running' } }] });
  const once = reducer.mergeTranscriptPage(state, [old], { mode: 'merge', hasMore: false });
  assert.equal(block(once, 'msg_a', 'prt_tool').tool.status, 'error');
  assert.equal(block(once, 'msg_a', 'prt_tool').tool.output, 'partial');
  assert.equal(block(once, 'msg_a', 'prt_tool').tool.error, 'denied');
  const twice = reducer.mergeTranscriptPage(once, [old], { mode: 'merge', hasMore: false });
  assert.strictEqual(twice, once);
});

// Regression: receiving a live file block prematurely aliases an attachment-only send to an incomplete row.
test('issue-1582-s1-repair-attachment: ordered store-shape attachments ignore volatile keys and await complete set', () => {
  const a = { id: 'local-a', type: 'file', path: '/tmp/a', filename: 'a', mime: 'text/plain', size: 3 };
  const b = { id: 'local-b', type: 'file', path: '/tmp/b', filename: 'b', mime: 'text/plain', size: 4 };
  let state = reducer.mergeTranscriptPage(empty(), [{ id: 'local-user-1', role: 'user', createdAt: '', blocks: [], attachments: [a, b] }], { mode: 'merge', hasMore: false });
  const canonicalA = { ...a, id: 'prt_file_a' }, canonicalB = { ...b, id: 'prt_file_b' };
  state = reducer.mergeTranscriptPage(state, [{ id: 'msg_a', role: 'user', createdAt: '', blocks: [], attachments: [canonicalA] }], { mode: 'merge', hasMore: false });
  assert.ok(state.messages.some(m => m.id === 'local-user-1'));
  state = reducer.mergeTranscriptPage(state, [{ id: 'msg_a', role: 'user', createdAt: '', blocks: [], attachments: [canonicalA, canonicalB] }], { mode: 'merge', hasMore: false });
  assert.equal(state.messages.find(m => m.id === 'msg_a')?.uiKey, 'local-user-1');
  assert.equal(state.messages.length, 1);
});

// Regression: settle drops a legacy nonstreaming draft that has not yet been confirmed.
test('issue-1582-s1-repair-idle: idle seed retains nonstreaming legacy rows', () => {
  const row = { id: 'local-user-1', role: 'user', createdAt: '', blocks: [{ id: 'draft', kind: 'markdown', content: 'pending' }] };
  const state = reducer.mergeTranscriptPage(empty(), [row], { mode: 'merge', hasMore: false });
  assert.equal(reducer.settleTranscript(state).messages[0].id, 'local-user-1');
});

// Regression: a canonical file part never matches the store's attachment-only placeholder.
test('issue-1582-s1-repair-live-file: file parts confirm the store-shape attachment-only send', () => {
  const attachment = { id: 'local-file', type: 'file', path: '/tmp/a', filename: 'a.txt', mime: 'text/plain', size: 99 };
  const local = { id: 'local-user-1', role: 'user', createdAt: '', blocks: [{ id: 'draft', kind: 'markdown', content: 'Attached file context.' }], attachments: [attachment] };
  const start = reducer.mergeTranscriptPage(empty(), [local], { mode: 'merge', hasMore: false });
  const state = run([info('msg_file', 'user'), snapshot('msg_file', 'prt_file', 'file', undefined, { filename: 'a.txt', mime: 'text/plain', url: 'data:text/plain,hello' })], start);
  assert.equal(state.messages.find(m => m.id === 'msg_file')?.uiKey, 'local-user-1');
  assert.equal(state.messages.length, 1);
});

// Regression P1/P4: numeric REST system notices sort after the captured turn, without duplicating a canonical SDK row.
test('issue-1582-s1-repair2-order: captured REST and WS reconciliation preserve message/part order', () => {
  for (const name of ['reasoning', 'plain', 'tool', 'permission', 'question', 'cancel', 'error']) {
    const captured = fixture(name);
    const ws = run(captured.frames);
    const canonical = captured.final.messages.filter(m => m.sdkMessageId);
    assert.deepEqual(ws.messages.map(m => m.id), canonical.map(m => m.sdkMessageId), `${name} WS order`);
    const rows = captured.final.messages.map(mapper.mapMessage);
    const merged = reducer.mergeTranscriptPage(ws, rows, { mode: 'merge', hasMore: false });
    assert.deepEqual(merged.messages.map(m => m.id), rows.map(m => m.id), `${name} reconciled order`);
    for (const row of rows) {
      const got = merged.messages.find(message => message.id === row.id).blocks.map(part => part.id);
      assert.deepEqual(got, row.blocks.map(part => part.id), `${name} exact final part order`);
    }
    if (name === 'cancel' || name === 'error') {
      assert.deepEqual(reducer.mergeTranscriptPage(empty(), rows, { mode: 'merge', hasMore: false }).messages.map(m => m.id), rows.map(m => m.id), `${name} REST seed order`);
      assert.deepEqual(merged.messages.map(m => m.role), ['user', 'assistant', 'system']);
    }
    assert.equal(new Set(merged.messages.map(m => m.id)).size, merged.messages.length);
  }
});

// Regression P2/P5: REST-only rows display as settled; stale REST cannot roll back completed tool results.
test('issue-1582-s1-repair2-rest: captured REST never streams and tool completion remains terminal', () => {
  for (const name of ['reasoning', 'plain', 'tool', 'permission', 'question', 'cancel', 'error']) {
    const captured = fixture(name);
    const rows = captured.final.messages.map(mapper.mapMessage);
    const seeded = reducer.mergeTranscriptPage(empty(), rows, { mode: 'merge', hasMore: false });
    assert.deepEqual(seeded.messages.flatMap(m => m.blocks.filter(b => b.streaming).map(b => b.id)), [], name);
    const settled = reducer.settleTranscript(seeded);
    const repeated = reducer.mergeTranscriptPage(settled, rows, { mode: 'merge', hasMore: false });
    assert.strictEqual(repeated, settled, `${name} repeat identity`);
    assert.equal(repeated.contentRevision, settled.contentRevision, `${name} repeat revision`);
  }
  const captured = fixture('tool');
  const tool = captured.final.messages.flatMap(m => m.parts).find(p => p.type === 'tool');
  const done = reducer.mergeTranscriptPage(run(captured.frames), captured.mid.messages.map(mapper.mapMessage), { mode: 'merge', hasMore: false });
  const result = done.messages.flatMap(m => m.blocks).find(b => b.id === tool.id);
  assert.equal(result.tool.status, 'completed');
  assert.equal(result.tool.output, tool.state.output);
  assert.equal(result.tool.error, tool.state.error);
});

// Regression P3: loading older pages loses cursor, churns existing rows, or reorders legacy notices.
test('issue-1582-s1-repair2-older: older pagination preserves history, identity and chronology', () => {
  const make = id => mapper.mapMessage({ info: { id, role: 'assistant' }, parts: [{ id: `prt_${id}`, type: 'text', text: id, time: { end: 1 } }] });
  const newest = reducer.mergeTranscriptPage(empty(), [make('msg_c'), make('msg_d')], { mode: 'merge', hasMore: true, nextCursor: 'c1' });
  const older = reducer.mergeTranscriptPage(newest, [make('msg_a'), make('msg_b')], { mode: 'merge', older: true, hasMore: false, nextCursor: null });
  assert.deepEqual(older.messages.map(m => m.id), ['msg_a', 'msg_b', 'msg_c', 'msg_d']);
  assert.equal(older.cursor, null);
  assert.equal(older.hasMore, false);
  assert.strictEqual(older.messages[2], newest.messages[0]);
  assert.strictEqual(reducer.mergeTranscriptPage(older, [make('msg_a'), make('msg_b')], { mode: 'merge', older: true, hasMore: false, nextCursor: null }), older);
  const future = mapper.mapMessage({ info: { id: 'msg_zz', role: 'user', time: { created: Date.parse('2026-09-24T13:00:00Z') } }, parts: [] });
  const legacy = fixture('cancel').final.messages.map(mapper.mapMessage);
  const paged = reducer.mergeTranscriptPage(reducer.mergeTranscriptPage(empty(), [future], { mode: 'merge', hasMore: true, nextCursor: 'c1' }), legacy, { mode: 'merge', older: true, hasMore: false, nextCursor: null });
  assert.deepEqual(paged.messages.map(m => m.id), [...legacy.map(m => m.id), 'msg_zz']);
  const legacyNewer = mapper.mapMessage({ id: 20, role: 'output', createdAt: '2026-09-24T12:00:00.000Z', parts: [] });
  const legacyOlder = mapper.mapMessage({ id: 10, role: 'output', createdAt: '2026-09-24T11:00:00.000Z', parts: [] });
  const legacyPaged = reducer.mergeTranscriptPage(
    reducer.mergeTranscriptPage(empty(), [legacyNewer], { mode: 'merge', hasMore: true, nextCursor: 'legacy' }),
    [legacyOlder],
    { mode: 'merge', older: true, hasMore: false, nextCursor: null },
  );
  assert.deepEqual(legacyPaged.messages.map(m => m.id), ['10', '20']);
});

// Regression P6/P11: metadata-only REST bumps revision differently from WS, or repeated confirmation steals revision.
test('issue-1582-s1-repair2-revision: metadata and alias revisions agree across origins', () => {
  const start = run([info('msg_a')]);
  const ws = run([info('msg_a', 'assistant', { cost: 3 })], start);
  const rest = reducer.mergeTranscriptPage(start, [mapper.mapMessage({ info: { id: 'msg_a', role: 'assistant', time: { created: 1790254334228 }, cost: 3 }, parts: [] })], { mode: 'merge', hasMore: false });
  assert.equal(ws.messages[0].cost, 3);
  assert.equal(rest.messages[0].cost, 3);
  assert.equal(ws.contentRevision - start.contentRevision, rest.contentRevision - start.contentRevision);
  assert.strictEqual(run([info('msg_a', 'assistant', { cost: 3 })], ws), ws);
  const local = { id: 'local-user-1', role: 'user', createdAt: '', blocks: [{ id: 'draft', kind: 'markdown', content: 'hi' }] };
  const seeded = reducer.mergeTranscriptPage(empty(), [local], { mode: 'merge', hasMore: false });
  const confirmed = run([info('msg_u', 'user'), snapshot('msg_u', 'prt_u', 'text', 'hi')], seeded);
  assert.equal(confirmed.messages.length, 1);
  assert.equal(confirmed.messages[0].uiKey, 'local-user-1');
  assert.ok(confirmed.contentRevision > seeded.contentRevision);
  const canonical = mapper.mapMessage({ info: { id: 'msg_rest', role: 'user', time: { created: 1790254334228 } }, parts: [{ id: 'prt_rest', type: 'text', text: 'rest only' }] });
  const optimistic = { id: 'local-user-rest', role: 'user', createdAt: '', blocks: [{ id: 'draft-rest', kind: 'markdown', content: 'rest only' }] };
  let restOnly = reducer.mergeTranscriptPage(empty(), [canonical], { mode: 'merge', hasMore: false });
  restOnly = reducer.mergeTranscriptPage(restOnly, [optimistic], { mode: 'merge', hasMore: false });
  const restRevision = restOnly.contentRevision;
  const restConfirmed = reducer.mergeTranscriptPage(restOnly, [canonical], { mode: 'merge', hasMore: false });
  assert.deepEqual(restConfirmed.messages.map(m => m.id), ['msg_rest']);
  assert.equal(restConfirmed.messages[0].uiKey, 'local-user-rest');
  assert.equal(restConfirmed.aliases.msg_rest, 'local-user-rest');
  assert.ok(restConfirmed.contentRevision > restRevision);
  for (const name of ['reasoning', 'plain', 'tool', 'permission', 'question', 'cancel', 'error']) {
    const captured = fixture(name);
    const state = reducer.settleTranscript(run(captured.frames));
    const known = captured.final.messages.map(mapper.mapMessage).filter(row => state.messages.some(m => m.id === row.id && row.blocks.every(b => m.blocks.some(existing => existing.id === b.id))));
    assert.equal(reducer.mergeTranscriptPage(state, known, { mode: 'merge', hasMore: false }).contentRevision, state.contentRevision, name);
  }
});

// Regression D4: a running task loaded from REST is marked terminal, so its next WS progress snapshot is rejected.
test('issue-1582-s1-repair3-children: running task children accept later progress until terminal', () => {
  const running = mapper.mapMessage({
    info: { id: 'msg_task', role: 'assistant' },
    parts: [{ id: 'prt_task', type: 'tool', tool: 'task', state: { status: 'running', title: 'Starting child', output: 'task_id: child_1' } }],
  });
  const seeded = reducer.mergeTranscriptPage(empty(), [running], { mode: 'merge', hasMore: false });
  assert.equal(block(seeded, 'msg_task', 'prt_task').kind, 'children');
  assert.equal(block(seeded, 'msg_task', 'prt_task').terminal, false);
  const progressed = run([snapshot('msg_task', 'prt_task', 'tool', undefined, {
    tool: 'task', state: { status: 'running', title: 'Child made progress', output: 'task_id: child_1' },
  })], seeded);
  assert.equal(block(progressed, 'msg_task', 'prt_task').content, 'Child made progress');
  assert.equal(block(progressed, 'msg_task', 'prt_task').terminal, false);
});

// Regression P7: a multibyte append crosses the exact one-MiB unknown-delta cap.
test('issue-1582-s1-repair2-utf8: cumulative byte ceiling admits exact limit only', () => {
  const bytes = state => Object.values(state.pending).reduce((total, p) => total + new TextEncoder().encode(p.text).length, 0);
  const size = 1024 * 1024;
  const exact = run([delta('msg_a', 'prt_a', '🙂'.repeat(size / 4))]);
  assert.equal(bytes(exact), size);
  assert.equal(exact.reconciliationNeeded, false);
  const cumulative = run([delta('msg_a', 'prt_1', 'é'.repeat(size / 4)), delta('msg_a', 'prt_2', '🙂'.repeat(size / 8))]);
  assert.equal(bytes(cumulative), size);
  for (const frame of [delta('msg_a', 'prt_3', 'x'), delta('msg_a', 'prt_1', 'é')]) {
    const over = reducer.applyTranscriptEvent(cumulative, frame);
    assert.equal(over.reconciliationNeeded, true);
    assert.equal(bytes(over), size);
  }
});

// Regression P8: an incremental file prefix steals a shorter send, or duplicate part updates re-alias canonical ID.
test('issue-1582-s1-repair2-attachments: ordered competing signatures remain stable across repeated parts', () => {
  const a = { id: 'la', type: 'file', path: '/a', filename: 'a', mime: 'text/plain', size: 1 };
  const b = { ...a, id: 'lb', path: '/b', filename: 'b' };
  const local = (id, attachments) => ({ id, role: 'user', createdAt: '', blocks: [], attachments });
  let state = reducer.mergeTranscriptPage(empty(), [local('local-user-1', [a, b]), local('local-user-2', [a])], { mode: 'merge', hasMore: false });
  const first = snapshot('msg_1', 'prt_1', 'file', undefined, { filename: 'a', mime: 'text/plain', url: 'u' });
  state = run([info('msg_1', 'user'), first], state);
  assert.equal(state.messages.find(m => m.id === 'msg_1')?.uiKey, undefined);
  assert.ok(state.messages.some(m => m.id === 'local-user-2'));
  state = run([snapshot('msg_1', 'prt_2', 'file', undefined, { filename: 'b', mime: 'text/plain', url: 'u' }), first], state);
  assert.equal(state.messages.find(m => m.id === 'msg_1')?.uiKey, 'local-user-1');
  state = run([info('msg_2', 'user'), snapshot('msg_2', 'prt_1', 'file', undefined, { filename: 'a', mime: 'text/plain', url: 'u' })], state);
  assert.deepEqual(state.messages.map(m => [m.id, m.uiKey]), [['msg_1', 'local-user-1'], ['msg_2', 'local-user-2']]);
});

// Regression P9: a REST poll of an already aliased send consumes another identical optimistic row.
test('issue-1582-s1-repair2-alias: confirmed canonical REST replay leaves second identical send pending', () => {
  const local = id => ({ id, role: 'user', createdAt: '', blocks: [{ id: `${id}-draft`, kind: 'markdown', content: 'same' }] });
  let state = reducer.mergeTranscriptPage(empty(), [local('local-user-1'), local('local-user-2')], { mode: 'merge', hasMore: false });
  state = run([info('msg_one', 'user'), snapshot('msg_one', 'prt_one', 'text', 'same')], state);
  state = reducer.mergeTranscriptPage(state, [mapper.mapMessage({ info: { id: 'msg_one', role: 'user', time: { created: 1790254334228 } }, parts: [{ id: 'prt_one', type: 'text', text: 'same' }] })], { mode: 'merge', hasMore: false });
  assert.equal(state.messages.find(m => m.id === 'msg_one').uiKey, 'local-user-1');
  assert.ok(state.messages.some(m => m.id === 'local-user-2'));
});

// Regression P10: final REST reconcile clears a captured cancellation's interruption marker or duplicates partial text.
test('issue-1582-s1-repair2-cancel: captured final REST retains interruption after settle', () => {
  const captured = fixture('cancel');
  const state = reducer.settleTranscript(reducer.mergeTranscriptPage(run(captured.frames), captured.final.messages.map(mapper.mapMessage), { mode: 'merge', hasMore: false }));
  const interrupted = state.messages.filter(m => m.interrupted);
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].blocks.filter(b => b.kind === 'markdown' && b.content === 'partial-').length, 1);
  assert.equal(interrupted[0].blocks.some(b => b.streaming), false);
});
