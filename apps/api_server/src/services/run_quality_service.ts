/**
 * run_quality_service.ts — #865 (agent run QUALITY scorecard)
 *
 * A plain-language, human-facing quality rollup for recent agent runs, DISTINCT
 * from the per-provider SPEND view (usage_budget_service.ts / GET
 * /agents/usage-budget). Spend answers "how much did this cost"; this answers
 * "is this agent doing a good job" — completion vs escalation, wasted tokens,
 * how often the human had to step in, and whether the same mistake repeats.
 *
 * READ-ONLY metrics. Nothing here feeds the org-optimizer auto-tune loop
 * (#816) — that is a separate, explicitly-scoped concern. This service only
 * ever reads agent_sessions / agent_session_messages and returns a rollup.
 *
 * Data model (reused, no new tables/columns):
 *   - One "run" = one agent_sessions row (is_system=0 — background/system
 *     sessions are excluded, matching the normal session list).
 *   - Per-run tokens are summed from agent_session_messages.tokens_json
 *     (shape: { input, output, reasoning, cache: { read, write } }, written by
 *     opencode_stream_bridge from the SDK's message.updated event).
 *   - Per-run corrections are counted from agent_session_messages rows with
 *     role='input' AFTER the first one in the session — the first input is the
 *     user's original ask; every input after that is the user stepping back in
 *     (a follow-up, correction, or redirect) rather than the agent finishing
 *     the job unprompted.
 *
 * Completion vs escalation (from agent_sessions.status):
 *   - 'closed' / 'idle'  -> completed (the run finished without an unresolved
 *     error; 'idle' covers a session parked mid-task but not errored).
 *   - 'error'            -> escalated (the run ended in a state that needed a
 *     human or a retry — status_message carries the reason when present).
 *   - 'starting' / 'working' / 'resumable' -> in progress; excluded from the
 *     completion/escalation rate (they are neither a pass nor a fail yet) but
 *     still contribute to totalRuns so the count is honest.
 *
 * Token waste (THE thing #865 asks to define distinctly from raw spend):
 *   "Waste" = tokens spent on runs that did NOT produce a usable result —
 *   concretely, tokens attributed to a run that (a) ended in status='error'
 *   (escalated without completing), OR (b) required 2+ user corrections
 *   without ever reaching a completed status (looped/re-prompted without the
 *   agent finishing). Raw spend (usage_budget_service) sums ALL tokens across
 *   ALL runs regardless of outcome; token waste is the SUBSET of that spend
 *   tied to runs that did not pay off. `wastePercentOfSpend` divides waste by
 *   total tokens across all measured runs so the number reads as "N% of the
 *   tokens this agent used were spent on runs that didn't finish cleanly."
 *
 * Repeated mistakes: escalated (status='error') runs are grouped by a
 * normalized status_message (trimmed, lower-cased, trailing punctuation and
 * embedded ids/paths collapsed via a light regex) within the window. Any
 * group with 2+ occurrences is surfaced as a "repeated mistake" with its
 * plain-language message and count — this is what lets a non-technical church
 * office user see "this agent keeps failing the same way" instead of just a
 * raw error count.
 *
 * Thin-history handling (#865 acceptance criterion): an agent with fewer than
 * MIN_RUNS_FOR_SIGNAL measurable runs (completed + escalated; in-progress runs
 * don't count toward this) gets `notEnoughData: true` and every rate field is
 * `null` — never a misleading 0% or 100% computed from 1-2 samples.
 *
 * Unmeasured runs: a run whose outcome cannot be classified (tokens_json
 * missing/unparseable AND status is not a terminal state) is counted in
 * `unmeasuredRuns` rather than silently dropped or folded into "completed".
 */

import { getDb } from '../database/db';

export const MIN_RUNS_FOR_SIGNAL = 5;

const TERMINAL_STATUSES = new Set(['closed', 'idle', 'error']);
const COMPLETED_STATUSES = new Set(['closed', 'idle']);

interface SessionRow {
  id: string;
  agent_kind: string;
  status: string;
  status_message: string | null;
  created_at: string;
}

interface MessageAggRow {
  session_id: string;
  role: string;
  tokens_json: string | null;
  created_at: string;
  id: number;
}

interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function totalTokens(t: TokenUsage): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}

function parseTokens(tokensJson: string | null): TokenUsage | null {
  if (!tokensJson) return null;
  try {
    const parsed = JSON.parse(tokensJson) as Record<string, unknown>;
    const cache = (parsed.cache ?? {}) as Record<string, unknown>;
    return {
      input: typeof parsed.input === 'number' ? parsed.input : 0,
      output: typeof parsed.output === 'number' ? parsed.output : 0,
      reasoning: typeof parsed.reasoning === 'number' ? parsed.reasoning : 0,
      cacheRead: typeof cache.read === 'number' ? cache.read : 0,
      cacheWrite: typeof cache.write === 'number' ? cache.write : 0,
    };
  } catch {
    return null;
  }
}

