/**
 * W3 FINAL ARCHITECTURAL CORRECTIVE — dedicated regression suite for the ONE
 * shared strict producer-compatibility parser (`persisted_tool_evidence.ts`)
 * that both `workflow_failure_signal_extractor.ts` (retry-loop detection) and
 * `org_proposal_measure.ts` (rerun/keep-revert measurement) must consume.
 *
 * Every case here is asserted directly against `parsePersistedToolEvidence`
 * — no mocking of the parser itself — so a regression in either downstream
 * consumer's OWN validation can never mask a gap here again.
 */
import { describe, it, expect } from 'vitest';
import {
  parsePersistedToolEvidence,
  isTerminalSuccess,
  type PersistedMessageLike,
} from '../persisted_tool_evidence';

function message(sdkMessageId: string | null, parts: unknown[]): PersistedMessageLike {
  return { sdkMessageId, partsJson: JSON.stringify(parts) };
}

const VALID_COMPLETED_STATE = {
  status: 'completed',
  input: { cmd: 'npm test' },
  output: 'ok',
  title: 'Tool result',
  metadata: {},
  time: { start: 0, end: 1 },
};

function validTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prt-1',
    type: 'tool',
    sessionID: 'ses-abc',
    messageID: 'msg-1',
    callID: 'call-1',
    tool: 'bash',
    state: VALID_COMPLETED_STATE,
    ...overrides,
  };
}

describe('parsePersistedToolEvidence — producer-valid fixture accepted', () => {
  it('accepts a fully producer-valid tool part as a terminal success', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool()])]);
    expect(result.integrity).toBe('valid');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts.some(isTerminalSuccess)).toBe(true);
  });

  it('ignores non-tool parts entirely', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [{ id: 'prt-2', type: 'text', sessionID: 'ses-abc', messageID: 'msg-1', text: 'hello' }]),
    ]);
    expect(result.integrity).toBe('valid');
    expect(result.attempts).toHaveLength(0);
  });
});

describe('parsePersistedToolEvidence — identity regressions', () => {
  it('rejects a part with no sessionID at all', () => {
    const { sessionID: _drop, ...withoutSessionId } = validTool();
    const result = parsePersistedToolEvidence([message('msg-1', [withoutSessionId])]);
    expect(result.integrity).toBe('invalid');
    expect(result.attempts).toHaveLength(0);
  });

  it('rejects a part with no messageID at all', () => {
    const { messageID: _drop, ...withoutMessageId } = validTool();
    const result = parsePersistedToolEvidence([message('msg-1', [withoutMessageId])]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects a part id with the wrong prefix', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ id: 'xyz-1' })])]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects a sessionID with the wrong prefix', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ sessionID: 'sid-abc' })])]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects a messageID with the wrong prefix', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ messageID: 'message-1' })])]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects when raw.messageID does not equal the persisted row sdkMessageId', () => {
    const result = parsePersistedToolEvidence([message('msg-real', [validTool({ messageID: 'msg-different' })])]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects when the row has no sdkMessageId at all (null)', () => {
    const result = parsePersistedToolEvidence([message(null, [validTool()])]);
    expect(result.integrity).toBe('invalid');
  });

  it('never compares raw.sessionID to the Rhythm local session UUID — a structurally valid but DIFFERENT "ses..." value is accepted', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ sessionID: 'ses-completely-different-engine-session' })])]);
    expect(result.integrity).toBe('valid');
    expect(result.attempts).toHaveLength(1);
  });

  it('rejects an empty callID even though it is technically a string', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ callID: '' })])]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects an empty tool name even though it is technically a string', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ tool: '' })])]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects non-record tool-part metadata', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ metadata: 'not-a-record' })])]);
    expect(result.integrity).toBe('invalid');
  });

  it('accepts plain-record tool-part metadata', () => {
    const result = parsePersistedToolEvidence([message('msg-1', [validTool({ metadata: { providerExecuted: true } })])]);
    expect(result.integrity).toBe('valid');
  });
});

describe('parsePersistedToolEvidence — duplicate/ambiguous identity', () => {
  it('two distinct calls sharing one part ID => integrity invalid, no attempts', () => {
    const callA = validTool({ id: 'prt-shared', callID: 'call-a' });
    const callB = validTool({ id: 'prt-shared', callID: 'call-b', messageID: 'msg-2' });
    const result = parsePersistedToolEvidence([message('msg-1', [callA]), message('msg-2', [callB])]);
    expect(result.integrity).toBe('invalid');
    expect(result.attempts).toHaveLength(0);
  });

  it('an exact duplicate record of the SAME call (different part id, different message row) collapses to one attempt', () => {
    const first = validTool({ id: 'prt-a', messageID: 'msg-1' });
    const second = validTool({ id: 'prt-b', messageID: 'msg-2' });
    const result = parsePersistedToolEvidence([message('msg-1', [first]), message('msg-2', [second])]);
    expect(result.integrity).toBe('valid');
    expect(result.attempts).toHaveLength(1);
  });

  it('conflicting records sharing one callID are invalid, never resolved by persistence order', () => {
    const first = validTool({ id: 'prt-a', messageID: 'msg-1', state: VALID_COMPLETED_STATE });
    const second = validTool({
      id: 'prt-b',
      messageID: 'msg-2',
      state: { ...VALID_COMPLETED_STATE, time: { start: 100, end: 200 } }, // different timing for the SAME call
    });
    const orderA = parsePersistedToolEvidence([message('msg-1', [first]), message('msg-2', [second])]);
    const orderB = parsePersistedToolEvidence([message('msg-2', [second]), message('msg-1', [first])]);
    expect(orderA.integrity).toBe('invalid');
    expect(orderB.integrity).toBe('invalid');
  });
});

