import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  grantForCapability,
  registerGrant,
  resetBridgeGrantsForTest,
  sha256,
} from '../shared_agents/bridge_grants';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { resetAgentPatchConfirmationsForTest } from '../shared_agents/bridge/agents_patch';
import {
  defaultBridgeDeps,
  resetBridgeRateLimitsForTest,
} from '../shared_agents/bridge/common';
import { CANONICAL_FIELDS } from '../shared_agents/contract';
import { logger } from '../utils/logger';
import { startTestServer } from './helpers/real_server';
import { createAgentBridgeRouter } from '../routes/agent_bridge_routes';
import { asyncDelegationCompletionService } from '../services/async_delegation_completion_service';

const effects = vi.hoisted(() => ({
  project: vi.fn(),
  reload: vi.fn(async () => true),
  broadcast: vi.fn(),
}));
vi.mock('../services/agent_profile_projection_service', () => ({
  projectAgentProfileAfterWrite: effects.project,
}));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    reloadConfig: effects.reload,
    isReady: false,
  },
}));
vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
  broadcastAgentConfigsChanged: effects.broadcast,
}));

const registrarSecret = 'synthetic-registrar-secret';
const advancedJson = '{ "read": {"z":"deny","a":"allow"}, "future_tool": "ask" }';

interface Harness {
  db: Database.Database;
  baseUrl: string;
  close(): Promise<void>;
  userA: { id: number; token: string };
  userB: { id: number; token: string };
}

let harness: Harness;
const tempDirs: string[] = [];
const originalEnv = {
  role: env.role,
  bridgeEnabled: env.bridgeEnabled,
  agentExecutionEnabled: env.agentExecutionEnabled,
  agentLocal: env.agentLocal,
  dbClient: env.dbClient,
  dbPath: env.dbPath,
  agentBridgeRegistrarSha256: env.agentBridgeRegistrarSha256,
  agentOriginGuardEnabled: env.agentOriginGuardEnabled,
  localRendererOrigins: env.localRendererOrigins,
};

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', ...extra };
}

function bearer(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return jsonHeaders({ Authorization: `Bearer ${token}`, ...extra });
}

function registrarHeaders(): Record<string, string> {
  return jsonHeaders({ 'X-Rhythm-Bridge-Registrar': registrarSecret });
}

async function registerCapability(
  capability: string,
  token = harness.userA.token,
  scopes = ['catalog.read', 'projection.issue', 'runtime.report', 'agent.write'],
): Promise<Response> {
  return fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/grants`, {
    method: 'POST',
    headers: registrarHeaders(),
    body: JSON.stringify({
      grantId: randomUUID(),
      capabilitySha256: sha256(capability),
      sessionToken: token,
      hermesProfile: 'default',
      runtimeGeneration: randomUUID(),
      serverOrigin: harness.baseUrl,
      authGeneration: 'synthetic-auth-generation',
      scopes,
    }),
  });
}

async function reportRuntime(capability: string): Promise<void> {
  const response = await fetch(`${harness.baseUrl}/agent-bridge/v1/runtime/report`, {
    method: 'POST',
    headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
    body: JSON.stringify({
      hermesVersion: '1.0.0',
      pluginVersion: '1.0.0',
      providers: [{ id: 'anthropic', ready: true }],
      reasoningEfforts: ['low', 'high'],
      terminalBackend: 'local',
    }),
  });
  expect(response.status).toBe(204);
}

function insertDelegatedJob(
  capability: string,
  overrides: { id?: string; cwd?: string | null; targetRevision?: number } = {},
): { id: string; leaseToken: string } {
  const grant = grantForCapability(capability)!;
  const id = overrides.id ?? randomUUID();
  const leaseToken = createHash('sha256').update(`lease-${id}`).digest('base64url');
  const now = new Date().toISOString();
  harness.db.prepare(`INSERT INTO agent_bridge_jobs (
    id,direction,idempotency_key,request_sha256,local_user_id,hermes_profile,parent_runtime,
    parent_runtime_instance,parent_session_id,parent_agent_id,parent_projection_id,target_agent_id,
    target_revision,target_runtime,child_runtime_instance,child_session_id,depth,chain_id,prompt,
    context,cwd,state,state_reason,cancel_requested_at,result_text,result_truncated,progress_json,
    lease_token_sha256,lease_expires_at,delivery_state,delivered_at,created_at,updated_at,terminal_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, 'rhythm_to_hermes', randomUUID(), 'request-hash', grant.localUserId, 'default', 'opencode',
    'local', 'parent-session', 'shared-manager', null, 'shared-manager',
    overrides.targetRevision ?? new AgentConfigsRepository().getById('shared-manager')!.revision!,
    'hermes', grant.runtimeGeneration, null, 1, 'chain', 'prompt', null, overrides.cwd ?? null,
    'claimed', null, null, null, 0, null, sha256(leaseToken), new Date(Date.now() + 60_000).toISOString(),
    'pending', null, now, now, null,
  );
  return { id, leaseToken };
}

