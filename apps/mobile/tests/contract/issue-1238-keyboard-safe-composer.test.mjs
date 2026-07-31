import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const chatViewSource = await readFile(
  new URL('../../components/chat/chat-view.tsx', import.meta.url),
  'utf8',
);
const composerSource = await readFile(
  new URL('../../components/chat/chat-composer.tsx', import.meta.url),
  'utf8',
);
const contentSource = await readFile(
  new URL('../../components/chat/chat-content.tsx', import.meta.url),
  'utf8',
);

test('issue-1238-c1: composer is docked below the independently flexible transcript', () => {
  // Regression caught: header chrome consumes the keyboard-avoided viewport and clips the list.
  const headerIndex = chatViewSource.indexOf('<ChatHeader');
  const avoiderIndex = chatViewSource.indexOf('<KeyboardAvoidingView');
  const transcriptIndex = chatViewSource.indexOf('<ChatContent');
  const composerIndex = chatViewSource.indexOf('<ChatComposer');
  assert.ok(headerIndex >= 0 && avoiderIndex > headerIndex);
  assert.ok(transcriptIndex > avoiderIndex && composerIndex > transcriptIndex);
  assert.match(chatViewSource, /keyboardVerticalOffset=\{0\}/);
});

test('issue-1238-c2: multiline input enables internal scrolling at its explicit cap', () => {
  // Supplementary source guard only; MSP-005's RNTL test drives the rendered
  // Paper/native input because this regex cannot prove UIKit caret behavior.
  assert.match(composerSource, /const MAX_INPUT_HEIGHT = \d+;/);
  assert.match(composerSource, /multiline/);
  assert.match(composerSource, /scrollEnabled=\{Platform\.OS === 'ios' \|\| inputHeight >= MAX_INPUT_HEIGHT\}/);
  assert.match(composerSource, /Math\.min\(MAX_INPUT_HEIGHT/);
});

test('issue-1238-c4: transcript exposes interactive dismissal and composer exposes a labeled action', () => {
  // Regression caught: the keyboard traps the transcript with no gesture or discoverable button.
  assert.match(contentSource, /keyboardDismissMode="interactive"/);
  assert.match(composerSource, /accessibilityLabel="Dismiss keyboard"/);
  assert.match(composerSource, /Keyboard\.dismiss/);
});