/** Normalize a status_message so near-duplicate errors group together. */
function normalizeMistake(message: string): string {
  return message
    .toLowerCase()
    .trim()
    // Collapse UUIDs / short alnum-with-dash ids / numeric ids so "session
    // abc-123 failed" and "session xyz-789 failed" group as the same mistake.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\b[a-z0-9]+-[a-z0-9-]*\d[a-z0-9-]*\b/g, '<id>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '');
}

export type RunOutcome = 'completed' | 'escalated' | 'in_progress' | 'unmeasured';

export interface RepeatedMistake {
  /** Plain-language message as it was recorded (first occurrence's original text). */
  message: string;
  count: number;
}

export interface AgentRunQuality {
  /** agent_configs.id / agent_sessions.agent_kind (logical FK, not enforced). */
  agentKind: string;
  /** Human-readable label (agent_configs.label) when resolvable, else agentKind. */
  agentLabel: string;
  totalRuns: number;
  completedRuns: number;
  escalatedRuns: number;
  inProgressRuns: number;
  unmeasuredRuns: number;
  /**
   * Whether there are enough measurable runs (completed + escalated) to trust
   * the rates below. Fewer than MIN_RUNS_FOR_SIGNAL -> true, and every rate
   * field is null rather than a misleading 0%/100% from a tiny sample.
   */
  notEnoughData: boolean;
  /** completedRuns / (completedRuns + escalatedRuns), or null when notEnoughData. */
  completionRate: number | null;
  /** escalatedRuns / (completedRuns + escalatedRuns), or null when notEnoughData. */
  escalationRate: number | null;
  /** Total tokens across ALL runs for this agent (input+output+reasoning+cache). Same basis as spend. */
  totalTokens: number;
  /** Tokens spent on runs that errored or looped without completing (see module doc). */
  wastedTokens: number;
  /** wastedTokens / totalTokens, or null when there is no token data at all. */
  wastePercentOfSpend: number | null;
  /** Sum of user follow-up/redirect messages (input messages after the first) across all runs. */
  totalUserCorrections: number;
  /** totalUserCorrections / totalRuns, or null when notEnoughData. */
  avgCorrectionsPerRun: number | null;
  /** Escalation reasons that recurred 2+ times in the window (repeated mistakes). */
  repeatedMistakes: RepeatedMistake[];
}

export interface RunQualityRollup {
  generatedAt: string;
  /** Lookback window in days used to select runs (see getRunQualityRollup opts). */
  windowDays: number;
  agents: AgentRunQuality[];
}

/**
 * Classify a session's outcome. A session with a parseable, terminal status
 * is either 'completed' or 'escalated'. A session in a live/transient status
 * is 'in_progress'. Anything else — a terminal-looking status we don't
 * recognize, or missing data needed to say anything meaningful — is
 * 'unmeasured' so it is surfaced rather than silently dropped or counted as
 * a pass.
 */
function classifyOutcome(status: string): RunOutcome {
  if (COMPLETED_STATUSES.has(status)) return 'completed';
  if (status === 'error') return 'escalated';
  if (status === 'starting' || status === 'working' || status === 'resumable') return 'in_progress';
  return 'unmeasured';
}

function labelForAgentKind(db: ReturnType<typeof getDb>, agentKind: string): string {
  const row = db
    .prepare(`SELECT label FROM agent_configs WHERE id = ?`)
    .get(agentKind) as { label: string } | undefined;
  return row?.label ?? agentKind;
}

export interface RunQualityDeps {
  db?: ReturnType<typeof getDb>;
}

/**
 * Build the per-agent-run quality rollup. Pure read — never mutates state.
 *
 * @param opts.windowDays  Lookback window (default 30). Only agent_sessions
 *   created within this window are considered.
 */
