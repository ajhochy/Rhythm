import { createHash, randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response, Router } from 'express';

import {
  AgentConfigPatchError,
  applyAgentConfigPatch,
  validateAgentConfigPatch,
} from '../../controllers/agent_configs_controller';
import type { RevisionedAgentConfig } from '../../repositories/agent_configs_repository';
import { grantForId, type BridgeGrant } from '../bridge_grants';
import type {
  AgentPatchConfirmationView,
  AgentPatchRequest,
  AgentPatchResponse,
  AgentPatchStatusRequest,
  AgentPatchStatusResponse,
  BridgeErrorResponse,
  ConfirmationDecisionRequest,
  ConfirmationDecisionResponse,
  ConfirmationNextRequest,
  ValidatedAgentPatch,
} from '../bridge_schema';
import {
  CONFIRMED_EDIT_FIELDS,
  PRESENTATION_EDIT_FIELDS,
  type SharedAgentChanges,
  type SharedAgentEditableField,
  type SharedAgentV1,
} from '../contract';
import { buildSharedAgent } from '../projection_service';
import {
  active,
  BRIDGE_RATE_LIMITS,
  bridgeGrant,
  grantRateLimit,
  hasOnlyKeys,
  isJsonObject,
  registrar,
  runtime,
  sendBridgeError,
  type BridgeDeps,
} from './common';

const PATCH_KEYS = new Set(['expectedRevision', 'changes']);
const PATCH_STATUS_KEYS = new Set(['confirmationId']);
const CONFIRMATION_NEXT_KEYS = new Set(['waitMs']);
const CONFIRMATION_DECISION_KEYS = new Set(['changesSha256', 'approve']);
const EDITABLE_FIELDS = new Set<SharedAgentEditableField>([
  ...PRESENTATION_EDIT_FIELDS,
  ...CONFIRMED_EDIT_FIELDS,
]);
const BOOLEAN_FIELDS = new Set<SharedAgentEditableField>([
  'enabled',
  'isAgent',
  'isManager',
  'sessionSelectable',
  'imageGenerationEnabled',
  'autoApproveActions',
]);
const NULLABLE_BOOLEAN_FIELDS = new Set<SharedAgentEditableField>(['schedulable']);
const PATCH_TTL_MS = 120_000;

type ConfirmationStatus = AgentPatchStatusResponse['status'];

interface PendingConfirmation {
  confirmationId: string;
  grantId: string;
  agentId: string;
  agentLabel: string;
  expectedRevision: number;
  currentRevision: number;
  changes: SharedAgentChanges;
  changesSha256: string;
  fields: AgentPatchConfirmationView['fields'];
  expiresAtMs: number;
  status: ConfirmationStatus;
  agent?: SharedAgentV1;
  statusCurrentRevision?: number;
}

const confirmations = new Map<string, PendingConfirmation>();
const pendingByGrant = new Map<string, string>();
const waiters = new Set<() => void>();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function changesDigest(
  agentId: string,
  expectedRevision: number,
  changes: SharedAgentChanges,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ agentId, expectedRevision, changes })))
    .digest('hex');
}

function validChange(field: SharedAgentEditableField, value: unknown): boolean {
  if (BOOLEAN_FIELDS.has(field)) return typeof value === 'boolean';
  if (NULLABLE_BOOLEAN_FIELDS.has(field)) return value === null || typeof value === 'boolean';
  if (field === 'label' || field === 'icon') return typeof value === 'string';
  return value === null || typeof value === 'string';
}

function parsePatchBody(body: unknown): ValidatedAgentPatch | null {
  if (!isJsonObject(body) || !hasOnlyKeys(body, PATCH_KEYS)) return null;
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) return null;
  if (!isJsonObject(body.changes) || Object.keys(body.changes).length === 0) return null;

  const changes: SharedAgentChanges = {};
  for (const [name, value] of Object.entries(body.changes)) {
    if (!EDITABLE_FIELDS.has(name as SharedAgentEditableField)) return null;
    const field = name as SharedAgentEditableField;
    if (!validChange(field, value)) return null;
    changes[field] = value as never;
  }
  return { expectedRevision: Number(body.expectedRevision), changes };
}

