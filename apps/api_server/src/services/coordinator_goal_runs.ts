import { execFileSync } from 'node:child_process';
import { getDb } from '../database/db';
import type {
  CoordinatorConversationScope,
  CoordinatorConversationsRepository,
} from '../repositories/coordinator_conversations_repository';
import { goalRepoPath } from './coordinator_goal_repo';

export type CoordinatorGoalRunStatus = 'running' | 'needs_you' | 'finished' | 'failed' | 'unknown';

export interface CoordinatorGoalRunUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

export interface CoordinatorGoalRun {
  goalId: string;
  objective: string;
  repoPath: string | null;
  delegationId: string | null;
  childSessionId: string | null;
  worktreePath: string | null;
  branch: string | null;
  status: CoordinatorGoalRunStatus;
  /** The completion wake was delivered into the coordinator chat. */
  reported: boolean;
  terminalAt: string | null;
  usage: CoordinatorGoalRunUsage;
}

export interface CoordinatorGoalRunPorts {
  /** Local session ids with an unanswered permission or question. */
  pendingSessionIds: ReadonlySet<string>;
  /** Live checked-out branch of a worktree, or null when unreadable. */
  gitBranch(directory: string): string | null;
}

export function liveGitBranch(directory: string): string | null {
  try {
    const branch = execFileSync('git', ['-C', directory, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Read model for the coordinator's coding runs: one row per dispatched goal,
 * joined to its async delegation, the run's session tree (orchestrator plus
 * every specialist it delegated to) and the engine-reported token usage.
 * Status is server fact only: a finished run is not a verified goal.
 */
export function listCoordinatorGoalRuns(
  repository: CoordinatorConversationsRepository,
  scope: CoordinatorConversationScope,
  ports: CoordinatorGoalRunPorts,
): CoordinatorGoalRun[] {
  const read = repository.get(scope);
  if (read.kind !== 'found') return [];
  const objectives = new Map(read.conversation.goals.map((goal) => [goal.id, goal.objective]));
  const db = getDb();
  const tree = db.prepare(`WITH RECURSIVE tree(id) AS (
      SELECT ? UNION SELECT s.id FROM agent_sessions s JOIN tree t ON s.parent_session_id = t.id
    ) SELECT id FROM tree`);
  const child = db.prepare('SELECT worktree_path, worktree_branch FROM agent_sessions WHERE id=?');
  const notified = db.prepare('SELECT notified_at FROM agent_async_delegations WHERE id=?');
  return repository.listGoalDelegationOutcomes(scope).map((outcome): CoordinatorGoalRun => {
    const objective = objectives.get(outcome.goalId) ?? '';
    const usage: CoordinatorGoalRunUsage = {
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0,
    };
    let sessionIds: string[] = [];
    let worktreePath: string | null = null;
    let branch: string | null = null;
    if (outcome.childSessionId) {
      sessionIds = (tree.all(outcome.childSessionId) as Array<{ id: string }>).map((row) => row.id);
      const rows = db.prepare(`SELECT tokens_json, cost FROM agent_session_messages
        WHERE tokens_json IS NOT NULL AND session_id IN (${sessionIds.map(() => '?').join(',')})`)
        .all(...sessionIds) as Array<{ tokens_json: string; cost: number | null }>;
      for (const row of rows) {
        let tokens: Record<string, unknown>;
        try {
          tokens = JSON.parse(row.tokens_json) as Record<string, unknown>;
        } catch {
          continue;
        }
        const cache = (tokens.cache ?? {}) as Record<string, unknown>;
        const input = count(tokens.input);
        const output = count(tokens.output);
        const reasoning = count(tokens.reasoning);
        const cacheRead = count(cache.read);
        const cacheWrite = count(cache.write);
        usage.inputTokens += input;
        usage.outputTokens += output;
        usage.reasoningTokens += reasoning;
        usage.cacheReadTokens += cacheRead;
        usage.cacheWriteTokens += cacheWrite;
        // The engine's explicit total is authoritative (some providers fold reasoning into output).
        usage.totalTokens += typeof tokens.total === 'number' ? count(tokens.total) : input + output + reasoning + cacheRead + cacheWrite;
        usage.cost += count(row.cost);
      }
      const session = child.get(outcome.childSessionId) as { worktree_path: string | null; worktree_branch: string | null } | undefined;
      worktreePath = session?.worktree_path ?? null;
      branch = (worktreePath ? ports.gitBranch(worktreePath) : null) ?? session?.worktree_branch ?? null;
    }
    const status: CoordinatorGoalRunStatus = outcome.outcome === 'running'
      ? (sessionIds.some((id) => ports.pendingSessionIds.has(id)) ? 'needs_you' : 'running')
      : outcome.outcome === 'returned_result_unverified'
        ? 'finished'
        : outcome.outcome === 'unknown' ? 'unknown' : 'failed';
    const reported = outcome.delegationId
      ? Boolean((notified.get(outcome.delegationId) as { notified_at: string | null } | undefined)?.notified_at)
      : false;
    return {
      goalId: outcome.goalId,
      objective,
      repoPath: goalRepoPath(objective),
      delegationId: outcome.delegationId,
      childSessionId: outcome.childSessionId,
      worktreePath,
      branch,
      status,
      reported,
      terminalAt: outcome.terminalAt,
      usage,
    };
  });
}
