/**
 * Durable, user-visible coordinator lifecycle.  `ready` is deliberately the
 * only state which admits a new explicit Run next request; a terminal worker
 * never moves a workstream to completed by itself.
 */
export type AgentWorkstreamState =
  | 'ready'
  | 'queued'
  | 'running'
  | 'blocked'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'unknown';

export type AgentWorkstreamClosedReason = 'user_paused' | 'user_cancelled' | null;

export interface AgentWorkstream {
  id: string;
  ownerUserId: number;
  projectId: string;
  goal: string;
  constraints: string;
  criteria: string;
  checkpoint: AgentWorkstreamCheckpoint;
  state: AgentWorkstreamState;
  /** Machine-readable reason only; it never contains worker/source prose. */
  stateReason: string | null;
  closedReason: AgentWorkstreamClosedReason;
  /** Local coordinator boot which admitted the most recent run, if any. */
  executorEpoch: string | null;
  lastJobId: string | null;
  /**
   * A server-created, one-shot future authorization.  `null` is default-off.
   * Malformed stored data is never surfaced as an authorization; the
   * coordinator exposes it as a blocked status through its scoped API.
   */
  automation: OneShotAutomationPlan | null;
  revision: number;
  createKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWorkstreamCheckpoint {
  version: 1;
  criteria: Array<{
    id: string;
    /** `verified` and `waived` are server-only transitions. */
    status: 'pending' | 'blocked' | 'verified' | 'waived';
    receiptId?: string;
  }>;
  references: Array<{ sourceId: string; expectedVersion: string; scope: string; provenance: 'trusted_reference' | 'user_reference' }>;
  nextAction: { kind: 'review' | 'clarify'; scope: string };
}
import type { OneShotAutomationPlan } from '../contracts/agent_workstream_automation_contract';
