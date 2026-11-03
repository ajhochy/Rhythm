import { createHash } from 'node:crypto';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import { AgentApprovalsRepository, type AgentApproval } from '../repositories/agent_approvals_repository';
import type { User } from '../models/user';

const approvals = new AgentApprovalsRepository();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function approvalOwnerId(approval: AgentApproval): number | null {
  if (!approval.sessionId) return null;
  const row = getDb().prepare('SELECT owner_user_id FROM agent_sessions WHERE id = ?')
    .get(approval.sessionId) as { owner_user_id: number | null } | undefined;
  return row?.owner_user_id ?? null;
}

export function relayCardHash(approval: AgentApproval, ownerUserId: number, revision: string): string {
  // Fixed ordered tuple binds everything displayed AND everything execution uses.
  return hash(['rhythm-relay-card-v1', revision, ownerUserId, approval.id, approval.sessionId,
    approval.agentConfigId, approval.action, approval.preview, approval.consequence,
    approval.securityAction, approval.payloadDigest, approval.taintId, approval.taintedTurnId,
    approval.boundAgent, approval.expiresAt, approval.createdAt]);
}

function requireFreshCard(approval: AgentApproval, expiredForbidden = false): void {
  const createdAt = approval.createdAt.includes('T') ? approval.createdAt : `${approval.createdAt.replace(' ', 'T')}Z`;
  const expiry = approval.expiresAt == null ? Date.parse(createdAt) + 600_000 : Date.parse(approval.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw (expiredForbidden ? AppError.forbidden : AppError.conflict)('Approval has expired; ask for a new proposal');
  }
  if (approval.consumedAt) throw AppError.conflict('Approval has already been consumed');
  if (approval.securityAction) {
    const taint = getDb().prepare('SELECT taint_id, tainted_turn_id FROM agent_external_taint_state WHERE session_id = ?')
      .get(approval.sessionId) as { taint_id: string; tainted_turn_id: string } | undefined;
    if (!taint || !approval.taintId || taint.taint_id !== approval.taintId || taint.tainted_turn_id !== approval.taintedTurnId) {
      throw AppError.conflict('Approval belongs to stale external-content taint');
    }
  }
}

export function pendingRelayCard(id: string, ownerUserId: number, expiredForbidden = false) {
  const approval = approvals.getById(id);
  if (!approval || approvalOwnerId(approval) !== ownerUserId) throw AppError.notFound('pending approval');
  if (approval.status !== 'pending' || !approval.decisionNonce) throw AppError.conflict('Approval is no longer pending');
  requireFreshCard(approval, expiredForbidden);
  const revision = hash(['rhythm-relay-revision-v1', approval.id, approval.decisionNonce]);
  return { id: approval.id, revision, cardHash: relayCardHash(approval, ownerUserId, revision),
    action: approval.action, preview: approval.preview, consequence: approval.consequence,
    securityAction: approval.securityAction, payloadDigest: approval.payloadDigest,
    expiresAt: approval.expiresAt, createdAt: approval.createdAt };
}

/** Host-owner decisions reuse the exact card/nonce binding, with distinct provenance. */
export function decideWebCard(user: User, id: string, input: Record<string, unknown>) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['revision', 'cardHash', 'status'].includes(key)) ||
    (input.status !== 'approved' && input.status !== 'rejected') ||
    typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision) ||
    typeof input.cardHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.cardHash)) {
    throw AppError.badRequest('An exact card revision/hash and approve or reject status are required');
  }
  return getDb().transaction(() => {
    const card = pendingRelayCard(id, user.id, true);
    if (input.revision !== card.revision || input.cardHash !== card.cardHash) throw AppError.conflict('Approval revision or hash changed');
    const audit = { kind: 'trusted-tailnet-web-decision-v1', ownerUserId: user.id, ownerName: user.name,
      displayIdentity: `${user.name} via browser`, source: 'trusted-tailnet-web', assurance: 'trusted-tailnet',
      attestation: 'owner_chose_in_browser', decision: input.status as 'approved' | 'rejected',
      revision: card.revision, cardHash: card.cardHash };
    const existing = approvals.getById(id)!;
    const updated = approvals.decideWithNonce(id, audit.decision, JSON.stringify(audit), existing.decisionNonce!);
    if (!updated) throw AppError.conflict('Approval was decided concurrently');
    return { approval: updated, result: { id, status: updated.status, decidedAt: updated.decidedAt, audit } };
  }).immediate();
}

