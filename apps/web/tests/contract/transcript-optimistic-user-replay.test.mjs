// Regression (PR #1594): a confirmed optimistic `local-user-*` copy was resurrected and pinned below
// the agent reply. Frames are the captured Auto-session "yes" turn (fixtures/transcript/optimistic-user-auto.jsonl).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (url) => ts.transpileModule(readFileSync(url, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const sessionsUrl = dataModule(compile(new URL('../../src/gateway/sessions.ts', import.meta.url)));
const { mapMessage } = await import(sessionsUrl);
const reducer = await import(dataModule(compile(new URL('../../src/gateway/transcript-reducer.ts', import.meta.url))
  .replace("from './sessions'", `from '${sessionsUrl}'`)));
const capture = JSON.parse(readFileSync(new URL('../fixtures/transcript/optimistic-user-auto.jsonl', import.meta.url), 'utf8').trim());
const TRANSCRIPT = new Set(['message.updated', 'message.part.updated', 'message.part.delta', 'session.status']);
const merge = { mode: 'merge', hasMore: false };

// Mirrors store.tsx reduceSessionTranscript: every event first re-seeds the stored state with the
// React session's `messages`, then applies the event. `replay` re-runs that updater once more against
// the same (pre-update) session — what React does when it re-invokes a setSessions updater.
function run({ replay }) {
  let stored = reducer.mergeTranscriptPage(reducer.emptyTranscript(), capture.priorRest.map(mapMessage), merge);
  const local = { id: 'local-user-1790715169000', role: 'user', createdAt: '2026-09-29T20:52:49.000Z',
    blocks: [{ id: 'local-user-1790715169000-text', kind: 'markdown', content: capture.input.data }], attachments: [] };
  let messages = [...stored.messages, local];
  for (const frame of capture.frames.filter((f) => TRANSCRIPT.has(f.type))) {
    const reduce = () => reducer.applyTranscriptEvent(reducer.mergeTranscriptPage(stored, messages, merge), frame);
    stored = reduce();
    if (replay) stored = reduce();
    messages = stored.messages;
  }
  return messages;
}

for (const replay of [false, true]) {
  test(`captured Auto "yes" confirms its optimistic copy in place (updater replay: ${replay})`, () => {
    assert.equal(capture.kind, 'captured');
    assert.equal(capture.modelMode, 'auto');
    const messages = run({ replay });
    assert.deepEqual(messages.filter((m) => m.id.startsWith('local-user-')).map((m) => m.id), [], 'no optimistic copy survives confirmation');
    const userId = capture.frames.find((f) => f.type === 'message.updated' && f.info.role === 'user').info.id;
    const assistantId = capture.frames.find((f) => f.type === 'message.updated' && f.info.role === 'assistant').info.id;
    const ids = messages.map((m) => m.id);
    assert.ok(ids.indexOf(userId) >= 0 && ids.indexOf(userId) < ids.indexOf(assistantId), 'user turn renders before the reply that answers it');
    assert.equal(messages.find((m) => m.id === userId).uiKey, 'local-user-1790715169000', 'confirmed row keeps the optimistic React key');
  });
}
