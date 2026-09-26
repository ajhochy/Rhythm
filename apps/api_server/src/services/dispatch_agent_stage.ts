import type { AgentRunOptions, AgentRunResult } from './agent_runner';
import * as AgentRunner from './agent_runner';

type Runner = Pick<typeof AgentRunner, 'run'>;

/**
 * #1485 S2 — the ONE shared root-dispatch seam. Every stage that needs a
 * fresh, un-nested AgentRunner session (research passes today; recipe
 * workflow stages from S3a) goes through here instead of calling
 * `AgentRunner.run()` directly.
 *
 * Deliberately tiny (~20 lines): unconditionally omit `parentSessionId` (so
 * every stage dispatch is a ROOT session — no stage consumes nested
 * delegation depth) and forward everything else, including an
 * already-resolved `modelOverride` and the new `suppressTeacherEscalation`
 * flag, unchanged. No other logic belongs here — see
 * docs/ai/decisions/2026-08-26-recipe-extraction-boundary.md for why this
 * stays a seam rather than a second orchestration engine.
 */
export async function dispatchAgentStage(
  options: AgentRunOptions,
  runner: Runner = AgentRunner,
): Promise<AgentRunResult> {
  const { parentSessionId: _rootDispatch, ...rootOptions } = options;
  return runner.run(rootOptions);
}