function summarizeScalar(value: unknown): string {
  return String(value).slice(0, 120);
}

function summarizeField(
  field: SharedAgentEditableField,
  before: unknown,
  after: unknown,
): { before: string; after: string } {
  if (typeof before === 'boolean' || before === null || typeof after === 'boolean' || after === null) {
    return { before: summarizeScalar(before), after: summarizeScalar(after) };
  }
  if (field === 'label' || field === 'icon') {
    return { before: summarizeScalar(before), after: summarizeScalar(after) };
  }
  const oldText = typeof before === 'string' ? before : '';
  const newText = typeof after === 'string' ? after : '';
  const prefix = `changed (${oldText.length} → ${newText.length} chars): `;
  return {
    before: `${prefix}${oldText.slice(0, 120)}`,
    after: `${prefix}${newText.slice(0, 120)}`,
  };
}

function confirmationView(confirmation: PendingConfirmation): AgentPatchConfirmationView {
  return {
    confirmationId: confirmation.confirmationId,
    agentId: confirmation.agentId,
    agentLabel: confirmation.agentLabel,
    expectedRevision: confirmation.expectedRevision,
    currentRevision: confirmation.currentRevision,
    fields: confirmation.fields,
    changesSha256: confirmation.changesSha256,
  };
}

function notifyWaiters(): void {
  for (const waiter of waiters) waiter();
  waiters.clear();
}

function markExpired(nowMs: number): void {
  for (const confirmation of confirmations.values()) {
    if (confirmation.status !== 'pending' || confirmation.expiresAtMs > nowMs) continue;
    confirmation.status = 'expired';
    if (pendingByGrant.get(confirmation.grantId) === confirmation.confirmationId) {
      pendingByGrant.delete(confirmation.grantId);
    }
  }
}

function oldestPending(nowMs: number): PendingConfirmation | undefined {
  markExpired(nowMs);
  return [...confirmations.values()]
    .filter((confirmation) => confirmation.status === 'pending')
    .sort((left, right) => left.expiresAtMs - right.expiresAtMs)[0];
}

async function waitForPending(waitMs: number, deps: BridgeDeps): Promise<PendingConfirmation | undefined> {
  const immediate = oldestPending(deps.now().getTime());
  if (immediate || waitMs === 0) return immediate;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(done);
      resolve();
    }, waitMs);
    const done = (): void => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    };
    waiters.add(done);
  });
  return oldestPending(deps.now().getTime());
}

function bridgePatchError(res: Response, error: unknown): boolean {
  if (!(error instanceof AgentConfigPatchError)) return false;
  const details = error.currentRevision === undefined
    ? {}
    : { currentRevision: error.currentRevision };
  const code = error.reason === 'not_found' ? 'agent_not_found' : error.reason;
  sendBridgeError(res, error.statusCode, code, code.replaceAll('_', ' '), details);
  return true;
}

async function projectedAgent(
  config: RevisionedAgentConfig,
  grant: BridgeGrant,
): Promise<SharedAgentV1> {
  return buildSharedAgent(config, {
    localUserId: grant.localUserId,
    runtime: active(grant),
    cwd: null,
  });
}

function supersedePrevious(grantId: string): void {
  const previousId = pendingByGrant.get(grantId);
  if (!previousId) return;
  const previous = confirmations.get(previousId);
  if (previous?.status === 'pending') previous.status = 'superseded';
}

