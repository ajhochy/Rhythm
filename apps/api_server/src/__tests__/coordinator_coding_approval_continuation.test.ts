import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ prompt: vi.fn().mockResolvedValue(true), stream: vi.fn(), map: new Map<string, string>() }));
vi.mock('../services/opencode_engine', () => ({ opencodeClient: { promptAsync: boundary.prompt }, opencodeSessionMap: boundary.map }));
vi.mock('../services/opencode_stream_bridge', () => ({ streamBridge: { streamSession: boundary.stream } }));
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { UsersRepository } from '../repositories/users_repository';
import { AgentApprovalContinuationService } from '../services/agent_approval_continuation_service';
import { WORKFLOW_APPROVAL_ACTION } from '../services/chat_bounded_workflow';

let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); runMigrations(db); setDb(db); boundary.prompt.mockClear(); boundary.stream.mockClear(); });
afterEach(() => { boundary.map.clear(); db.close(); });

it.each(['approved', 'rejected'] as const)('R2-no-root-wake: %s coding decision cannot fall back to ordinary root inference', async status => {
  // UNIT decision-boundary fixture, NOT cryptographic human approval/live proof.
  // Bug: an unknown typed card currently becomes a generic billable continuation.
  const sessions = new AgentSessionsRepository();
  const user = new UsersRepository().create({ name: 'Synthetic R2', email: 'r2-unit@example.invalid', googleSub: 'r2-unit' });
  const root = sessions.insert({ agentKind: 'claude-code', taskId: null, taskTitle: null,
    cwd: '/private/tmp', name: 'Synthetic coding unit', mcpRole: 'claude-code', ownerUserId: user.id });
  sessions.setSdkSessionId(root.id, 'ses_coding_root_unit'); sessions.updateStatus(root.id, 'idle');
  boundary.map.set(root.id, 'ses_coding_root_unit');
  const approvals = new AgentApprovalsRepository();
  const card = approvals.create({ sessionId: root.id, action: 'Unit coding terms', securityAction: WORKFLOW_APPROVAL_ACTION,
    boundPayloadJson: JSON.stringify({ purpose: 'coordinator_coding_execution_v1', malformed: true }) });
  expect(card.decisionNonce).not.toBeNull();
  approvals.decideWithNonce(card.id, status, `user:${user.id}`, card.decisionNonce!);
  await new AgentApprovalContinuationService().onSessionIdle(root.id);
  await new AgentApprovalContinuationService().recoverAfterRestart();
  expect(boundary.prompt).not.toHaveBeenCalled();
  expect(boundary.stream).not.toHaveBeenCalled();
  expect(new AgentApprovalsRepository().getById(card.id)).toMatchObject({ status, continuationState: 'queued', consumedAt: null });
});
