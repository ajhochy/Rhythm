import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrustedMcpTestSigner } from '../__tests__/helpers/trusted_mcp_test_proof';
import {
  clearTrustedMcpVerifier,
  pinTrustedMcpPublicKey,
  verifyTrustedMcpCall,
} from './trusted_mcp_call';

const context = {
  sdkSessionId: 'sdk-security-test',
  turnId: 'turn-security-test',
  agentName: 'creative-media',
  toolCallId: 'call-security-test',
};
const toolName = 'rhythm_install_creative_capability';

describe('trusted MCP call verification', () => {
  afterEach(() => {
    clearTrustedMcpVerifier();
    vi.restoreAllMocks();
  });

  it('verifies the engine key, exact tool arguments, freshness, and one-time nonce', async () => {
    const signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    const call = signer.signCall(context, toolName, {
      id: 'openmontage',
      nested: { z: 1, a: true },
    });

    await expect(verifyTrustedMcpCall(call, toolName)).resolves.toEqual({
      context,
      arguments: {
        id: 'openmontage',
        nested: { z: 1, a: true },
      },
    });
    await expect(verifyTrustedMcpCall(call, toolName)).rejects.toThrow(
      /already consumed/i,
    );
  });

  it('rejects altered arguments, a swapped tool name, and expired proofs', async () => {
    const signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);

    const altered = signer.signCall(context, toolName, { id: 'openmontage' });
    altered.arguments.id = 'media-tools';
    await expect(verifyTrustedMcpCall(altered, toolName)).rejects.toThrow(
      /payload mismatch/i,
    );

    const swapped = signer.signCall(context, toolName, { id: 'openmontage' });
    await expect(
      verifyTrustedMcpCall(swapped, 'rhythm_record_design'),
    ).rejects.toThrow(/payload mismatch/i);

    const now = Date.now();
    const expired = signer.signCall(
      context,
      toolName,
      { id: 'openmontage' },
      now - 61_000,
    );
    await expect(verifyTrustedMcpCall(expired, toolName, now)).rejects.toThrow(
      /expired/i,
    );
  });

  it('never re-pins an attacker-selected key during request verification', async () => {
    const trustedSigner = createTrustedMcpTestSigner();
    const attackerSigner = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(trustedSigner.publicDocument);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(attackerSigner.publicDocument), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      verifyTrustedMcpCall(
        attackerSigner.signCall(context, toolName, { id: 'media-tools' }),
        toolName,
      ),
    ).rejects.toThrow(/engine key is unavailable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows one proof once per fixed server boundary and rejects replay within each boundary', async () => {
    const signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    const call = signer.signCall(context, toolName, { id: 'openmontage' });

    await expect(
      verifyTrustedMcpCall(call, toolName, Date.now(), 'approval-consume'),
    ).resolves.toMatchObject({ context });
    await expect(
      verifyTrustedMcpCall(call, toolName, Date.now(), 'approval-consume'),
    ).rejects.toThrow(/already consumed/i);

    await expect(
      verifyTrustedMcpCall(call, toolName, Date.now(), 'creative-install'),
    ).resolves.toMatchObject({ context });
    await expect(
      verifyTrustedMcpCall(call, toolName, Date.now(), 'creative-install'),
    ).rejects.toThrow(/already consumed/i);
  });
});
