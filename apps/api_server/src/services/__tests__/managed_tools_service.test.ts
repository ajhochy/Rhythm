import { describe, expect, it } from 'vitest';
import type { AgentSession } from '../../models/agent_session';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import type { AgentConfig } from '../../repositories/agent_configs_repository';
import type { VerifiedTrustedMcpCall } from '../../security/trusted_mcp_call';
import type { ManagedActiveToolCall } from '../opencode_client_service';
import { MANAGED_TOOLS_LIST, MANAGED_TOOLS_RUN, ManagedToolsService } from '../managed_tools_service';

function fixture(toolName = MANAGED_TOOLS_LIST) {
  const call: VerifiedTrustedMcpCall = { context: { sdkSessionId: 'sdk-owned', turnId: 'turn-owned',
    toolCallId: 'call-owned', agentName: 'owned-agent' }, arguments: {} };
  const session = { sdkSessionId: 'sdk-owned', profileId: 'owned-profile', opencodeAgentId: 'owned-agent',
    ownerUserId: 7, status: 'working', cwd: '/private/tmp/owned', mcpAllowedToolsJson: '{"rhythm":[]}' } as AgentSession;
  const profile = { id: 'owned-profile', enabled: true, allowedMcpsJson: '{"rhythm":[]}' } as AgentConfig;
  const proposal = { id: 'applied-tool', ownerUserId: 7, targetRef: 'agent_config:owned-profile',
    kind: 'tool-install', status: 'applied' } as AgentOrgProposal;
  const active = { sdkSessionId: 'sdk-owned', assistantId: 'turn-owned', toolCallId: 'call-owned',
    agentName: 'owned-agent', serverName: 'rhythm', toolName } as ManagedActiveToolCall;
  let invoked = 0;
  const service = new ManagedToolsService({ session: () => session, profile: () => profile, active: async () => active,
    proposals: async () => [proposal], inspect: async () => ({ proposalId: 'applied-tool', agentConfigId: 'owned-profile',
      toolName: 'fixture-tool', artifactDigest: 'a'.repeat(64), artifactPath: '/not-returned/artifact.tgz' }),
    invoke: async (_tool, args) => { invoked++; return { output: JSON.stringify(args), outputHash: 'b'.repeat(64),
      artifactDigest: 'a'.repeat(64), networkMode: 'none', forbiddenArtifactWriteDenied: true }; },
  });
  return { service, call, session, profile, proposal, active, invoked: () => invoked };
}

describe('production managed tool agent boundary', () => {
  it('returns only approved agent descriptors and never exposes host paths', async () => {
    const f = fixture();
    expect(await f.service.listForCallAsync(f.call, 7)).toEqual({ tools: [{ proposalId: 'applied-tool',
      toolName: 'fixture-tool', artifactDigest: 'a'.repeat(64), execution: 'offline-container' }] });
    f.proposal.ownerUserId = 8;
    expect(await f.service.listForCallAsync(f.call, 7)).toEqual({ tools: [] });
    f.proposal.ownerUserId = 7; f.proposal.targetRef = 'agent_config:someone-else';
    expect(await f.service.listForCallAsync(f.call, 7)).toEqual({ tools: [] });
  });
  it('rejects wrong owner, wrong agent, inactive signed call, and denied live profile or session', async () => {
    const f = fixture();
    await expect(f.service.listForCallAsync(f.call, 8)).rejects.toThrow();
    f.call.context.agentName = 'someone-else';
    await expect(f.service.listForCallAsync(f.call, 7)).rejects.toThrow();
    f.call.context.agentName = 'owned-agent'; f.active.toolCallId = 'different-call';
    await expect(f.service.listForCallAsync(f.call, 7)).rejects.toThrow();
    f.active.toolCallId = 'call-owned'; f.profile.allowedMcpsJson = '{}';
    await expect(f.service.listForCallAsync(f.call, 7)).rejects.toThrow();
    f.profile.allowedMcpsJson = '{"rhythm":[]}'; f.session.mcpAllowedToolsJson = '{}';
    await expect(f.service.listForCallAsync(f.call, 7)).rejects.toThrow();
  });
  it('runs only a listed proposal with literal bounded arguments and refuses model-supplied profile/env', async () => {
    const f = fixture(MANAGED_TOOLS_RUN);
    f.call.arguments = { proposalId: 'applied-tool', argv: ['--version'] };
    expect(await f.service.runForCallAsync(f.call, 7)).toMatchObject({ toolName: 'fixture-tool', networkMode: 'none' });
    expect(f.invoked()).toBe(1);
    for (const args of [{ proposalId: 'foreign-tool', argv: [] },
      { proposalId: 'applied-tool', argv: [], profileId: 'foreign' },
      { proposalId: 'applied-tool', argv: [], env: { HOST_TOKEN: 'x' } }]) {
      f.call.arguments = args;
      await expect(f.service.runForCallAsync(f.call, 7)).rejects.toThrow();
    }
    expect(f.invoked()).toBe(1);
  });
  it('rechecks a revoked permission after asynchronous installation discovery before execution', async () => {
    const f = fixture(MANAGED_TOOLS_RUN);
    f.call.arguments = { proposalId: 'applied-tool', argv: [] };
    let reads = 0;
    const oldId = f.active.toolCallId;
    Object.defineProperty(f.active, 'toolCallId', { get: () => ++reads > 1 ? 'revoked' : oldId });
    await expect(f.service.runForCallAsync(f.call, 7)).rejects.toThrow();
    expect(f.invoked()).toBe(0);
  });
  it('keeps a security-locked profile inert even if a stale writer leaves enabled true', async () => {
    const f = fixture(MANAGED_TOOLS_RUN);
    f.profile.locked = true; f.profile.enabled = true;
    f.call.arguments = { proposalId: 'applied-tool', argv: ['--version'] };
    await expect(f.service.runForCallAsync(f.call, 7)).rejects.toThrow();
    expect(f.invoked()).toBe(0);
  });
  it('withholds the result if the installation approval is revoked while the tool runs', async () => {
    const f = fixture(MANAGED_TOOLS_RUN);
    f.call.arguments = { proposalId: 'applied-tool', argv: ['--version'] };
    let reads = 0;
    Object.defineProperty(f.proposal, 'ownerUserId', { get: () => ++reads > 1 ? 8 : 7 });
    await expect(f.service.runForCallAsync(f.call, 7)).rejects.toThrow('Tool approval changed during execution');
    expect(f.invoked()).toBe(1);
  });
});
