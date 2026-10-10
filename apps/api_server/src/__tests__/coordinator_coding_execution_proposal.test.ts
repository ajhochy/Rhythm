import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readWorkflowProposal, WORKFLOW_APPROVAL_ACTION } from '../services/chat_bounded_workflow';
import type { AgentApproval } from '../repositories/agent_approvals_repository';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { codingExecutionApprovalPreview, parseCodingExecutionProposal } from '../contracts/coordinator_coding_execution_contract';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
const { finishFixture, preserveForSymlink } = require('./helpers/preserved_fixture.cjs');
import { tmpdir } from 'node:os';
import { evaluateCodingOperation, type CodingOperationBinding, type CurrentCodingOperationAuthority } from '../services/coordinator_coding_operation_grant';

// Synthetic UNIT terms, not configured-model qualification or a human decision.
import { codingTerms, approvalFor, intentFor } from './helpers/coding_terms';
export { codingTerms, approvalFor } from './helpers/coding_terms';

describe('R2 typed coding execution proposal (UNIT, no A1–A10 qualification)', () => {
  it('R2-c1 reads every immutable coding term rather than rejecting coding as a selected-note proposal', () => {
    // Regression: the current selected-note-only reader returns null for a real coding card.
    const terms = codingTerms();
    expect(readWorkflowProposal(approvalFor(terms))).toEqual(terms);
  });

  it('R2-c2 binds absolute proposal+15m expiry and the explicitly proposed aggregate allowance', () => {
    const terms = codingTerms();
    terms.limits.totalSoftTokens = 75000; // Proposed unit value, NEVER execution authorization.
    terms.normalizedIntentHash = intentFor(terms);
    expect(readWorkflowProposal(approvalFor(terms))).toEqual(terms);
    terms.expiresAt = '2026-10-09T12:15:01.000Z';
    expect(readWorkflowProposal(approvalFor(terms))).toBeNull();
  });

  it.each([
    ['unknown authority field', (p: any) => { p.permissionMode = 'bypassPermissions'; }],
    ['workspace traversal', (p: any) => { p.workspace.writablePaths[0] = '../src/selectTasks.ts'; }],
    ['absolute write escape', (p: any) => { p.workspace.writablePaths[0] = '/tmp/selectTasks.ts'; }],
    ['protected evaluator write', (p: any) => { p.workspace.writablePaths.push('evaluator.test.mjs'); }],
    ['PATH executable substitution', (p: any) => { p.command.shellCommand = `node --import ${p.command.argv[1]} --test tests/selectTasks.test.mjs`; }],
    ['extra command operator', (p: any) => { p.command.shellCommand += ' && curl example.invalid'; }],
    ['injected environment', (p: any) => { p.command.env.NODE_OPTIONS = '--import evil.mjs'; }],
    ['exec subcommand', (p: any) => { p.command.argv.push('--eval', 'fetch("https://example.invalid")'); }],
    ['foreign cwd', (p: any) => { p.command.cwd = '/private/tmp'; }],
    ['model identity missing', (p: any) => { p.chain.worker.modelVersion = ''; }],
    ['extra worker', (p: any) => { p.limits.workerAttempts = 2; }],
    ['callback unaccounted', (p: any) => { p.limits.includesManagerCompletion = false; }],
    ['mutable evaluator', (p: any) => { p.acceptance.writableByWorker = true; }],
    ['missing independent check', (p: any) => { p.acceptance.criteria.pop(); }],
  ])('R2-c3 rejects %s even when the changed payload has a matching digest', (_name, mutate) => {
    const terms = codingTerms();
    expect(readWorkflowProposal(approvalFor(terms))).toEqual(terms);
    mutate(terms);
    terms.normalizedIntentHash = intentFor(terms);
    expect(readWorkflowProposal(approvalFor(terms))).toBeNull();
  });

  it.each(['payloadDigest', 'sessionId', 'agentConfigId', 'boundAgent', 'expiresAt'])('R2-c4 refuses substituted approval %s', field => {
    const approval = approvalFor(codingTerms());
    expect(readWorkflowProposal(approval)).toEqual(codingTerms());
    (approval as any)[field] = 'foreign';
    expect(readWorkflowProposal(approval)).toBeNull();
  });

  it('R2-store-payload: existing SQLite owner persists complete pending terms and a nonce, never manager auto-approval', () => {
    const db = new Database(':memory:'); runMigrations(db); setDb(db);
    try {
      // Boundary fixture rows only; no live root/goal or human decision seeded.
      db.pragma('foreign_keys=OFF');
      const terms = codingTerms();
      const parsed = parseCodingExecutionProposal(terms)!;
      expect(parsed).not.toBeNull();
      const repo = new AgentApprovalsRepository();
      const card = repo.create({ sessionId: terms.sessionId, agentConfigId: terms.profileId,
        action: 'Approve bounded coding execution', preview: codingExecutionApprovalPreview(parsed),
        securityAction: WORKFLOW_APPROVAL_ACTION, payloadDigest: approvalFor(terms).payloadDigest,
        boundAgent: terms.profileId, expiresAt: terms.expiresAt, boundPayloadJson: JSON.stringify(terms), autoApprove: true });
      expect(card).toMatchObject({ status: 'pending', actor: null, decidedAt: null, consumedAt: null });
      expect(card.decisionNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const reread = new AgentApprovalsRepository().getById(card.id)!;
      expect(readWorkflowProposal(reread)).toEqual(terms);
      expect(reread.preview).toContain('30,000 aggregate SOFT tokens');
      expect(reread.preview).toContain(terms.command.shellCommand);
      expect(reread.preview).toContain('stays PLAN');
      expect(reread.preview).toContain('Hard denies are NOT overridden');
      expect(reread.preview).toContain(terms.expiresAt);
      expect(reread.preview).toContain(terms.acceptance.evaluatorDigest);
    } finally { db.close(); }
  });
});

describe('R2 narrow operation-grant integration seam (UNIT only, not a wired ask)', () => {
  function fixture() {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'r2-operation-unit-')));
    const root = join(directory, 'workspace');
    mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'src/selectTasks.ts'), 'export const selectTasks = (tasks) => tasks;');
    const terms = codingTerms(); terms.workspace.canonicalRoot = root; terms.command.cwd = root;
    terms.normalizedIntentHash = intentFor(terms);
    const p = parseCodingExecutionProposal(terms)!;
    expect(p).not.toBeNull();
    // Explicit UNIT decision-state fixture; no signature, no grant issuance, no live pass.
    const approval = { ...approvalFor(p), status: 'approved' as const, actor: 'user:7', decisionNonce: null,
      decidedAt: '2026-10-09T12:00:30.000Z', consumedAt: '2026-10-09T12:00:45.000Z' };
    const binding: CodingOperationBinding = { approvalId: approval.id, proposalDigest: approval.payloadDigest!,
      rootLocalId: p.sessionId, rootSdkId: p.sdkSessionId, managerLocalId: 'manager-unit', managerSdkId: 'ses_manager_unit',
      workerLocalId: 'worker-unit', workerSdkId: 'ses_worker_unit', taskStartedAt: '2026-10-09T12:01:00.000Z',
      workerStartedAt: '2026-10-09T12:02:00.000Z', revokedAt: null };
    const current: CurrentCodingOperationAuthority = { ownerUserId: 7, projectId: p.projectId,
      rootLocalId: p.sessionId, rootSdkId: p.sdkSessionId, managerLocalId: binding.managerLocalId,
      managerSdkId: binding.managerSdkId, managerParentLocalId: p.sessionId,
      workerLocalId: binding.workerLocalId, workerSdkId: binding.workerSdkId, workerParentLocalId: binding.managerLocalId,
      rootMode: 'plan', managerMode: 'plan', workerMode: 'default', proposal: p, goalActive: true,
      projectAccessible: true, profilesEligible: true, paused: false, cancelled: false, usageTokens: 1000,
      effectiveAction: 'ask', toolAllowed: true, exactWorkerPlanException: true };
    const input = { approval, binding, current, localSessionId: binding.workerLocalId, sdkSessionId: binding.workerSdkId,
      operation: { kind: 'edit' as const, path: 'src/selectTasks.ts', cwd: root }, now: Date.parse('2026-10-09T12:03:00.000Z') };
    return { directory, root, input };
  }

  it('R2-operation allows only the bound worker edit and exact declared command, never persistent always-allow', () => {
    const { directory, root, input } = fixture();
    try {
      expect(evaluateCodingOperation(input)).toEqual({ reply: 'once', reason: 'exact_current_coding_worker_operation' });
      expect(evaluateCodingOperation({ ...input, operation: { kind: 'write', path: 'tests/selectTasks.test.mjs', cwd: root } }).reply).toBe('once');
      expect(evaluateCodingOperation({ ...input, operation: { kind: 'bash', command: input.current.proposal.command.shellCommand, cwd: root, env: {} } }).reply).toBe('once');
      input.current.proposal.controlRevision++;
      expect(evaluateCodingOperation(input).reply).toBe('once'); // Unrelated chat control does not change this intent.
    } finally { finishFixture(directory, () => rmSync(directory, { recursive: true })); }
  });

  it.each([
    ['hard deny', 'hard_policy', (i: any) => { i.current.effectiveAction = 'deny'; }],
    ['unknown policy', 'hard_policy', (i: any) => { i.current.effectiveAction = 'unknown'; }],
    ['tool deny', 'hard_policy', (i: any) => { i.current.toolAllowed = false; }],
    ['root operation', 'worker_only', (i: any) => { i.localSessionId = i.binding.rootLocalId; i.sdkSessionId = i.binding.rootSdkId; }],
    ['manager operation', 'worker_only', (i: any) => { i.localSessionId = i.binding.managerLocalId; i.sdkSessionId = i.binding.managerSdkId; }],
    ['generic parent plan exception', 'worker_only', (i: any) => { i.current.exactWorkerPlanException = false; }],
    ['foreign owner', 'identity_binding', (i: any) => { i.current.ownerUserId = 8; }],
    ['foreign project', 'identity_binding', (i: any) => { i.current.projectId = 'foreign'; }],
    ['substituted manager SDK', 'identity_binding', (i: any) => { i.current.managerSdkId = 'ses_other'; }],
    ['substituted parent', 'identity_binding', (i: any) => { i.current.workerParentLocalId = i.binding.rootLocalId; }],
    ['unsigned pending decision', 'approval_binding', (i: any) => { i.approval.status = 'pending'; }],
    ['auto-approved decision', 'approval_binding', (i: any) => { i.approval.actor = 'auto-approved'; }],
    ['unused decision nonce', 'approval_binding', (i: any) => { i.approval.decisionNonce = 'unconsumed'; }],
    ['not consumed reservation', 'approval_binding', (i: any) => { i.approval.consumedAt = null; }],
    ['changed workspace generation', 'approval_binding', (i: any) => { i.current.proposal.workspace.generation++; }],
    ['changed model', 'approval_binding', (i: any) => { i.current.proposal.chain.worker.modelId = 'substitute'; }],
    ['cancel', 'revoked', (i: any) => { i.current.cancelled = true; }],
    ['pause', 'revoked', (i: any) => { i.current.paused = true; }],
    ['profile locked', 'revoked', (i: any) => { i.current.profilesEligible = false; }],
    ['revocation', 'revoked', (i: any) => { i.binding.revokedAt = '2026-10-09T12:03:00.000Z'; }],
    ['queued ask after worker deadline', 'expired', (i: any) => { i.now = Date.parse('2026-10-09T12:07:00.000Z'); }],
    ['queued ask after absolute expiry', 'expired', (i: any) => { i.now = Date.parse('2026-10-09T12:15:00.000Z'); }],
    ['unknown usage', 'usage_hold', (i: any) => { i.current.usageTokens = null; }],
    ['exhausted allowance', 'usage_hold', (i: any) => { i.current.usageTokens = 30000; }],
    ['undeclared file', 'write_scope', (i: any) => { i.operation.path = 'protected-evaluator.test.mjs'; }],
    ['dot-dot escape', 'write_scope', (i: any) => { i.operation.path = '../workspace/src/selectTasks.ts'; }],
    ['absolute escape', 'write_scope', (i: any) => { i.operation.path = '/private/tmp/selectTasks.ts'; }],
  ])('R2-operation rejects %s with the specific guard %s', (_name, reason, mutate) => {
    const { directory, input } = fixture();
    try {
      expect(evaluateCodingOperation(input).reply).toBe('once');
      mutate(input);
      expect(evaluateCodingOperation(input)).toEqual({ reply: 'reject', reason });
    } finally { finishFixture(directory, () => rmSync(directory, { recursive: true })); }
  });

  it('R2-realpath refuses an exact allowed filename symlinked to an external protected file', async () => {
    const { directory, root, input } = fixture();
    try {
      expect(evaluateCodingOperation(input).reply).toBe('once');
      const outside = join(directory, 'protected-evaluator.test.mjs'); writeFileSync(outside, 'protected');
      await preserveForSymlink(join(root, 'src/selectTasks.ts'), () => unlinkSync(join(root, 'src/selectTasks.ts')));
      symlinkSync(outside, join(root, 'src/selectTasks.ts'));
      expect(evaluateCodingOperation(input)).toEqual({ reply: 'reject', reason: 'write_scope' });
    } finally { finishFixture(directory, () => rmSync(directory, { recursive: true })); }
  }, process.env.RHYTHM_TEST_PRESERVE_FIXTURES === '1' ? 40_000 : undefined);

  it.each([' && curl example.invalid', '; node other.mjs', ' | sh', '\nnode other.mjs'])('R2-command rejects added shell effect %s', suffix => {
    const { directory, root, input } = fixture();
    try {
      const operation = { kind: 'bash' as const, command: input.current.proposal.command.shellCommand, cwd: root, env: {} };
      expect(evaluateCodingOperation({ ...input, operation }).reply).toBe('once');
      operation.command += suffix;
      expect(evaluateCodingOperation({ ...input, operation })).toEqual({ reply: 'reject', reason: 'command_scope' });
    } finally { finishFixture(directory, () => rmSync(directory, { recursive: true })); }
  });

  it.each([{ NODE_OPTIONS: '--import evil.mjs' }, [], 1, null])('R2-command rejects environment injection/malformed overrides %j', env => {
    const { directory, root, input } = fixture();
    try {
      const operation = { kind: 'bash' as const, command: input.current.proposal.command.shellCommand, cwd: root, env: env as any };
      expect(evaluateCodingOperation({ ...input, operation })).toEqual({ reply: 'reject', reason: 'command_scope' });
    } finally { finishFixture(directory, () => rmSync(directory, { recursive: true })); }
  });
});
