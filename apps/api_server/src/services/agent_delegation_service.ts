import { AppError } from '../errors/app_error';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { run as runAgent } from './agent_runner';

export interface AgentDelegationInput {
  callerAgentConfigId?: string | null;
  targetAgentConfigId: string;
  prompt: string;
  callerSessionId: string;
  context?: string | null;
  cwd?: string | null;
}

export interface AgentDelegationResult {
  sessionId: string;
  output: string;
  targetAgentConfigId: string;
}

/**
 * Maximum delegation nesting depth for the Secretary → orchestrator → specialist chain.
 *
 * Depth semantics: root sessions are stored at depth 0. Each delegation derives
 * the child depth from the caller session row (`caller.delegationDepth + 1`).
 * Stored child depth may be 1 or 2; a request that would create depth 3 is
 * rejected.
 *
 * Design decision (2026-06-25, issue #742):
 *   The intended 3-level chain is Secretary (manager, depth=0) →
 *   workflow-orchestrator (manager-capable delegate, depth=1) →
 *   specialist (depth=2). The old cap of 1 blocked the orchestrator from
 *   sub-delegating because it was already a child (depth=1 ≥ 1).
 *
 *   Raising to 2 enables one additional level. The manager-role check
 *   (`caller.isManager`) at each delegation node ensures only explicitly
 *   designated manager profiles can delegate — a random specialist cannot
 *   use this path even at depth=1. The combined constraint (isManager +
 *   allowedDelegatesJson + child depth <= 2) is the hard cap against runaway
 *   nesting.
 *
 *   See docs/ai/decisions/2026-06-25-delegation-depth.md for full rationale.
 */
const MAX_DELEGATION_DEPTH = 2;

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
  const claimedCallerId = input.callerAgentConfigId?.trim();
  const callerSessionId = input.callerSessionId?.trim();
  const targetId = input.targetAgentConfigId?.trim();
  const prompt = input.prompt?.trim();

  if (!callerSessionId) throw AppError.badRequest('callerSessionId is required');
  if (!targetId) throw AppError.badRequest('targetAgentConfigId is required');
  if (!prompt) throw AppError.badRequest('prompt is required');

  const sessionRepo = new AgentSessionsRepository();
  const callerSession = sessionRepo.findById(callerSessionId);
  if (!callerSession) throw AppError.badRequest('caller session not found');

  const callerId = (callerSession.mcpRole ?? callerSession.agentKind)?.trim();
  if (!callerId) throw AppError.forbidden('caller session has no agent profile');
  if (claimedCallerId && claimedCallerId !== callerId) {
    throw AppError.forbidden('callerAgentConfigId does not match caller session');
  }

  if (callerId === targetId) throw AppError.badRequest('self-delegation is not allowed');
  const childDepth = callerSession.delegationDepth + 1;
  if (childDepth > MAX_DELEGATION_DEPTH) {
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
    ownerUserId: callerSession.ownerUserId,
    delegationDepth: childDepth,
  });

  if (result.status !== 'done') {
    throw AppError.internal(result.error ?? 'delegated run did not complete');
  }

  return {
    sessionId: result.sessionId,
    output: result.result,
    targetAgentConfigId: targetId,
  };
}
