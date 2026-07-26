import { describe, expect, it, vi } from 'vitest';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { registerCreativePlatformTools } from '../creativePlatform.js';

describe('registerCreativePlatformTools', () => {
  it('uses only the local creative-platform API surface', async () => {
    const tools = new Map<
      string,
      {
        handler: (
          input: Record<string, unknown>,
          extra?: unknown,
        ) => Promise<{ content: Array<{ text: string }> }>;
      }
    >();
    const server = {
      tool: (
        name: string,
        _description: string,
        _shape: unknown,
        handler: (
          input: Record<string, unknown>,
          extra?: unknown,
        ) => Promise<{ content: Array<{ text: string }> }>,
      ) => tools.set(name, { handler }),
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith('/agent-approvals/consume')
          ? { allowed: true, consumed: false }
          : [{ id: 'openmontage' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const extra = {
      _meta: {
        [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
          sdkSessionId: 'sdk-creative-test',
          turnId: 'turn-creative-test',
          agentName: 'creative-media',
          toolCallId: 'call-creative-test',
          proof: {
            version: 1,
            algorithm: 'Ed25519',
            keyId: 'key-creative-test',
            issuedAt: Date.now(),
            nonce: 'nonce-creative-test',
            toolName: 'rhythm_install_creative_capability',
            argumentsHash: 'hash-creative-test',
            signature: 'signature-creative-test',
          },
        },
      },
    };
    registerCreativePlatformTools(server as never, 'http://localhost:4098');
    await tools.get('rhythm_install_creative_capability')!.handler({ id: 'openmontage' }, extra);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4098/agent-approvals/consume',
      expect.objectContaining({
        body: expect.stringContaining('"action":"creative-capability.install"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4098/creative-platform/openmontage/request-or-start',
      expect.objectContaining({ method: 'POST' }),
    );
    const installRequest = fetchMock.mock.calls.find(
      ([url]) => url === 'http://localhost:4098/creative-platform/openmontage/request-or-start',
    )?.[1] as RequestInit;
    expect(JSON.parse(installRequest.body as string)).toMatchObject({
      trustedCall: {
        context: {
          sdkSessionId: 'sdk-creative-test',
          turnId: 'turn-creative-test',
          agentName: 'creative-media',
          toolCallId: 'call-creative-test',
        },
        proof: {
          toolName: 'rhythm_install_creative_capability',
        },
        arguments: {
          id: 'openmontage',
        },
      },
    });
    expect(JSON.parse(installRequest.body as string)).not.toHaveProperty('sessionId');
    await tools.get('rhythm_record_design')!.handler(
      {
        title: 'Sunday slide',
        provider: 'comfyui',
        artifactUrl: 'https://example.test/slide.png',
        projectUrl: 'https://example.test/workflow',
      },
      extra,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4098/agent-approvals/consume',
      expect.objectContaining({
        body: expect.stringContaining('"action":"creative-artifact.record"'),
      }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:4098/agent-designs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(
      JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string),
    ).not.toHaveProperty('userApprovedPath');
    expect([...tools]).toHaveLength(5);
    vi.unstubAllGlobals();
  });
});