function createConfirmation(
  grant: BridgeGrant,
  agentId: string,
  expectedRevision: number,
  changes: SharedAgentChanges,
  config: RevisionedAgentConfig,
  nowMs: number,
): PendingConfirmation {
  supersedePrevious(grant.grantId);
  const fields = Object.entries(changes).map(([name, after]) => {
    const field = name as SharedAgentEditableField;
    return { name, ...summarizeField(field, config[field], after) };
  });
  const confirmation: PendingConfirmation = {
    confirmationId: randomUUID(),
    grantId: grant.grantId,
    agentId,
    agentLabel: config.label,
    expectedRevision,
    currentRevision: config.revision,
    changes,
    changesSha256: changesDigest(agentId, expectedRevision, changes),
    fields,
    expiresAtMs: nowMs + PATCH_TTL_MS,
    status: 'pending',
  };
  confirmations.set(confirmation.confirmationId, confirmation);
  pendingByGrant.set(grant.grantId, confirmation.confirmationId);
  notifyWaiters();
  return confirmation;
}

async function patchAgentHandler(
  req: Request<{ agentId: string }, AgentPatchResponse | BridgeErrorResponse, AgentPatchRequest>,
  res: Response<AgentPatchResponse | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  const parsed = parsePatchBody(req.body);
  if (!parsed) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const body = { expectedRevision: parsed.expectedRevision, ...parsed.changes };
  try {
    await validateAgentConfigPatch(req.params.agentId, body);
    const grant = bridgeGrant(res);
    const presentationOnly = Object.keys(parsed.changes)
      .every((field) => PRESENTATION_EDIT_FIELDS.includes(field as 'label' | 'icon'));
    if (presentationOnly) {
      const updated = await applyAgentConfigPatch(req.params.agentId, body);
      res.json({ status: 'applied', agent: await projectedAgent(updated, grant) });
      return;
    }

    const config = deps.agentConfigs().getById(req.params.agentId) as RevisionedAgentConfig | undefined;
    if (!config) {
      sendBridgeError(res, 404, 'agent_not_found');
      return;
    }
    const confirmation = createConfirmation(
      grant,
      req.params.agentId,
      parsed.expectedRevision,
      parsed.changes,
      config,
      deps.now().getTime(),
    );
    res.status(202).json({
      status: 'confirmation_required',
      confirmationId: confirmation.confirmationId,
      expiresAt: new Date(confirmation.expiresAtMs).toISOString(),
    });
  } catch (error) {
    if (!bridgePatchError(res, error)) throw error;
  }
}

