import assert from 'node:assert/strict';
import test from 'node:test';

import { toTranscriptEntry } from '../lib/opencode/format.ts';
import {
  isTranscriptDisplayMessage,
  summarizeTranscriptDetails,
} from '../lib/opencode/transcript.ts';

const assistantInfo = (id) => ({
  id,
  role: 'assistant',
  sessionID: 'ses-tool-display',
  time: { created: 1, completed: 2 },
});

test('tool-only assistant turns render safe completed/running/failed summaries', () => {
  // Regression caught: the physical iPhone rendered a blank/dot card because
  // assistant messages without text/error were filtered out even though their
  // completed bash ToolPart had useful presentation details.
  const cases = [
    {
      status: 'completed',
      state: {
        status: 'completed',
        title: 'Check working directory',
        input: { command: 'pwd' },
        output: '/private/unsafe/workspace\n',
        metadata: { credential: 'must-not-render' },
        time: { start: 1, end: 2 },
      },
      summary: 'Check working directory · completed',
    },
    {
      status: 'running',
      state: {
        status: 'running',
        input: { command: 'npm test' },
        metadata: { credential: 'must-not-render' },
        time: { start: 1 },
      },
      summary: 'bash · running',
    },
    {
      status: 'error',
      state: {
        status: 'error',
        input: { command: 'npm test' },
        error: 'private upstream failure detail',
        metadata: { credential: 'must-not-render' },
        time: { start: 1, end: 2 },
      },
      summary: 'bash · failed',
    },
  ];

  for (const { status, state, summary } of cases) {
    const entry = toTranscriptEntry({
      info: assistantInfo(`msg-tool-${status}`),
      parts: [{
        id: `part-tool-${status}`,
        messageID: `msg-tool-${status}`,
        sessionID: 'ses-tool-display',
        type: 'tool',
        tool: 'bash',
        callID: `call-${status}`,
        state,
      }],
    });

    assert.equal(isTranscriptDisplayMessage(entry), true);
    assert.deepEqual(summarizeTranscriptDetails(entry.details), [summary]);
    assert.doesNotMatch(
      JSON.stringify(summarizeTranscriptDetails(entry.details)),
      /unsafe|credential|upstream failure|npm test|pwd/i,
    );
  }
});

test('assistant reasoning and pending tool internals remain hidden', () => {
  const reasoningOnly = toTranscriptEntry({
    info: assistantInfo('msg-reasoning'),
    parts: [{
      id: 'part-reasoning',
      messageID: 'msg-reasoning',
      sessionID: 'ses-tool-display',
      type: 'reasoning',
      text: 'private chain of thought',
      time: { start: 1, end: 2 },
    }],
  });
  const pendingTool = toTranscriptEntry({
    info: assistantInfo('msg-pending-tool'),
    parts: [{
      id: 'part-pending-tool',
      messageID: 'msg-pending-tool',
      sessionID: 'ses-tool-display',
      type: 'tool',
      tool: 'bash',
      callID: 'call-pending',
      state: {
        status: 'pending',
        input: { command: 'private pending command' },
        raw: 'private pending command',
      },
    }],
  });

  assert.equal(isTranscriptDisplayMessage(reasoningOnly), false);
  assert.equal(isTranscriptDisplayMessage(pendingTool), false);
  assert.deepEqual(summarizeTranscriptDetails(reasoningOnly.details), []);
  assert.deepEqual(summarizeTranscriptDetails(pendingTool.details), []);
});
