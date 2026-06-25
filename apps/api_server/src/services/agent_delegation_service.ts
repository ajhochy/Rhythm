import { AppError } from '../errors/app_error';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { run as runAgent } from './agent_runner';

export interface AgentDelegationInput {
  callerAgentConfigId: string;
  targetAgentConfigId: string;
  prompt: string;
  callerSessionId?: string | null;
  depth?: number;
  context?: string | null;
  cwd?: string | null;
  ownerUserId?: number | null;
}

export interface AgentDelegationResult {
  sessionId: string;
  output: string;
  targetAgentConfigId: string;
}

const MAX_DELEGATION_DEPTH = 1;

function parseAllowedDelegates(json: string | null): Set<string> {
  if (!json) return new Set();
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === 'string' && value.trim() !== ''),
    );
  } catch {
    return new Set();
  }
}

export async function delegateToAgent(
  input: AgentDelegationInput,
): Promise<AgentDelegationResult> {
  const callerId = input.callerAgentConfigId?.trim();
  const targetId = input.targetAgentConfigId?.trim();
  const prompt = input.prompt?.trim();
  const depth = input.depth ?? 0;

  if (!callerId) throw AppError.badRequest('callerAgentConfigId is required');
  if (!targetId) throw AppError.badRequest('targetAgentConfigId is required');
  if (!prompt) throw AppError.badRequest('prompt is required');
  if (callerId === targetId) throw AppError.badRequest('self-delegation is not allowed');
  if (depth >= MAX_DELEGATION_DEPTH) {
    throw AppError.badRequest('delegation depth limit exceeded');
  }

  const repo = new AgentConfigsRepository();
  const caller = repo.getById(callerId);
  if (!caller || !caller.isManager) {
    throw AppError.forbidden('caller profile is not allowed to delegate');
  }

  const allowed = parseAllowedDelegates(caller.allowedDelegatesJson);
  if (!allowed.has(targetId)) {
    throw AppError.forbidden('target profile is not an allowed delegate');
  }

  const target = repo.getById(targetId);
  if (!target || !target.enabled || !target.isAgent) {
    throw AppError.badRequest('target profile is not runnable');
  }

  const scopedPrompt = input.context ? `${input.context.trim()}\n\n${prompt}` : prompt;
  const result = await runAgent({
    prompt: scopedPrompt,
    agentConfigId: targetId,
    agentKind: targetId,
    sessionName: `Delegated: ${target.label}`,
    outputTarget: 'session',
    cwd: input.cwd ?? undefined,
    ownerUserId: input.ownerUserId ?? null,
  });

  if (result.status !== 'done') {
    throw AppError.internal('delegated run did not complete');
  }

  return {
    sessionId: result.sessionId,
    output: result.result,
    targetAgentConfigId: targetId,
  };
}
