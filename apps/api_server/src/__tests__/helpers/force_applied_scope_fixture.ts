import { getDb } from '../../database/db';

/**
 * FIXTURE ONLY. Places a proposal directly in the durable post-apply state.
 *
 * W1 package C: the generic status API refuses ANY scope-kind arrival at
 * `applied` — that edge belongs exclusively to the atomic target+proposal
 * primitive, so a scope proposal can never reach `applied` (and from there
 * `measuring`/`active`) while agent_configs still holds its prior bytes.
 * `w1_corrective_6_revisions.test.ts` (B9) is the test that pins that refusal.
 *
 * Tests that exercise LATER lifecycle stages — revert, measure, route
 * behaviour on an already-applied row — need that durable state as a
 * precondition, not as the thing under test. This raw write stands in for a
 * pair the atomic primitive already committed. Never use it in production
 * code, and never use it to assert that a transition is permitted.
 */
export function forceAppliedScopeFixture(id: string): void {
  getDb()
    .prepare(`UPDATE agent_org_proposals SET status = 'applied' WHERE id = ?`)
    .run(id);
}