function insertManager(): void {
  new AgentConfigsRepository().insert({
    id: 'shared-manager',
    label: 'Shared Manager',
    icon: 'hub',
    enabled: true,
    isAgent: true,
    isManager: true,
    sessionSelectable: true,
    systemPrompt: 'Coordinate carefully.',
    allowedMcpsJson: '{}',
    allowedSkillsJson: '[]',
    corePermissionsJson: advancedJson,
    allowedDelegatesJson: '[]',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    reasoningEffort: 'high',
  });
}

beforeEach(async () => {
  env.bridgeEnabled = true;
  env.agentExecutionEnabled = true;
  env.agentLocal = true;
  env.agentBridgeRegistrarSha256 = createHash('sha256').update(registrarSecret).digest('hex');
  env.agentOriginGuardEnabled = true;
  env.localRendererOrigins = ['app://hermes'];
  resetBridgeGrantsForTest();
  resetAgentPatchConfirmationsForTest();
  resetBridgeRateLimitsForTest();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  Object.values(effects).forEach((effect) => effect.mockClear());

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  const users = new UsersRepository();
  const sessions = new SessionsRepository();
  const first = users.create({ name: 'Local A', email: 'local-a@example.com' });
  const second = users.create({ name: 'Local B', email: 'local-b@example.com' });
  const sessionA = await sessions.createAsync(first.id);
  const sessionB = await sessions.createAsync(second.id);
  insertManager();
  const server = await startTestServer(createApp());
  harness = {
    db,
    baseUrl: server.baseUrl,
    close: server.close,
    userA: { id: first.id, token: sessionA.token },
    userB: { id: second.id, token: sessionB.token },
  };
});

afterEach(async () => {
  await harness.close();
  harness.db.close();
  setDb(null);
  resetBridgeGrantsForTest();
  resetAgentPatchConfirmationsForTest();
  resetBridgeRateLimitsForTest();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  Object.assign(env, originalEnv);
  vi.restoreAllMocks();
});