describe('parsePersistedToolEvidence — full state-shape validation', () => {
  it('rejects mcpResult._meta that is not a plain record', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [validTool({ state: { ...VALID_COMPLETED_STATE, mcpResult: { _meta: 'not-a-record' } } })]),
    ]);
    expect(result.integrity).toBe('invalid');
  });

  it('accepts a plain-record mcpResult._meta', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [validTool({ state: { ...VALID_COMPLETED_STATE, mcpResult: { _meta: { key: 'value' } } } })]),
    ]);
    expect(result.integrity).toBe('valid');
  });

  it('rejects time.compacted = -1 (must be a non-negative integer)', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [validTool({ state: { ...VALID_COMPLETED_STATE, time: { start: 0, end: 1, compacted: -1 } } })]),
    ]);
    expect(result.integrity).toBe('invalid');
  });

  it('accepts a valid non-negative time.compacted', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [validTool({ state: { ...VALID_COMPLETED_STATE, time: { start: 0, end: 1, compacted: 0 } } })]),
    ]);
    expect(result.integrity).toBe('valid');
  });

  it('rejects a malformed mcpAppResource (missing required string field)', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [
        validTool({
          state: {
            ...VALID_COMPLETED_STATE,
            mcpAppResource: {
              sessionID: 'x', callID: 'y', serverName: 'z', cwd: '/tmp', resourceUri: 'uri', advertisedAt: 'now',
              // expiresAt missing
            },
          },
        }),
      ]),
    ]);
    expect(result.integrity).toBe('invalid');
  });

  it('accepts a fully valid mcpAppResource', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [
        validTool({
          state: {
            ...VALID_COMPLETED_STATE,
            mcpAppResource: {
              sessionID: 'x', callID: 'y', serverName: 'z', cwd: '/tmp',
              resourceUri: 'uri', advertisedAt: 'now', expiresAt: 'later',
            },
          },
        }),
      ]),
    ]);
    expect(result.integrity).toBe('valid');
  });

  it('rejects a malformed attachment (missing producer identity)', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [
        validTool({
          state: {
            ...VALID_COMPLETED_STATE,
            attachments: [{ id: 'not-prefixed', sessionID: 'ses-x', messageID: 'msg-1', type: 'file', mime: 'text/plain', url: 'file:///x' }],
          },
        }),
      ]),
    ]);
    expect(result.integrity).toBe('invalid');
  });

  it('rejects a malformed attachment FilePartSource (symbol source missing range)', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [
        validTool({
          state: {
            ...VALID_COMPLETED_STATE,
            attachments: [
              {
                id: 'prt-file-1', sessionID: 'ses-x', messageID: 'msg-1', type: 'file', mime: 'text/plain', url: 'file:///x',
                source: { type: 'symbol', text: { value: 'x', start: 0, end: 1 }, path: '/a.ts', name: 'foo' /* kind, range missing */ },
              },
            ],
          },
        }),
      ]),
    ]);
    expect(result.integrity).toBe('invalid');
  });

  it('accepts a valid attachment with each FilePartSource variant', () => {
    const fileSource = { type: 'file', text: { value: 'x', start: 0, end: 1 }, path: '/a.ts' };
    const symbolSource = {
      type: 'symbol', text: { value: 'x', start: 0, end: 1 }, path: '/a.ts', name: 'foo', kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
    };
    const resourceSource = { type: 'resource', text: { value: 'x', start: 0, end: 1 }, clientName: 'client', uri: 'res://x' };
    for (const source of [fileSource, symbolSource, resourceSource]) {
      const result = parsePersistedToolEvidence([
        message('msg-1', [
          validTool({
            state: {
              ...VALID_COMPLETED_STATE,
              attachments: [
                { id: 'prt-file-1', sessionID: 'ses-x', messageID: 'msg-1', type: 'file', mime: 'text/plain', url: 'file:///x', source },
              ],
            },
          }),
        ]),
      ]);
      expect(result.integrity).toBe('valid');
    }
  });

  it('a completed state with mcpResult.isError===true is not a terminal success', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [validTool({ state: { ...VALID_COMPLETED_STATE, mcpResult: { isError: true } } })]),
    ]);
    expect(result.integrity).toBe('valid');
    expect(result.attempts.some(isTerminalSuccess)).toBe(false);
  });

  it('a completed state with mcpResult.isError===false IS a terminal success', () => {
    const result = parsePersistedToolEvidence([
      message('msg-1', [validTool({ state: { ...VALID_COMPLETED_STATE, mcpResult: { isError: false } } })]),
    ]);
    expect(result.attempts.some(isTerminalSuccess)).toBe(true);
  });

  it('pending/running/error attempts are never terminal success', () => {
    const pending = validTool({ id: 'prt-p', callID: 'call-p', state: { status: 'pending', input: {}, raw: 'x' } });
    const running = validTool({ id: 'prt-r', callID: 'call-r', state: { status: 'running', input: {}, time: { start: 0 } } });
    const errored = validTool({ id: 'prt-e', callID: 'call-e', state: { status: 'error', input: {}, error: 'boom', time: { start: 0, end: 1 } } });
    const result = parsePersistedToolEvidence([message('msg-1', [pending, running, errored])]);
    expect(result.integrity).toBe('valid');
    expect(result.attempts.some(isTerminalSuccess)).toBe(false);
    expect(result.attempts).toHaveLength(3);
  });
});
