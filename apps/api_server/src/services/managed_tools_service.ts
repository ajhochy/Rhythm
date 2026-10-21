import type { AgentConfig } from '../repositories/agent_configs_repository';
import { AgentConfigsRepository, agentConfigExecutionBlockReason } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { AgentSession } from '../models/agent_session';
import type { VerifiedTrustedMcpCall } from '../security/trusted_mcp_call';
import { AppError } from '../errors/app_error';
import { isToolAllowed } from './mcp_dispatch_guard';
import type { ManagedActiveToolCall } from './opencode_client_service';
import { opencodeClient } from './opencode_engine';
import { inspectActivatedManagedToolAsync, type ActivatedManagedTool } from './tool_install_apply';
import { invokeManagedToolDockerAsync, validateManagedToolArguments } from './managed_tool_execution';

export const MANAGED_TOOLS_LIST = 'rhythm_list_managed_tools';
export const MANAGED_TOOLS_RUN = 'rhythm_run_managed_tool';
export interface ManagedToolDescriptor { proposalId: string; toolName: string; artifactDigest: string; execution: 'offline-container' }
let activeExecutions = 0;

interface ManagedToolsDependencies {
  session?(sdkSessionId: string): AgentSession | null;
  profile?(id: string): AgentConfig | null;
  proposals?(): Promise<AgentOrgProposal[]>;
  active?(sdkSessionId: string, turnId: string, toolCallId: string, cwd: string): Promise<ManagedActiveToolCall | null>;
  inspect?(proposal: AgentOrgProposal, profileId: string): Promise<ActivatedManagedTool | null>;
  invoke?: typeof invokeManagedToolDockerAsync;
}

/** This is the production discovery/execution path. Neither a tool name nor
 * a model-supplied profile id can select another agent's installation. */
export class ManagedToolsService {
  constructor(private readonly deps: ManagedToolsDependencies = {}) {}

  private async authorize(call: VerifiedTrustedMcpCall, ownerUserId: number, toolName: string) {
    const session = this.deps.session?.(call.context.sdkSessionId) ??
      (this.deps.session ? null : new AgentSessionsRepository().findBySdkSessionId(call.context.sdkSessionId));
    if (!session || !session.profileId || session.ownerUserId !== ownerUserId ||
        !['working', 'idle'].includes(session.status) || call.context.agentName !== session.opencodeAgentId ||
        !isToolAllowed(`mcp__rhythm__${toolName}`, session.mcpAllowedToolsJson))
      throw AppError.forbidden('Managed tools are unavailable in this agent scope');
    const profile = this.deps.profile?.(session.profileId) ??
      (this.deps.profile ? null : new AgentConfigsRepository().getById(session.profileId));
    if (!profile || agentConfigExecutionBlockReason(profile) !== null ||
        !isToolAllowed(`mcp__rhythm__${toolName}`, profile.allowedMcpsJson))
      throw AppError.forbidden('Managed tools are unavailable in this agent scope');
    const active = await (this.deps.active ?? ((...args) => opencodeClient.getCurrentTrustedMcpToolCall(...args)))(
      call.context.sdkSessionId, call.context.turnId, call.context.toolCallId, session.cwd);
    if (!active || active.sdkSessionId !== call.context.sdkSessionId || active.assistantId !== call.context.turnId ||
        active.toolCallId !== call.context.toolCallId || active.agentName !== call.context.agentName ||
        active.serverName !== 'rhythm' || active.toolName !== toolName)
      throw AppError.forbidden('A current signed agent tool call is required');
    return { session, profile };
  }

  private async installed(profileId: string, ownerUserId: number): Promise<ActivatedManagedTool[]> {
    const proposals = this.deps.proposals ? await this.deps.proposals() :
      (await Promise.all(['applied', 'measuring', 'active'].map(status =>
        new AgentOrgProposalsRepository().listByStatusAsync(status)))).flat();
    const result: ActivatedManagedTool[] = [];
    for (const proposal of proposals) {
      if (proposal.kind !== 'tool-install' || proposal.ownerUserId !== ownerUserId ||
          proposal.targetRef !== `agent_config:${profileId}`) continue;
      const installed = await (this.deps.inspect ?? inspectActivatedManagedToolAsync)(proposal, profileId);
      if (installed) result.push(installed);
    }
    return result;
  }

  async listForCallAsync(call: VerifiedTrustedMcpCall, ownerUserId: number): Promise<{ tools: ManagedToolDescriptor[] }> {
    if (Object.keys(call.arguments).length) throw AppError.badRequest('Managed tool list takes no arguments');
    const { profile } = await this.authorize(call, ownerUserId, MANAGED_TOOLS_LIST);
    const installed = await this.installed(profile.id, ownerUserId);
    await this.authorize(call, ownerUserId, MANAGED_TOOLS_LIST);
    return { tools: installed.map(({ proposalId, toolName, artifactDigest }) =>
      ({ proposalId, toolName, artifactDigest, execution: 'offline-container' })) };
  }

  async runForCallAsync(call: VerifiedTrustedMcpCall, ownerUserId: number) {
    if (Object.keys(call.arguments).some(key => !['proposalId', 'argv', 'stdin'].includes(key)) ||
        typeof call.arguments.proposalId !== 'string' || call.arguments.proposalId.length > 200)
      throw AppError.badRequest('Invalid managed tool invocation');
    let args;
    try { args = validateManagedToolArguments({ argv: call.arguments.argv,
      ...(call.arguments.stdin === undefined ? {} : { stdin: call.arguments.stdin }) }); }
    catch { throw AppError.badRequest('Invalid managed tool invocation'); }
    const { profile } = await this.authorize(call, ownerUserId, MANAGED_TOOLS_RUN);
    const installed = (await this.installed(profile.id, ownerUserId)).find(tool => tool.proposalId === call.arguments.proposalId);
    if (!installed) throw AppError.forbidden('Approved tool installation is unavailable for this agent');
    await this.authorize(call, ownerUserId, MANAGED_TOOLS_RUN);
    if (activeExecutions >= 2) throw AppError.conflict('Managed tool execution capacity is busy');
    activeExecutions++;
    try {
      const result = await (this.deps.invoke ?? invokeManagedToolDockerAsync)(installed, args);
      await this.authorize(call, ownerUserId, MANAGED_TOOLS_RUN);
      const current = (await this.installed(profile.id, ownerUserId)).find(tool => tool.proposalId === installed.proposalId);
      if (!current || current.artifactDigest !== installed.artifactDigest)
        throw AppError.forbidden('Tool approval changed during execution');
      return { proposalId: installed.proposalId, toolName: installed.toolName, ...result };
    } finally { activeExecutions--; }
  }
}