describe('shared-agent HTTP catalog and projections', () => {
  it('SA-CAT-1 matches every canonical field to the real agent-config response byte-for-byte', async () => {
    const configResponse = await fetch(`${harness.baseUrl}/agent-configs/shared-manager`, {
      headers: bearer(harness.userA.token),
    });
    const sharedResponse = await fetch(`${harness.baseUrl}/shared-agents/v1/catalog/shared-manager`, {
      headers: bearer(harness.userA.token),
    });
    expect([configResponse.status, sharedResponse.status]).toEqual([200, 200]);
    const config = await configResponse.json() as Record<string, unknown>;
    const shared = await sharedResponse.json() as { canonical: Record<string, unknown> };
    expect(Object.keys(shared.canonical)).toEqual(CANONICAL_FIELDS);
    for (const field of CANONICAL_FIELDS) expect(shared.canonical[field], field).toEqual(config[field]);
    expect(shared.canonical.corePermissionsJson).toBe(advancedJson);
    expect(shared.canonical).not.toHaveProperty('command');
  });

  it('SA-CAT-5 enforces auth and isolates grant readiness and scope by local user', async () => {
    expect((await fetch(`${harness.baseUrl}/shared-agents/v1/catalog`)).status).toBe(401);
    const capability = 'catalog-owner-capability';
    expect((await registerCapability(capability)).status).toBe(201);
    await reportRuntime(capability);

    const [responseA, responseB] = await Promise.all([
      fetch(`${harness.baseUrl}/shared-agents/v1/catalog`, { headers: bearer(harness.userA.token) }),
      fetch(`${harness.baseUrl}/shared-agents/v1/catalog`, { headers: bearer(harness.userB.token) }),
    ]);
    const catalogA = await responseA.json() as any;
    const catalogB = await responseB.json() as any;
    expect(catalogA.scope).not.toBe(catalogB.scope);
    expect(catalogA.agents.find((agent: any) => agent.id === 'shared-manager').runtimes.hermes.readiness).toBe('supported');
    expect(catalogB.agents.find((agent: any) => agent.id === 'shared-manager').runtimes.hermes.reasons.map((entry: any) => entry.code)).toContain('runtime_not_connected');
  });

  it('SA-PROJ-10 validates and persists interactive projections with realpath cwd/session uniqueness', async () => {
    const capability = 'projection-capability';
    expect((await registerCapability(capability)).status).toBe(201);
    await reportRuntime(capability);
    const revision = new AgentConfigsRepository().getById('shared-manager')!.revision!;
    const cwd = process.cwd();
    const aliasRoot = mkdtempSync(join(tmpdir(), 'sa-cwd-alias-'));
    tempDirs.push(aliasRoot);
    const cwdAlias = join(aliasRoot, 'repo');
    symlinkSync(cwd, cwdAlias);
    const issue = (body: Record<string, unknown>) => fetch(`${harness.baseUrl}/agent-bridge/v1/projections`, {
      method: 'POST',
      headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify(body),
    });
    const validBody = {
      sessionKey: 'projection-session', cwd: cwdAlias, launchKind: 'interactive', acceptVersions: [2],
      agentId: 'shared-manager', expectedRevision: revision,
    };
    const created = await issue(validBody);
    expect(created.status).toBe(200);
    const payload = await created.json() as any;
    expect(payload.snapshot.launch.cwd).toBe(realpathSync(cwd));
    expect(harness.db.prepare('SELECT session_key, snapshot_json FROM agent_bridge_projections WHERE projection_id = ?').get(payload.projectionId)).toMatchObject({ session_key: 'projection-session' });

    const reused = await issue(validBody);
    expect(reused.status).toBe(409);
    expect((await reused.json() as any).error.code).toBe('session_key_reused');
    const stale = await issue({ ...validBody, sessionKey: 'stale-session', expectedRevision: revision + 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json() as any).error.code).toBe('revision_conflict');

    const repo = new AgentConfigsRepository();
    let current = repo.getById('shared-manager')!;
    repo.update('shared-manager', { sessionSelectable: false }, current.revision);
    current = repo.getById('shared-manager')!;
    const hidden = await issue({ ...validBody, cwd, sessionKey: 'hidden-session', expectedRevision: current.revision });
    expect(hidden.status).toBe(409);
    expect((await hidden.json() as any).error.code).toBe('launch_kind_not_allowed');
    repo.update('shared-manager', { sessionSelectable: true }, current.revision);
    current = repo.getById('shared-manager')!;
    harness.db.prepare('UPDATE agent_configs SET locked = 1 WHERE id = ?').run('shared-manager');
    const locked = await issue({ ...validBody, cwd, sessionKey: 'locked-session', expectedRevision: current.revision });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ error: { code: 'projection_unsupported', reasons: expect.arrayContaining([expect.objectContaining({ code: 'agent_locked' })]) } });
    harness.db.prepare('UPDATE agent_configs SET locked = 0 WHERE id = ?').run('shared-manager');

    const protectedRoot = mkdtempSync(join(tmpdir(), 'sa-http-protected-'));
    tempDirs.push(protectedRoot);
    const previousDbPath = env.dbPath;
    env.dbPath = join(protectedRoot, 'rhythm.db');
    try {
      current = repo.getById('shared-manager')!;
      const protectedCwd = await issue({
        ...validBody,
        cwd: protectedRoot,
        sessionKey: 'protected-session',
        expectedRevision: current.revision,
      });
      expect(protectedCwd.status).toBe(409);
      expect((await protectedCwd.json() as any).error.code).toBe('cwd_invalid');
    } finally {
      env.dbPath = previousDbPath;
    }

    const job = insertDelegatedJob(capability, { cwd });
    const delegatedBody = {
      sessionKey: 'delegated-session', cwd, launchKind: 'delegated', acceptVersions: [2],
      jobId: job.id, leaseToken: job.leaseToken,
    };
    const badLease = await issue({ ...delegatedBody, leaseToken: 'wrong-lease' });
    expect(badLease.status).toBe(409);
    expect((await badLease.json() as any).error.code).toBe('lease_invalid');
    const cwdMismatch = await issue({ ...delegatedBody, cwd: tmpdir() });
    expect(cwdMismatch.status).toBe(409);
    expect((await cwdMismatch.json() as any).error.code).toBe('cwd_mismatch');
    const delegatedProjection = await issue(delegatedBody);
    expect(delegatedProjection.status).toBe(200);
    expect(harness.db.prepare(
      'SELECT depth FROM agent_bridge_projections WHERE job_id = ?',
    ).get(job.id)).toEqual({ depth: 1 });
    const duplicateJob = await issue({ ...delegatedBody, sessionKey: 'delegated-duplicate' });
    expect(duplicateJob.status).toBe(409);
    expect((await duplicateJob.json() as any).error.code).toBe('job_not_claimed');

    const changedJob = insertDelegatedJob(capability, { id: 'target-revision-job', targetRevision: current.revision });
    const terminalWake = vi.spyOn(asyncDelegationCompletionService, 'onBridgeJobTerminal')
      .mockResolvedValue(undefined);
    repo.update('shared-manager', { icon: 'changed' }, current.revision);
    const changed = await issue({
      sessionKey: 'changed-target', cwd: null, launchKind: 'delegated', acceptVersions: [2],
      jobId: changedJob.id, leaseToken: changedJob.leaseToken,
    });
    expect(changed.status).toBe(409);
    expect((await changed.json() as any).error.code).toBe('target_revision_changed');
    expect(harness.db.prepare('SELECT state, state_reason FROM agent_bridge_jobs WHERE id = ?').get(changedJob.id)).toEqual({
      state: 'failed', state_reason: 'target_revision_changed',
    });
    await vi.waitFor(() => expect(terminalWake).toHaveBeenCalledWith('parent-session'));
  });

  it('SA-PROJ-11 restores the frozen owner/snapshot, isolates owners, and revokes locked/disabled agents', async () => {
    const capability = 'projection-check-capability';
    await registerCapability(capability);
    await reportRuntime(capability);
    const repo = new AgentConfigsRepository();
    const revision = repo.getById('shared-manager')!.revision!;
    const created = await fetch(`${harness.baseUrl}/agent-bridge/v1/projections`, {
      method: 'POST',
      headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ sessionKey: 'frozen-session', cwd: null, launchKind: 'interactive', acceptVersions: [2], agentId: 'shared-manager', expectedRevision: revision }),
    });
    const issued = await created.json() as any;
    expect(issued.ownerId).toBe(String(harness.userA.id));
    const frozen = issued.snapshot;
    repo.update('shared-manager', { systemPrompt: 'Changed after issue.' }, revision);
    const check = (
      sessionKey: string,
      presentedCapability = capability,
      includeSnapshot = true,
    ) => fetch(`${harness.baseUrl}/agent-bridge/v1/projections/${issued.projectionId}/check`, {
      method: 'POST',
      headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': presentedCapability }),
      body: JSON.stringify({ sessionKey, includeSnapshot }),
    });
    const stillFrozen = await check('frozen-session');
    expect(stillFrozen.status).toBe(200);
    expect(await stillFrozen.json()).toEqual({
      ok: true,
      ownerId: String(harness.userA.id),
      snapshot: frozen,
    });
    const ownerOnly = await check('frozen-session', capability, false);
    expect(await ownerOnly.json()).toEqual({
      ok: true,
      ownerId: String(harness.userA.id),
    });
    const otherCapability = 'projection-check-other-owner';
    expect((await registerCapability(otherCapability, harness.userB.token)).status).toBe(201);
    const ownerMismatch = await check('frozen-session', otherCapability);
    expect(ownerMismatch.status).toBe(403);
    expect(await ownerMismatch.json()).toEqual({
      error: { code: 'projection_owner_mismatch' },
    });
    expect((await check('wrong-session')).status).toBe(404);
    harness.db.prepare('UPDATE agent_configs SET enabled = 0 WHERE id = ?').run('shared-manager');
    const disabled = await check('frozen-session');
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toMatchObject({ error: { code: 'projection_revoked', reason: 'agent_disabled' } });
    harness.db.prepare('UPDATE agent_configs SET locked = 1, enabled = 1 WHERE id = ?').run('shared-manager');
    const revoked = await check('frozen-session');
    expect(revoked.status).toBe(409);
    expect(await revoked.json()).toMatchObject({ error: { code: 'projection_revoked', reason: 'agent_locked' } });
  });
});

