import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (url) => ts.transpileModule(readFileSync(url, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const sessionsUrl = dataModule(compile(new URL('../../src/gateway/sessions.ts', import.meta.url)));
const reducer = await import(dataModule(compile(new URL('../../src/gateway/transcript-reducer.ts', import.meta.url))
  .replace("from './sessions'", `from '${sessionsUrl}'`)));

const page = { mode: 'merge', hasMore: false };
const seed = (messages = []) => ({ messages, hasMore: false, nextCursor: null });
const event = (type, props = {}) => ({ v: 1, type, id: 'local-session', ...props });
const part = (state, messageId, partId) => state.messages.find((message) => message.id === messageId)?.blocks.find((block) => block.id === partId);

test('cached event reducer preserves optimistic aliases, ordering, out-of-order deltas, and explicit reconciliation', () => {
  const cache = new Map();
  const optimistic = {
    id: 'local-user-1', role: 'user', createdAt: '2026-10-05T00:00:00.000Z',
    blocks: [{ id: 'local-user-1-text', kind: 'markdown', content: 'hello' }], attachments: [],
  };
  reducer.mergeCachedTranscriptPage(cache, 'session-alias', seed(), [optimistic], page);
  reducer.reduceCachedTranscriptEvent(cache, 'session-alias', seed(), event('message.part.updated', {
    part: { messageID: 'msg_a', id: 'prt_user', type: 'text', text: 'hello' },
  }));
  let state = reducer.reduceCachedTranscriptEvent(cache, 'session-alias', seed(), event('message.updated', {
    info: { id: 'msg_a', role: 'user', time: { created: 1 } },
  }));
  state = reducer.reduceCachedTranscriptEvent(cache, 'session-alias', seed(), event('message.updated', {
    info: { id: 'msg_z', role: 'assistant', time: { created: 2 } },
  }));
  assert.deepEqual(state.messages.map((message) => message.id), ['msg_a', 'msg_z']);
  assert.equal(state.messages[0].uiKey, 'local-user-1');

  const pendingCache = new Map();
  let pending = reducer.reduceCachedTranscriptEvent(pendingCache, 'session-pending', seed(), event('message.part.delta', {
    messageId: 'msg_late', partId: 'prt_late', field: 'text', delta: 'live-', receivedAt: 1,
  }));
  assert.equal(pending.messages.length, 0);
  assert.equal(pending.pending['msg_late\u0000prt_late'].text, 'live-');
  pending = reducer.mergeCachedTranscriptPage(pendingCache, 'session-pending', seed(), [{
    id: 'msg_late', role: 'assistant', createdAt: '2026-10-05T00:01:00.000Z',
    blocks: [{ id: 'prt_late', kind: 'markdown', content: 'snapshot' }],
  }], page);
  assert.equal(part(pending, 'msg_late', 'prt_late').content, 'snapshot');
  assert.equal(pending.reconciliationNeeded, true);
  const reconciled = reducer.mergeCachedTranscriptPage(pendingCache, 'session-pending', seed(), [{
    id: 'msg_late', role: 'assistant', createdAt: '2026-10-05T00:01:00.000Z',
    blocks: [{ id: 'prt_late', kind: 'markdown', content: 'authoritative', terminal: true }],
  }], { mode: 'replace', hasMore: false });
  assert.equal(part(reconciled, 'msg_late', 'prt_late').content, 'authoritative');
  assert.equal(part(reconciled, 'msg_late', 'prt_late').streaming, false);

  const liveCache = new Map();
  reducer.reduceCachedTranscriptEvent(liveCache, 'session-live', seed(), event('message.part.updated', {
    part: { messageID: 'msg_live', id: 'prt_live', type: 'text', text: '' },
  }));
  reducer.reduceCachedTranscriptEvent(liveCache, 'session-live', seed(), event('message.part.delta', {
    messageId: 'msg_live', partId: 'prt_live', field: 'text', delta: 'live-', receivedAt: 2,
  }));
  const staleMerged = reducer.mergeCachedTranscriptPage(liveCache, 'session-live', seed(), [{
    id: 'msg_live', role: 'assistant', createdAt: '2026-10-05T00:02:00.000Z',
    blocks: [{ id: 'prt_live', kind: 'markdown', content: 'stale' }],
  }], page);
  assert.equal(part(staleMerged, 'msg_live', 'prt_live').content, 'live-');
});

test('cached event reducer hydrates bounded source history once across a live-frame flood', () => {
  const historyRows = 257;
  const eventCount = 96;
  const history = [
    ...Array.from({ length: historyRows - 1 }, (_, index) => ({
      id: `msg-history-${index}`, role: 'assistant', createdAt: `2026-10-05T00:${String(index % 60).padStart(2, '0')}:00.000Z`, blocks: [],
    })),
    { id: 'msg-target', role: 'assistant', createdAt: '2026-10-05T01:00:00.000Z', blocks: [{ id: 'prt-target', kind: 'markdown', content: '' }] },
  ];
  let sourceRowsVisited = 0;
  const countedHistory = new Proxy(history, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) return function* () {
        for (const row of target) {
          sourceRowsVisited += 1;
          yield row;
        }
      };
      return Reflect.get(target, property, receiver);
    },
  });
  const cache = new Map();
  for (let index = 0; index < eventCount; index += 1) {
    reducer.reduceCachedTranscriptEvent(cache, 'session-flood', seed(countedHistory), event('message.part.delta', {
      messageId: 'msg-target', partId: 'prt-target', field: 'text', delta: 'x', receivedAt: index + 1,
    }));
  }
  assert.equal(sourceRowsVisited, historyRows, 'only the initial cache hydration may iterate the authoritative session history');
  assert.equal(part(cache.get('session-flood'), 'msg-target', 'prt-target').content.length, eventCount);
});
