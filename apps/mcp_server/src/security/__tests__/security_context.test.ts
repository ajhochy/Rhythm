import { describe, expect, it } from 'vitest';
import {
  RHYTHM_SECURITY_CONTEXT_META_KEY,
  trustedSecurityCall,
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
    const proof = {
      version: 1 as const,
      algorithm: 'Ed25519' as const,
      keyId: 'key-one',
      issuedAt: Date.now(),
      nonce: 'nonce-one',
      toolName: 'rhythm_install_creative_capability',
      argumentsHash: 'arguments-hash',
      signature: 'signature-one',
    };
    expect(
      trustedSecurityContext({
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: { ...context, proof },
        },
      }),
    ).toEqual(context);
    expect(
      trustedSecurityCall({
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: { ...context, proof },
        },
      }),
    ).toEqual({ context, proof });
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
