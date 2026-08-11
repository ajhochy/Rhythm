import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { McpAppCapabilityBroker } from '../services/mcp_app_capability_broker';

const binding = {
  sessionId: 'session',
  callId: 'origin-call',
  serverName: 'origin',
  resourceUri: 'ui://origin/view',
  mode: 'interactive' as const,
  contentHash: `sha256:${'a'.repeat(64)}`,
};

describe('issue #1357 API execution broker', () => {
  it('issue-1357-c6: proof stays server-side and result reaches only the consuming correlation', async () => {
    const broker = new McpAppCapabilityBroker({
      now: () => 1_000,
      randomId: () => 'view-capability',
    });
    const issued = broker.issue({
      ...binding,
      expiresAt: 2_000,
      engineProof: 'engine-proof-never-disclosed',
    });
    expect(JSON.stringify(issued)).not.toContain('engine-proof');

    const request = {
      capabilityId: issued.id,
      binding,
      correlationId: 'origin-view-request',
      payload: { method: 'tools/call', params: { name: 'origin_do', arguments: {} } },
    };
    const response = await broker.consume(request, async (_incoming, authority) => {
      expect(authority.engineProof).toBe('engine-proof-never-disclosed');
      return { structuredContent: { ok: true } };
    });
    expect(response).toEqual({ structuredContent: { ok: true } });
    await expect(broker.consume(request, async () => 'replayed')).rejects.toThrow(
      'capability_denied',
    );
  });

  it('uses the generated v2 SDK and never sends an engine proof to Flutter', () => {
    const root = resolve(__dirname, '../..');
    const service = readFileSync(resolve(root, 'src/services/opencode_client_service.ts'), 'utf8');
    const controller = readFileSync(resolve(root, 'src/controllers/agent_sessions_controller.ts'), 'utf8');
    const flutter = readFileSync(
      resolve(root, '../desktop_flutter/lib/features/agents/data/agents_data_source.dart'),
      'utf8',
    );
    const generated = readFileSync(
      resolve(root, 'vendor/opencode-ai-sdk/v2/gen/sdk.gen.d.ts'),
      'utf8',
    );
    expect(service).toContain('client.session.mcpAppExecutionProof');
    expect(service).toContain('client.session.mcpAppExecution');
    expect(generated).toContain('mcpAppExecutionProof');
    expect(generated).toContain('mcpAppExecution');
    expect(controller).toContain('engineProof: engineProof.proof');
    expect(flutter).not.toContain('engineProof');
  });
});

