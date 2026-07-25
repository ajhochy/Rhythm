import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  installHumanApprovalTestCredentials,
} from './helpers/human_approval_test_credentials';
import { startTestServer } from './helpers/real_server';

describe('#1173 webhook secret rotation', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let humanCapabilityHeader: Record<string, string>;
  let originalHumanApprovalConfig: {
    capabilitySha256: string;
    publicKey: string;
  };

  beforeEach(async () => {
    originalHumanApprovalConfig = {
      capabilitySha256: env.humanApprovalCapabilitySha256,
      publicKey: env.humanApprovalPublicKey,
    };
    humanCapabilityHeader =
      installHumanApprovalTestCredentials().capabilityHeader;
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    env.humanApprovalCapabilitySha256 =
      originalHumanApprovalConfig.capabilitySha256;
    env.humanApprovalPublicKey = originalHumanApprovalConfig.publicKey;
  });

  async function pair(email: string): Promise<string> {
    const user = new UsersRepository().create({ name: email, email });
    const session = new SessionsRepository().create(user.id);
    const auth = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      ...humanCapabilityHeader,
    };
    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: auth,
      body: '{}',
    });
    expect(codeResponse.status).toBe(201);
    const { pairingCode, hostId } = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, hostId, deviceName: `${email} phone` }),
    });
    expect(pairResponse.status).toBe(201);
    const { deviceToken } = (await pairResponse.json()) as {
      deviceToken: string;
    };
    expect(deviceToken).toBeTruthy();
    return deviceToken;
  }

  it('rotates only the paired owner secret and returns the replacement exactly once', async () => {
    const owner = await pair('webhook-owner@example.com');
    const other = await pair('webhook-other@example.com');
    const ownerHeaders = {
      Authorization: `Device ${owner}`,
      'Content-Type': 'application/json',
    };
    const createdResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-webhooks`,
      {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ name: 'Mobile webhook' }),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      secret: string;
      url: string;
    };
    expect(created.secret).not.toBe('[redacted]');
    expect(created.url).toBe(`${baseUrl}/agent-webhooks/${created.id}/receive`);

    const denied = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-webhooks/${created.id}/rotate-secret`,
      {
        method: 'POST',
        headers: {
          Authorization: `Device ${other}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );
    expect(denied.status).toBe(404);

    const rotatedResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-webhooks/${created.id}/rotate-secret`,
      { method: 'POST', headers: ownerHeaders, body: '{}' },
    );
    expect(rotatedResponse.status).toBe(200);
    const rotated = (await rotatedResponse.json()) as {
      secret: string;
      url: string;
    };
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.secret).not.toBe('[redacted]');
    expect(rotated.url).toBe(created.url);

    const detail = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-webhooks/${created.id}`,
      { headers: ownerHeaders },
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: created.id,
      secret: '[redacted]',
      url: created.url,
    });
  });
});