export function getRunQualityRollup(
  opts: { windowDays?: number } = {},
  deps: RunQualityDeps = {},
): RunQualityRollup {
  const db = deps.db ?? getDb();
  const windowDays = opts.windowDays ?? 30;
  const cutoffIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const sessions = db
    .prepare(
      `SELECT id, agent_kind, status, status_message, created_at
       FROM agent_sessions
       WHERE is_system = 0 AND created_at >= ?`,
    )
    .all(cutoffIso) as SessionRow[];

  if (sessions.length === 0) {
    return { generatedAt: new Date().toISOString(), windowDays, agents: [] };
  }

  const sessionIds = sessions.map((s) => s.id);
  const placeholders = sessionIds.map(() => '?').join(',');
  const messages = sessionIds.length
    ? (db
        .prepare(
          `SELECT id, session_id, role, tokens_json, created_at
           FROM agent_session_messages
           WHERE session_id IN (${placeholders})
           ORDER BY session_id, created_at ASC, id ASC`,
        )
        .all(...sessionIds) as MessageAggRow[])
    : [];

  const messagesBySession = new Map<string, MessageAggRow[]>();
  for (const m of messages) {
    const list = messagesBySession.get(m.session_id) ?? [];
    list.push(m);
    messagesBySession.set(m.session_id, list);
  }

  const sessionsByAgent = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = sessionsByAgent.get(s.agent_kind) ?? [];
    list.push(s);
    sessionsByAgent.set(s.agent_kind, list);
  }

  const agents: AgentRunQuality[] = [];

  for (const [agentKind, kindSessions] of sessionsByAgent) {
    let completedRuns = 0;
    let escalatedRuns = 0;
    let inProgressRuns = 0;
    let unmeasuredRuns = 0;
    let totalTokensSum = 0;
    let wastedTokensSum = 0;
    let anyTokenData = false;
    let totalUserCorrections = 0;
    const mistakeCounts = new Map<string, { message: string; count: number }>();

    for (const session of kindSessions) {
      const outcome = classifyOutcome(session.status);
      const sessionMessages = messagesBySession.get(session.id) ?? [];

      // Token usage for this run.
      let runTokens = 0;
      let runHasTokenData = false;
      for (const m of sessionMessages) {
        const parsed = parseTokens(m.tokens_json);
        if (parsed) {
          runHasTokenData = true;
          runTokens += totalTokens(parsed);
        }
      }
      if (runHasTokenData) {
        anyTokenData = true;
        totalTokensSum += runTokens;
      }

      // User corrections: input-role messages after the first one.
      const inputMessages = sessionMessages.filter((m) => m.role === 'input');
      const corrections = Math.max(0, inputMessages.length - 1);
      totalUserCorrections += corrections;

      // A run with no terminal status AND no token/message data at all is
      // genuinely unmeasurable — surface it rather than dropping it or
      // silently folding it into "in progress".
      if (outcome === 'unmeasured') {
        unmeasuredRuns++;
      } else if (outcome === 'in_progress') {
        inProgressRuns++;
      } else if (outcome === 'completed') {
        completedRuns++;
      } else {
        // escalated
        escalatedRuns++;
        if (runHasTokenData) wastedTokensSum += runTokens;
        if (session.status_message) {
          const key = normalizeMistake(session.status_message);
          const existing = mistakeCounts.get(key);
          if (existing) {
            existing.count++;
          } else {
            mistakeCounts.set(key, { message: session.status_message, count: 1 });
          }
        }
      }

      // Looped-without-completing waste: 2+ corrections but never reached a
      // completed status (still in progress or escalated) also counts as
      // wasted tokens — the agent needed repeated redirection and, in this
      // window, has not yet delivered.
      if (outcome !== 'completed' && corrections >= 2 && runHasTokenData) {
        // Avoid double-count for the escalated branch above.
        if (outcome !== 'escalated') {
          wastedTokensSum += runTokens;
        }
      }
    }

    const measurableRuns = completedRuns + escalatedRuns;
    const notEnoughData = measurableRuns < MIN_RUNS_FOR_SIGNAL;

    const repeatedMistakes: RepeatedMistake[] = Array.from(mistakeCounts.values())
      .filter((m) => m.count >= 2)
      .sort((a, b) => b.count - a.count)
      .map((m) => ({ message: m.message, count: m.count }));

    agents.push({
      agentKind,
      agentLabel: labelForAgentKind(db, agentKind),
      totalRuns: kindSessions.length,
      completedRuns,
      escalatedRuns,
      inProgressRuns,
      unmeasuredRuns,
      notEnoughData,
      completionRate: notEnoughData ? null : completedRuns / measurableRuns,
      escalationRate: notEnoughData ? null : escalatedRuns / measurableRuns,
      totalTokens: totalTokensSum,
      wastedTokens: wastedTokensSum,
      wastePercentOfSpend: anyTokenData && totalTokensSum > 0 ? wastedTokensSum / totalTokensSum : null,
      totalUserCorrections,
      avgCorrectionsPerRun: notEnoughData ? null : totalUserCorrections / kindSessions.length,
      repeatedMistakes,
    });
  }

  agents.sort((a, b) => a.agentLabel.localeCompare(b.agentLabel));

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    agents,
  };
}
