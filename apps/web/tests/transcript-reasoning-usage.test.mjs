import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const compile = (url) => ts.transpileModule(readFileSync(url, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const reactUrl = import.meta.resolve('react');
const jsxUrl = import.meta.resolve('react/jsx-runtime');
const markedUrl = import.meta.resolve('marked');

const safeMarkdownUrl = dataModule(compile(new URL('../src/components/SafeMarkdown.tsx', import.meta.url))
  .replaceAll('"react/jsx-runtime"', `"${jsxUrl}"`)
  .replace("from 'react'", `from '${reactUrl}'`)
  .replace("from 'marked'", `from '${markedUrl}'`));
const emptyStub = dataModule(`export const Icon=()=>null; export const Timestamp=()=>null; export const useFixtures=()=>({}); export const useGateway=()=>({}); export const useDecisionReply=()=>({}); export const usePendingDecisions=()=>({permissions:new Map(),questions:new Map()}); export const blockSource=()=>''; export const canonicalText=()=>''; export const useAuthUser=()=>null; export const readLocalUserPreferences=()=>({}); export const shouldEscalatePermission=()=>false; export const USER_PREFERENCES_CHANGED_EVENT='rhythm:user-preferences-changed'; export const FocusDialog=()=>null;`);
const transcriptSource = compile(new URL('../src/components/Transcript.tsx', import.meta.url))
  .replaceAll('"react/jsx-runtime"', `"${jsxUrl}"`)
  .replace("import './Transcript.css';", '')
  .replace("from 'react'", `from '${reactUrl}'`)
  .replace("from '../icons'", `from '${emptyStub}'`)
  .replace("from '../store'", `from '${emptyStub}'`)
  .replace("from '../gateway/context'", `from '${emptyStub}'`)
  .replace("from '../pending-decisions'", `from '${emptyStub}'`)
  .replace("from './SafeMarkdown'", `from '${safeMarkdownUrl}'`)
  .replace("from './Timestamp'", `from '${emptyStub}'`)
  .replace("from '../gateway/sessions'", `from '${emptyStub}'`)
  .replace("from '../gateway/auth'", `from '${emptyStub}'`)
  .replace("from '../gateway/user-preferences'", `from '${emptyStub}'`)
  .replace("from './FocusDialog'", `from '${emptyStub}'`)
  .replace('function MessageUsage(', 'export function MessageUsage(')
  .replace('function RichBlock(', 'export function RichBlock(');
const renderer = await import(dataModule(transcriptSource));

const sessionsUrl = dataModule(compile(new URL('../src/gateway/sessions.ts', import.meta.url)));
const reducerSource = compile(new URL('../src/gateway/transcript-reducer.ts', import.meta.url))
  .replace("from './sessions'", `from '${sessionsUrl}'`);
const reducer = await import(dataModule(reducerSource));

const reasoning = (content) => ({ id: 'reasoning', kind: 'reasoning', title: 'Reasoning', content });
const renderBlock = (block) => renderToStaticMarkup(createElement(renderer.RichBlock, {
  block,
  onOpenChild() {},
  reasoning: { open: Boolean(block.streaming), setOpen() {} },
}));
const renderReasoning = (content) => renderBlock(reasoning(content));
const renderUsage = (message) => renderToStaticMarkup(createElement(renderer.MessageUsage, { message: { id: 'message', role: 'assistant', createdAt: '', blocks: [], ...message } }));
const summaryText = (markup) => markup.match(/<summary>(.*?)<\/summary>/s)?.[1]
  .replace(/<span\b[^>]*>.*?<\/span>/gs, '')
  .replace(/<[^>]+>/g, '') ?? '';

test('1553-empty: empty and whitespace reasoning render no element or click target', () => {
  for (const content of ['', ' \n\t ']) assert.equal(renderReasoning(content), '');
});

test('1553-stream: websocket reasoning becomes renderable and updates its summary as text arrives', () => {
  const start = reducer.emptyTranscript();
  const seeded = reducer.applyTranscriptEvent(start, { type: 'message.part.updated', part: { id: 'part', messageID: 'message', type: 'reasoning', text: '' } });
  assert.equal(renderBlock(seeded.messages[0].blocks[0]), '');
  const streamed = reducer.applyTranscriptEvent(seeded, { type: 'message.part.delta', messageId: 'message', partId: 'part', field: 'text', delta: '**Planning the live update**' });
  assert.equal(summaryText(renderBlock(streamed.messages[0].blocks[0])), 'Planning the live update');
});

test('1553-label: collapsed reasoning uses a syntax-free markdown headline or first nonempty line', () => {
  assert.equal(summaryText(renderReasoning('**Planning repository indexing and state tracking**\n\nDetails.')), 'Planning repository indexing and state tracking');
  assert.equal(summaryText(renderReasoning('\n## Inspecting the streaming reconciliation path\n\nDetails.')), 'Inspecting the streaming reconciliation path');
  assert.equal(summaryText(renderReasoning('***')), 'Reasoning');
});

test('1553-label: collapsed reasoning truncates an unbounded first line with an ellipsis', () => {
  const label = summaryText(renderReasoning('This reasoning headline is intentionally long enough that the collapsed transcript summary must truncate it instead of filling the entire row with unbounded text and losing the compact reading rhythm'));
  assert.match(label, /…$/);
  assert.ok(label.length < 100);
});

test('1553-markdown: reasoning body renders bold text through SafeMarkdown', () => {
  const markup = renderReasoning('**Planning repository indexing**\n\nCheck the **current state**.');
  assert.match(markup, /class="markdown-copy"/);
  assert.match(markup, /<strong>Planning repository indexing<\/strong>/);
  assert.match(markup, /<strong>current state<\/strong>/);
  assert.doesNotMatch(markup, /\*\*/);
});

test('1554-inflight: all-zero or absent usage renders no footer', () => {
  assert.equal(renderUsage({ cost: 0, tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } } }), '');
  assert.equal(renderUsage({ cost: 0, tokens: {} }), '');
});

test('1554-plan-cost: plan-priced messages show tokens without a zero cost', () => {
  const markup = renderUsage({ cost: 0, tokens: { input: 31159, output: 22, cache: { read: 30976, write: 0 } } });
  assert.match(markup, /Input 31159 · Output 22 · Cache read 30976 · Cache write 0/);
  assert.doesNotMatch(markup, /Cost|\$0/);
});

test('1554-format: priced messages never expose a raw float and preserve small costs', () => {
  const priced = renderUsage({ cost: 0.10543375, tokens: { input: 1 } });
  assert.match(priced, /Cost \$0\.105(?:\D|$)/);
  assert.doesNotMatch(priced, /0\.10543375/);
  assert.match(renderUsage({ cost: 0.0042, tokens: { output: 1 } }), /Cost \$0\.0042(?:\D|$)/);
});

test('1554-completed: completed usage preserves every reported token count', () => {
  const markup = renderUsage({ cost: 0, tokens: { input: 3390, output: 91, cache: { read: 53376, write: 7 } } });
  assert.match(markup, /Input 3390 · Output 91 · Cache read 53376 · Cache write 7/);
});

test('1554-tests: a positive cost without token counts still renders a formatted cost', () => {
  const markup = renderUsage({ cost: 0.11 });
  assert.match(markup, /Cost \$0\.11/);
  assert.doesNotMatch(markup, /unknown/);
});