describe('shared-agent bridge authentication', () => {
  it('SA-AUTH-1 enforces registrar credentials and binds grants to the resolved local id', async () => {
    const missing = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, { method: 'POST', headers: jsonHeaders(), body: '{}' });
    expect(missing.status).toBe(403);
    env.agentBridgeRegistrarSha256 = '';
    const unavailable = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, { method: 'POST', headers: registrarHeaders(), body: '{}' });
    expect(unavailable.status).toBe(503);
    env.agentBridgeRegistrarSha256 = sha256(registrarSecret);
    const unresolved = await registerCapability('unresolved', 'not-a-session');
    expect(unresolved.status).toBe(403);
    expect((await unresolved.json() as any).error.code).toBe('grant_identity_unresolved');
    const cloudIdentity = 9001;
    const cloudToken = `synthetic-cloud-user-${cloudIdentity}`;
    const localUser = new UsersRepository().findById(harness.userA.id);
    const identityApp = express();
    identityApp.use('/agent-bridge/v1', createAgentBridgeRouter({
      ...defaultBridgeDeps,
      resolveBearer: async (token) => token === cloudToken ? localUser : null,
    }));
    const identityServer = await startTestServer(identityApp);
    const capability = 'resolved-cloud-capability';
    try {
      const accepted = await fetch(`${identityServer.baseUrl}/agent-bridge/v1/registrar/grants`, {
        method: 'POST',
        headers: registrarHeaders(),
        body: JSON.stringify({
          grantId: randomUUID(),
          capabilitySha256: sha256(capability),
          sessionToken: cloudToken,
          hermesProfile: 'default',
          runtimeGeneration: randomUUID(),
          serverOrigin: identityServer.baseUrl,
          authGeneration: 'cloud-auth-generation',
          scopes: ['catalog.read'],
        }),
      });
      expect(accepted.status).toBe(201);
      expect(grantForCapability(capability)?.localUserId).toBe(harness.userA.id);
      expect(grantForCapability(capability)?.localUserId).not.toBe(cloudIdentity);
    } finally {
      await identityServer.close();
    }
  });

  it('rejects Origin on registrar routes and missing registrar ownership on runtime routes', async () => {
    const originDenied = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, {
      method: 'POST',
      headers: registrarHeaders(),
      body: '{}',
    });
    expect(originDenied.status).toBe(204);
    const browserRegistrar = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, {
      method: 'POST',
      headers: { ...registrarHeaders(), Origin: 'app://hermes' },
      body: '{}',
    });
    expect(browserRegistrar.status).toBe(403);
    expect(await browserRegistrar.json()).toMatchObject({ error: { code: 'bridge_origin_forbidden' } });

    const capability = 'runtime-digest-regression';
    registerGrant({
      grantId: randomUUID(), capabilitySha256: sha256(capability), localUserId: harness.userA.id,
      hermesProfile: 'default', runtimeGeneration: randomUUID(), serverOrigin: harness.baseUrl,
      authGeneration: 'digest-regression', scopes: ['catalog.read'], memoryVaultId: null,
    });
    env.agentBridgeRegistrarSha256 = '';
    const unavailable = await fetch(`${harness.baseUrl}/agent-bridge/v1/catalog`, {
      headers: { 'X-Rhythm-Bridge-Capability': capability },
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ error: { code: 'bridge_unavailable' } });
    const renderer = await fetch(`${harness.baseUrl}/shared-agents/v1/catalog`, {
      headers: bearer(harness.userB.token),
    });
    const payload = await renderer.json() as any;
    expect(payload.agents.find((agent: any) => agent.id === 'shared-manager').runtimes.hermes.reasons)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'runtime_unowned' })]));
  });

  it('enforces the per-grant memory search fixed-window limit', async () => {
    const capability = 'memory-rate-limit-capability';
    registerGrant({
      grantId: randomUUID(), capabilitySha256: sha256(capability), localUserId: harness.userA.id,
      hermesProfile: 'default', runtimeGeneration: randomUUID(), serverOrigin: harness.baseUrl,
      authGeneration: 'memory-rate', scopes: ['memory.search'], memoryVaultId: null,
    });
    const search = () => fetch(`${harness.baseUrl}/agent-bridge/v1/memory/search`, {
      method: 'POST',
      headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ query: '' }),
    });
    for (let index = 0; index < 30; index += 1) expect((await search()).status).toBe(400);
    const limited = await search();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: 'bridge_rate_limited' } });
  });

  it('revokes the capability even when retiring its ledger generation fails', async () => {
    const capability = 'retire-failure-capability';
    const grantId = randomUUID();
    registerGrant({
      grantId, capabilitySha256: sha256(capability), localUserId: harness.userA.id,
      hermesProfile: 'default', runtimeGeneration: randomUUID(), serverOrigin: harness.baseUrl,
      authGeneration: 'retire-failure', scopes: ['catalog.read'], memoryVaultId: null,
    });
    vi.spyOn(AgentBridgeJobsRepository.prototype, 'markRuntimeRetired')
      .mockImplementation(() => { throw new Error('synthetic retirement failure'); });
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const revoked = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/grants/${grantId}`, {
      method: 'DELETE', headers: registrarHeaders(),
    });
    expect(revoked.status).toBe(204);
    expect(grantForCapability(capability)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('retire'), expect.anything());
  });

  it('SA-AUTH-2 maps malformed and oversized JSON at the bridge boundary', async () => {
    const malformed = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, {
      method: 'POST', headers: registrarHeaders(), body: '{bad',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: 'bridge_invalid_request' } });
    const oversized = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, {
      method: 'POST', headers: registrarHeaders(), body: JSON.stringify({ padding: 'x'.repeat(65_536) }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: 'bridge_body_too_large' } });

    const capability = 'rate-limit-capability';
    await registerCapability(capability);
    const invalidQuery = await fetch(`${harness.baseUrl}/agent-bridge/v1/catalog/shared-manager?sessionRevision=bad`, {
      headers: { 'X-Rhythm-Bridge-Capability': capability },
    });
    expect(invalidQuery.status).toBe(400);
    expect(await invalidQuery.json()).toMatchObject({ error: { code: 'bridge_invalid_request' } });
    let limited: Response | undefined;
    for (let index = 0; index < 31; index += 1) {
      limited = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
        method: 'POST',
        headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
        body: '{}',
      });
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(await limited!.json()).toMatchObject({ error: { code: 'bridge_rate_limited' } });
  });

  it('SA-AUTH-3 retires only the revoked generation across replacement, single revoke, and revoke-all', async () => {
    // Regression caught: grant revocation invalidates the capability but leaves
    // claimed/running work live, or accidentally retires another user's runtime.
    const delegationScopes = ['delegation.execute'];
    const reportJob = (capability: string, jobId: string, leaseToken: string) => fetch(
      `${harness.baseUrl}/agent-bridge/v1/delegations/${jobId}/report`,
      {
        method: 'POST',
        headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
        body: JSON.stringify({
          leaseToken,
          phase: 'running',
          childSessionKey: `child-${jobId}`,
        }),
      },
    );
    const jobState = (id: string) => harness.db.prepare(
      'SELECT state, state_reason FROM agent_bridge_jobs WHERE id = ?',
    ).get(id);

    const oldCapability = 'old-generation-capability';
    expect((await registerCapability(
      oldCapability,
      harness.userA.token,
      delegationScopes,
    )).status).toBe(201);
    const oldGrant = grantForCapability(oldCapability)!;
    const oldJob = insertDelegatedJob(oldCapability, { id: 'replacement-job' });
    expect((await reportJob(oldCapability, oldJob.id, oldJob.leaseToken)).status).toBe(200);

    const otherCapability = 'other-user-generation-capability';
    expect((await registerCapability(
      otherCapability,
      harness.userB.token,
      delegationScopes,
    )).status).toBe(201);
    const otherJob = insertDelegatedJob(otherCapability, { id: 'other-user-job' });
    expect((await reportJob(otherCapability, otherJob.id, otherJob.leaseToken)).status).toBe(200);

    const nextCapability = 'next-generation-capability';
    const replacement = await registerCapability(
      nextCapability,
      harness.userA.token,
      delegationScopes,
    );
    expect(replacement.status).toBe(201);
    expect((await replacement.json() as any).replacedGrantId).toBe(oldGrant.grantId);
    expect(jobState(oldJob.id)).toEqual({ state: 'unknown', state_reason: 'runtime_retired' });
    expect(jobState(otherJob.id)).toEqual({ state: 'running', state_reason: null });
    expect((await reportJob(oldCapability, oldJob.id, oldJob.leaseToken)).status).toBe(401);

    const nextGrant = grantForCapability(nextCapability)!;
    const singleJob = insertDelegatedJob(nextCapability, { id: 'single-revoke-job' });
    expect((await reportJob(nextCapability, singleJob.id, singleJob.leaseToken)).status).toBe(200);
    const singleRevoke = await fetch(
      `${harness.baseUrl}/agent-bridge/v1/registrar/grants/${nextGrant.grantId}`,
      { method: 'DELETE', headers: registrarHeaders() },
    );
    expect(singleRevoke.status).toBe(204);
    expect(jobState(singleJob.id)).toEqual({ state: 'unknown', state_reason: 'runtime_retired' });
    expect(jobState(otherJob.id)).toEqual({ state: 'running', state_reason: null });
    expect((await reportJob(nextCapability, singleJob.id, singleJob.leaseToken)).status).toBe(401);

    const finalCapability = 'final-generation-capability';
    expect((await registerCapability(
      finalCapability,
      harness.userA.token,
      delegationScopes,
    )).status).toBe(201);
    const finalJob = insertDelegatedJob(finalCapability, { id: 'revoke-all-job' });
    expect((await reportJob(finalCapability, finalJob.id, finalJob.leaseToken)).status).toBe(200);
    const revokeAll = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, {
      method: 'POST',
      headers: registrarHeaders(),
      body: '{}',
    });
    expect(revokeAll.status).toBe(204);
    expect(jobState(finalJob.id)).toEqual({ state: 'unknown', state_reason: 'runtime_retired' });
    expect(jobState(otherJob.id)).toEqual({ state: 'unknown', state_reason: 'runtime_retired' });
  });

  it('SA-AUTH-4 omits bridge routes in cloud, relay and Postgres configurations', async () => {
    const derivedBridgeEnabled = (role: string, dbClient: string): boolean => {
      const output = execFileSync(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e',
        "const mod = await import('./src/config/env.ts'); const value = mod.env ?? mod.default?.env; process.stdout.write(String(value.bridgeEnabled));",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RHYTHM_ROLE: role,
          AGENT_LOCAL: 'true',
          DB_CLIENT: dbClient,
        },
        encoding: 'utf8',
      });
      return output === 'true';
    };
    expect(derivedBridgeEnabled('local', 'sqlite')).toBe(true);
    expect(derivedBridgeEnabled('cloud', 'sqlite')).toBe(false);
    expect(derivedBridgeEnabled('relay', 'sqlite')).toBe(false);
    expect(derivedBridgeEnabled('local', 'postgres')).toBe(false);

    const configurations = [
      { role: 'cloud' as const, agentExecutionEnabled: false, agentLocal: false, dbClient: 'postgres' as const },
      { role: 'relay' as const, agentExecutionEnabled: false, agentLocal: false, dbClient: 'postgres' as const },
      { role: 'local' as const, agentExecutionEnabled: true, agentLocal: true, dbClient: 'postgres' as const },
    ];
    for (const configuration of configurations) {
      Object.assign(env, configuration, { bridgeEnabled: false });
      if (configuration.role === 'local') {
        harness.db.exec('DROP TABLE agent_bridge_projections; DROP TABLE agent_bridge_jobs;');
      }
      const isolated = await startTestServer(createApp());
      try {
        for (const path of ['/agent-bridge/v1/catalog', '/shared-agents/v1/catalog']) {
          expect((await fetch(`${isolated.baseUrl}${path}`, { headers: bearer(harness.userA.token) })).status, `${configuration.role}:${path}`).toBe(404);
        }
        if (configuration.role === 'local') {
          const status = await fetch(`${isolated.baseUrl}/agent-delegation/status?callerSessionId=missing`);
          expect(status.status).not.toBe(500);
          expect(JSON.stringify(await status.json())).not.toContain('crossRuntime');
        }
      } finally {
        await isolated.close();
      }
    }
  });

  it('SA-AUTH-5 never reflects or logs bridge secrets on parse, size or auth failures', async () => {
    const registrarSentinel = 'REGISTRAR_SENTINEL_DO_NOT_LOG';
    const capabilitySentinel = 'CAPABILITY_SENTINEL_DO_NOT_LOG';
    const sessionSentinel = 'SESSION_SENTINEL_DO_NOT_LOG';
    const promptSentinel = 'PROMPT_SENTINEL_DO_NOT_LOG';
    const querySentinel = 'QUERY_SENTINEL_DO_NOT_LOG';
    const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const responses = [
      await fetch(`${harness.baseUrl}/agent-bridge/v1/catalog`, { headers: { 'X-Rhythm-Bridge-Capability': capabilitySentinel } }),
      await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, { method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Registrar': registrarSentinel }), body: `{\"prompt\":\"${promptSentinel}` }),
      await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/revoke-all`, {
        method: 'POST', headers: registrarHeaders(),
        body: JSON.stringify({ padding: promptSentinel.repeat(4_096) }),
      }),
      await registerCapability('unresolved-sentinel-capability', sessionSentinel),
      await fetch(`${harness.baseUrl}/agent-bridge/v1/catalog/shared-manager?sessionRevision=${querySentinel}`, { headers: { 'X-Rhythm-Bridge-Capability': capabilitySentinel } }),
    ];
    const rendered = (await Promise.all(responses.map(async (response) => JSON.stringify(await response.json())))).join('\n');
    const logs = JSON.stringify(logSpy.mock.calls);
    for (const sentinel of [registrarSentinel, capabilitySentinel, sessionSentinel, promptSentinel, querySentinel]) {
      expect(rendered).not.toContain(sentinel);
      expect(logs).not.toContain(sentinel);
    }
  });

  it('SA-AUTH-6 refuses the Hermes renderer origin on bridge reads and canonical patches', async () => {
    const capability = 'origin-capability';
    await registerCapability(capability);
    const bridge = await fetch(`${harness.baseUrl}/agent-bridge/v1/catalog`, {
      headers: { Origin: 'app://hermes', 'X-Rhythm-Bridge-Capability': capability },
    });
    expect(bridge.status).toBe(403);
    expect(await bridge.json()).toMatchObject({ error: { code: 'bridge_origin_forbidden' } });
    const revision = new AgentConfigsRepository().getById('shared-manager')!.revision;
    const patch = await fetch(`${harness.baseUrl}/agent-configs/shared-manager`, {
      method: 'PATCH',
      headers: bearer(harness.userA.token, { Origin: 'app://hermes' }),
      body: JSON.stringify({ expectedRevision: revision, label: 'Forbidden origin' }),
    });
    expect(patch.status).toBe(403);
  });
});

describe('shared-agent confirmed patches', () => {
  it('SA-PATCH-1 returns the current revision and performs no stale write', async () => {
    const capability = 'patch-stale-capability';
    await registerCapability(capability);
    const before = new AgentConfigsRepository().getById('shared-manager')!;
    const response = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
      method: 'POST',
      headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ expectedRevision: before.revision! + 1, changes: { label: 'Stale' } }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'revision_conflict', currentRevision: before.revision } });
    expect(new AgentConfigsRepository().getById('shared-manager')).toEqual(before);
    expect(effects.project).not.toHaveBeenCalled();
  });

  it('SA-PATCH-2 applies presentation changes and requires a matching registrar confirmation for policy changes', async () => {
    const capability = 'patch-confirmation-capability';
    await registerCapability(capability);
    const repo = new AgentConfigsRepository();
    let current = repo.getById('shared-manager')!;
    const presentation = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
      method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ expectedRevision: current.revision, changes: { label: 'Renamed', icon: 'star' } }),
    });
    expect(presentation.status).toBe(200);
    expect(await presentation.json()).toMatchObject({
      status: 'applied',
      agent: { canonical: { label: 'Renamed', icon: 'star' } },
    });

    current = repo.getById('shared-manager')!;
    const pending = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
      method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ expectedRevision: current.revision, changes: { systemPrompt: 'Confirmed policy.' } }),
    });
    expect(pending.status).toBe(202);
    const pendingBody = await pending.json() as any;
    expect(repo.getById('shared-manager')?.systemPrompt).toBe('Coordinate carefully.');

    const next = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/confirmations/next`, {
      method: 'POST', headers: registrarHeaders(), body: JSON.stringify({ waitMs: 0 }),
    });
    expect(next.status).toBe(200);
    const confirmation = await next.json() as any;
    expect(confirmation.confirmationId).toBe(pendingBody.confirmationId);
    expect(confirmation.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'systemPrompt' })]));

    const mismatch = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/confirmations/${confirmation.confirmationId}/decision`, {
      method: 'POST', headers: registrarHeaders(), body: JSON.stringify({ changesSha256: '0'.repeat(64), approve: true }),
    });
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json() as any).error.code).toBe('confirmation_mismatch');
    const approved = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/confirmations/${confirmation.confirmationId}/decision`, {
      method: 'POST', headers: registrarHeaders(), body: JSON.stringify({ changesSha256: confirmation.changesSha256, approve: true }),
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ status: 'applied' });
    expect(repo.getById('shared-manager')?.systemPrompt).toBe('Confirmed policy.');

    current = repo.getById('shared-manager')!;
    const rejectedPending = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
      method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ expectedRevision: current.revision, changes: { systemPrompt: 'Must reject.' } }),
    });
    const rejectedBody = await rejectedPending.json() as any;
    const rejectedNext = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/confirmations/next`, {
      method: 'POST', headers: registrarHeaders(), body: JSON.stringify({ waitMs: 0 }),
    });
    const rejectedConfirmation = await rejectedNext.json() as any;
    expect(rejectedConfirmation.confirmationId).toBe(rejectedBody.confirmationId);
    const rejected = await fetch(`${harness.baseUrl}/agent-bridge/v1/registrar/confirmations/${rejectedBody.confirmationId}/decision`, {
      method: 'POST', headers: registrarHeaders(),
      body: JSON.stringify({ changesSha256: rejectedConfirmation.changesSha256, approve: false }),
    });
    expect(await rejected.json()).toEqual({ status: 'rejected' });
    expect(repo.getById('shared-manager')?.systemPrompt).toBe('Confirmed policy.');

    const supersededPending = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
      method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ expectedRevision: current.revision, changes: { systemPrompt: 'Superseded.' } }),
    });
    const supersededBody = await supersededPending.json() as any;
    const replacementPending = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
      method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ expectedRevision: current.revision, changes: { systemPrompt: 'Replacement.' } }),
    });
    const replacementBody = await replacementPending.json() as any;
    const supersededStatus = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch-status`, {
      method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ confirmationId: supersededBody.confirmationId }),
    });
    expect(await supersededStatus.json()).toEqual({ status: 'superseded' });

    const expiresAt = new Date(replacementBody.expiresAt).getTime();
    const originalNow = defaultBridgeDeps.now;
    defaultBridgeDeps.now = () => new Date(expiresAt + 1);
    try {
      const expiredStatus = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch-status`, {
        method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
        body: JSON.stringify({ confirmationId: replacementBody.confirmationId }),
      });
      expect(await expiredStatus.json()).toEqual({ status: 'expired' });
    } finally {
      defaultBridgeDeps.now = originalNow;
    }
    expect(repo.getById('shared-manager')?.systemPrompt).toBe('Confirmed policy.');

    harness.db.prepare('UPDATE agent_configs SET locked = 1, enabled = 0 WHERE id = ?').run('shared-manager');
    current = repo.getById('shared-manager')!;
    const locked = await fetch(`${harness.baseUrl}/agent-bridge/v1/agents/shared-manager/patch`, {
      method: 'POST', headers: jsonHeaders({ 'X-Rhythm-Bridge-Capability': capability }),
      body: JSON.stringify({ expectedRevision: current.revision, changes: { enabled: true } }),
    });
    expect(locked.status).toBe(409);
    expect((await locked.json() as any).error.code).toBe('agent_locked');
  });
});