export function listPendingRelayCards(ownerUserId: number) {
  const rows = getDb().prepare(`SELECT a.id FROM agent_approvals a JOIN agent_sessions s ON s.id = a.session_id
    WHERE s.owner_user_id = ? AND a.status = 'pending' ORDER BY a.created_at DESC`).all(ownerUserId) as {id: string}[];
  return rows.flatMap(({id}) => {
    try { return [pendingRelayCard(id, ownerUserId)]; }
    catch (error) { if (error instanceof AppError && [404, 409].includes(error.statusCode)) return []; throw error; }
  });
}

export function decideRelayCard(user: User, id: string, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['revision', 'cardHash', 'decision', 'attestation'].includes(key)) ||
    (input.decision !== 'approved' && input.decision !== 'rejected') || input.attestation !== 'owner_chose_in_chat' ||
    typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision) ||
    typeof input.cardHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.cardHash)) {
    throw AppError.badRequest('An exact card revision/hash, approve or reject decision and owner_chose_in_chat attestation are required');
  }
  // Lock before rereading: freshness, owner, hash and nonce update are one
  // transaction, including against other connections/desktop decisions.
  return getDb().transaction(() => {
    const card = pendingRelayCard(id, user.id);
    if (input.revision !== card.revision || input.cardHash !== card.cardHash) throw AppError.conflict('Approval revision or hash changed');
    const audit = { kind: 'hermes-chat-decision-v1', ownerUserId: user.id, ownerName: user.name,
      displayIdentity: `${user.name} via Hermes`, source: 'hermes', assurance: 'relay-attested',
      attestation: 'owner_chose_in_chat', decision: input.decision as 'approved' | 'rejected',
      revision: card.revision, cardHash: card.cardHash };
    const existing = approvals.getById(id)!;
    const updated = approvals.decideWithNonce(id, audit.decision, JSON.stringify(audit), existing.decisionNonce!);
    if (!updated) throw AppError.conflict('Approval was decided concurrently');
    return { approval: updated, result: { id, status: updated.status, decidedAt: updated.decidedAt, audit } };
  }).immediate();
}

/** Additional binding only; desktop and all existing engine guards stay intact. */
export function requireUnchangedRelayApproval(id: string): void {
  const approval = approvals.getById(id);
  if (!approval?.actor?.startsWith('{')) return;
  let audit: Record<string, unknown>;
  try { audit = JSON.parse(approval.actor); } catch { throw AppError.forbidden('Approval receipt is invalid'); }
  const hermes = audit.kind === 'hermes-chat-decision-v1' && audit.assurance === 'relay-attested'
    && audit.source === 'hermes' && audit.attestation === 'owner_chose_in_chat';
  const web = audit.kind === 'trusted-tailnet-web-decision-v1' && audit.assurance === 'trusted-tailnet'
    && audit.source === 'trusted-tailnet-web' && audit.attestation === 'owner_chose_in_browser';
  if ((!hermes && !web) ||
    audit.decision !== 'approved' || typeof audit.ownerUserId !== 'number' || typeof audit.revision !== 'string' ||
    approvalOwnerId(approval) !== audit.ownerUserId ||
    relayCardHash(approval, audit.ownerUserId, audit.revision) !== audit.cardHash) {
    throw AppError.forbidden('Approval no longer matches the relay-attested card');
  }
}