async function patchStatusHandler(
  req: Request<{ agentId: string }, AgentPatchStatusResponse | BridgeErrorResponse, AgentPatchStatusRequest>,
  res: Response<AgentPatchStatusResponse | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  if (!isJsonObject(req.body) || !hasOnlyKeys(req.body, PATCH_STATUS_KEYS) || typeof req.body.confirmationId !== 'string') {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  markExpired(deps.now().getTime());
  const confirmation = confirmations.get(req.body.confirmationId);
  const grant = bridgeGrant(res);
  if (!confirmation || confirmation.grantId !== grant.grantId || confirmation.agentId !== req.params.agentId) {
    sendBridgeError(res, 404, 'confirmation_not_found');
    return;
  }
  res.json({
    status: confirmation.status,
    ...(confirmation.agent ? { agent: confirmation.agent } : {}),
    ...(confirmation.statusCurrentRevision === undefined
      ? {}
      : { currentRevision: confirmation.statusCurrentRevision }),
  });
}

async function nextConfirmationHandler(
  req: Request<Record<string, never>, AgentPatchConfirmationView | BridgeErrorResponse, ConfirmationNextRequest>,
  res: Response<AgentPatchConfirmationView | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  if (!isJsonObject(req.body) || !hasOnlyKeys(req.body, CONFIRMATION_NEXT_KEYS)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const waitMs = req.body.waitMs;
  if (!Number.isSafeInteger(waitMs) || Number(waitMs) < 0 || Number(waitMs) > 20_000) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const confirmation = await waitForPending(Number(waitMs), deps);
  if (!confirmation) {
    res.status(204).end();
    return;
  }
  res.json(confirmationView(confirmation));
}

async function decisionHandler(
  req: Request<{ confirmationId: string }, ConfirmationDecisionResponse | BridgeErrorResponse, ConfirmationDecisionRequest>,
  res: Response<ConfirmationDecisionResponse | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  if (!isJsonObject(req.body) || !hasOnlyKeys(req.body, CONFIRMATION_DECISION_KEYS)
    || typeof req.body.changesSha256 !== 'string' || typeof req.body.approve !== 'boolean') {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  markExpired(deps.now().getTime());
  const confirmation = confirmations.get(req.params.confirmationId);
  if (!confirmation) {
    sendBridgeError(res, 404, 'confirmation_not_found');
    return;
  }
  if (confirmation.changesSha256 !== req.body.changesSha256) {
    sendBridgeError(res, 409, 'confirmation_mismatch');
    return;
  }
  if (confirmation.status === 'expired') {
    res.json({ status: 'expired' });
    return;
  }
  if (confirmation.status !== 'pending') {
    res.json({ status: confirmation.status === 'applied' ? 'applied' : 'rejected' });
    return;
  }
  pendingByGrant.delete(confirmation.grantId);
  if (!req.body.approve) {
    confirmation.status = 'rejected';
    res.json({ status: 'rejected' });
    return;
  }

  const grant = grantForId(confirmation.grantId);
  if (!grant) {
    confirmation.status = 'conflict';
    res.json({ status: 'conflict' });
    return;
  }
  try {
    const updated = await applyAgentConfigPatch(confirmation.agentId, {
      expectedRevision: confirmation.expectedRevision,
      ...confirmation.changes,
    });
    confirmation.agent = await projectedAgent(updated, grant);
    confirmation.status = 'applied';
    res.json({ status: 'applied' });
  } catch (error) {
    if (!(error instanceof AgentConfigPatchError)) throw error;
    confirmation.status = 'conflict';
    confirmation.statusCurrentRevision = error.currentRevision;
    res.json({ status: 'conflict' });
  }
}

function createPatchHandler(
  deps: BridgeDeps,
): RequestHandler<{ agentId: string }, AgentPatchResponse | BridgeErrorResponse, AgentPatchRequest> {
  return (req, res) => patchAgentHandler(req, res, deps);
}

function createPatchStatusHandler(
  deps: BridgeDeps,
): RequestHandler<{ agentId: string }, AgentPatchStatusResponse | BridgeErrorResponse, AgentPatchStatusRequest> {
  return (req, res) => patchStatusHandler(req, res, deps);
}

function createNextConfirmationHandler(
  deps: BridgeDeps,
): RequestHandler<Record<string, never>, AgentPatchConfirmationView | BridgeErrorResponse, ConfirmationNextRequest> {
  return (req, res) => nextConfirmationHandler(req, res, deps);
}

function createDecisionHandler(
  deps: BridgeDeps,
): RequestHandler<{ confirmationId: string }, ConfirmationDecisionResponse | BridgeErrorResponse, ConfirmationDecisionRequest> {
  return (req, res) => decisionHandler(req, res, deps);
}

export function resetAgentPatchConfirmationsForTest(): void {
  confirmations.clear();
  pendingByGrant.clear();
  notifyWaiters();
}

export function register(router: Router, deps: BridgeDeps): void {
  router.post(
    '/agents/:agentId/patch',
    runtime('agent.write'),
    grantRateLimit('agent.patch', BRIDGE_RATE_LIMITS.agentPatchPerMinute),
    createPatchHandler(deps),
  );
  router.post('/agents/:agentId/patch-status', runtime('agent.write'), createPatchStatusHandler(deps));
  router.post('/registrar/confirmations/next', registrar, createNextConfirmationHandler(deps));
  router.post('/registrar/confirmations/:confirmationId/decision', registrar, createDecisionHandler(deps));
}
