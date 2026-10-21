import express, { type ErrorRequestHandler } from 'express';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { createTrustedMcpTestSigner } from '../__tests__/helpers/trusted_mcp_test_proof';
import { startTestServer } from '../__tests__/helpers/real_server';
import { clearTrustedMcpVerifier, pinTrustedMcpPublicKey } from '../security/trusted_mcp_call';
import { AppError } from '../errors/app_error';
import { MANAGED_TOOLS_LIST, MANAGED_TOOLS_RUN, ManagedToolsService } from '../services/managed_tools_service';
import { createManagedToolsRouter } from './managed_tools_routes';

const identity = { sdkSessionId: 'sdk-managed-route', turnId: 'turn-managed-route',
  agentName: 'signed-agent', toolCallId: 'call-managed-route' };
let db: Database.Database;
let previousDb: ReturnType<typeof setDb>;
let baseURL: string;
let close: () => Promise<void>;
let token: string;
let signer: ReturnType<typeof createTrustedMcpTestSigner>;
const listForCallAsync = vi.fn(async () => ({ tools: [{ proposalId: 'installed-1',
  toolName: 'checked-tool', artifactDigest: 'a'.repeat(64), execution: 'offline-container' }] }));
const runForCallAsync = vi.fn(async () => ({ proposalId: 'installed-1', toolName: 'checked-tool', stdout: 'done' }));

beforeEach(async () => {
  db = new Database(':memory:');
  runMigrations(db);
  previousDb = setDb(db);
  const user = new UsersRepository().create({ name: 'Managed tools route', email: 'managed-route@example.invalid' });
  token = (await new SessionsRepository().createAsync(user.id)).token;
  signer = createTrustedMcpTestSigner();
  pinTrustedMcpPublicKey(signer.publicDocument);
  listForCallAsync.mockClear();
  runForCallAsync.mockClear();
  const service = { listForCallAsync, runForCallAsync } as unknown as ManagedToolsService;
  const app = express();
  app.use(express.json());
  app.use('/managed-tools', createManagedToolsRouter(service));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = error instanceof AppError ? error.statusCode : 500;
    response.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  };
  app.use(errors);
  ({ baseUrl: baseURL, close } = await startTestServer(app));
});

afterEach(async () => {
  await close?.();
  clearTrustedMcpVerifier();
  setDb(previousDb ?? null);
  db?.close();
});

function post(path: 'list' | 'run', body: unknown, authorized = true) {
  return fetch(`${baseURL}/managed-tools/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) });
}

describe('managed tool signed HTTP routes', () => {
  it('passes only verified tool arguments and authenticated owner to the selected service action', async () => {
    const list = signer.signCall(identity, MANAGED_TOOLS_LIST, {});
    const listResponse = await post('list', { trustedCall: list });
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json() as { tools: unknown[] }).tools).toHaveLength(1);
    expect(listForCallAsync).toHaveBeenCalledWith({ context: identity, arguments: {} }, expect.any(Number));
    expect(runForCallAsync).not.toHaveBeenCalled();

    const args = { proposalId: 'installed-1', argv: ['--literal', '$(touch /tmp/never)'], stdin: 'literal stdin' };
    const run = signer.signCall(identity, MANAGED_TOOLS_RUN, args);
    const runResponse = await post('run', { trustedCall: run });
    expect(runResponse.status).toBe(200);
    expect(runForCallAsync).toHaveBeenCalledWith({ context: identity, arguments: args }, expect.any(Number));
    expect(listForCallAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects missing auth, missing proof, extra body fields, swapped tool name, tampering, and replay before service', async () => {
    const valid = signer.signCall(identity, MANAGED_TOOLS_RUN, { proposalId: 'installed-1', argv: [] });
    expect((await post('run', { trustedCall: valid }, false)).status).toBe(401);
    expect((await post('run', {})).status).toBe(403);
    expect((await post('run', { trustedCall: valid, profileId: 'another-agent' })).status).toBe(403);
    expect((await post('list', { trustedCall: valid })).status).toBeGreaterThanOrEqual(400);
    const tampered = signer.signCall(identity, MANAGED_TOOLS_RUN, { proposalId: 'installed-1', argv: [] });
    tampered.arguments.proposalId = 'other-install';
    expect((await post('run', { trustedCall: tampered })).status).toBeGreaterThanOrEqual(400);
    expect(runForCallAsync).not.toHaveBeenCalled();
    const accepted = await post('run', { trustedCall: valid });
    expect(accepted.status).toBe(200);
    expect((await post('run', { trustedCall: valid })).status).toBeGreaterThanOrEqual(400);
    expect(runForCallAsync).toHaveBeenCalledTimes(1);
  });
});
