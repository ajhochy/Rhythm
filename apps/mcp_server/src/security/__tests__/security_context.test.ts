import { describe, expect, it } from 'vitest';
import {
  RHYTHM_SECURITY_CONTEXT_META_KEY,
  trustedSecurityContext,
} from '../security_context.js';

describe('#1134 trusted MCP security context', () => {
  it('accepts only the engine-owned request metadata shape', () => {
    const context = {
      sdkSessionId: 'sdk-one',
      turnId: 'turn-one',
      agentName: 'email-assistant',
      toolCallId: 'call-one',
    };
    expect(
      trustedSecurityContext({
        _meta: { [RHYTHM_SECURITY_CONTEXT_META_KEY]: context },
      }),
    ).toEqual(context);
    expect(trustedSecurityContext(undefined)).toBeNull();
    expect(
      trustedSecurityContext({
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
            ...context,
            sdkSessionId: '',
          },
        },
      }),
    ).toBeNull();
  });
});
