import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  installHumanApprovalTestCredentials,
  type HumanApprovalTestCredentials,
} from './helpers/human_approval_test_credentials';
import { startTestServer } from './helpers/real_server';

describe('#1382 approval lane taxonomy', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let credentials: HumanApprovalTestCredentials;
  let bearer: string;

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const user = new UsersRepository().create({
      name: 'Approval lane test',
      email: 'approval-lanes@example.com',
    });
    bearer = (await new SessionsRepository().createAsync(user.id)).token;
    credentials = installHumanApprovalTestCredentials();
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('adds a lane and reason to every listed approval without changing stored fields', async () => {
    const repository = new AgentApprovalsRepository();
    const taint = repository.create({
      action: 'Authorize email.send',
      securityAction: 'email.send',
      taintId: 'taint-1',
      autoApprove: false,
    });
    const consequential = repository.create({
      action: 'Authorize calendar.update',
      securityAction: 'calendar.update',
      autoApprove: false,
    });
    const approvalGate = repository.create({
      action: 'Schedule a volunteer',
      autoApprove: false,
    });

    const response = await fetch(`${baseUrl}/agent-approvals?status=pending`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...credentials.capabilityHeader,
      },
    });
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Record<string, unknown>[];
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(taint.id)).toEqual({
      ...taint,
      lane: 'hardline',
      laneReason: 'external_data_taint',
    });
    expect(byId.get(consequential.id)).toEqual({
      ...consequential,
      lane: 'hardline',
      laneReason: 'consequential_action',
    });
    expect(byId.get(approvalGate.id)).toEqual({
      ...approvalGate,
      lane: 'approval',
      laneReason: 'approval_gate',
    });
  });
});
