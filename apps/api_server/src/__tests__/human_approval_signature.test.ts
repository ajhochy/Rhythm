import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { env } from "../config/env";
import { setDb } from "../database/db";
import { runMigrations } from "../database/migrations";
import {
  AgentApprovalsRepository,
  type AgentApproval,
} from "../repositories/agent_approvals_repository";
import { SessionsRepository } from "../repositories/sessions_repository";
import { UsersRepository } from "../repositories/users_repository";
import {
  installHumanApprovalTestCredentials,
  signHumanApprovalDecision,
  type HumanApprovalTestCredentials,
} from "./helpers/human_approval_test_credentials";
import { startTestServer } from "./helpers/real_server";

type PendingAgentApproval = AgentApproval & { decisionNonce: string };

describe("#1175 signed human approval decisions", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let bearer: string;
  let userId: number;
  let credentials: HumanApprovalTestCredentials;
  let originalAgentLocal: boolean;
  let originalDigest: string;
  let originalPublicKey: string;

  beforeEach(async () => {
    originalAgentLocal = env.agentLocal;
    originalDigest = env.humanApprovalCapabilitySha256;
    originalPublicKey = env.humanApprovalPublicKey;
    env.agentLocal = true;
    credentials = installHumanApprovalTestCredentials();

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    setDb(db);

    const user = new UsersRepository().create({
      name: "Human approver",
      email: "human@example.com",
    });
    userId = user.id;
    const session = await new SessionsRepository().createAsync(user.id);
    bearer = session.token;
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    env.agentLocal = originalAgentLocal;
    env.humanApprovalCapabilitySha256 = originalDigest;
    env.humanApprovalPublicKey = originalPublicKey;
  });

  function createApproval(
    payloadDigest = "a".repeat(64),
  ): PendingAgentApproval {
    const approval = new AgentApprovalsRepository().create({
      sessionId: null,
      agentConfigId: null,
      action: "Send the bound payload",
      preview: "Exact payload preview",
      consequence: "External side effect",
      autoApprove: false,
      payloadDigest,
    });
    if (!approval.decisionNonce) {
      throw new Error("pending approval did not receive a decision nonce");
    }
    return approval as PendingAgentApproval;
  }

  function headers(
    options: {
      bearer?: string;
      capability?: string;
    } = {},
  ): Record<string, string> {
    return {
      ...(options.bearer === undefined
        ? {}
        : { Authorization: `Bearer ${options.bearer}` }),
      ...(options.capability === undefined
        ? {}
        : { "X-Rhythm-Human-Approval": options.capability }),
      "Content-Type": "application/json",
    };
  }

  async function decide(
    approval: PendingAgentApproval,
    status: "approved" | "rejected",
    signature: string,
    requestHeaders = headers({
      bearer,
      capability: credentials.capability,
    }),
  ): Promise<Response> {
    return fetch(`${baseUrl}/agent-approvals/${approval.id}`, {
      method: "PATCH",
      headers: requestHeaders,
      body: JSON.stringify({ status, signature }),
    });
  }

  it("AGENT_LOCAL does not let a raw shell or Device token list or decide", async () => {
    const approval = createApproval();
    const signature = signHumanApprovalDecision(
      credentials,
      approval,
      "approved",
    );

    expect(
      (
        await fetch(`${baseUrl}/agent-approvals`, {
          headers: credentials.capabilityHeader,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/agent-approvals`, {
          headers: headers({ bearer }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await decide(
          approval,
          "approved",
          signature,
          headers({
            bearer: "not-a-session",
            capability: credentials.capability,
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await decide(approval, "approved", signature, {
          Authorization: "Device paired-device-token",
          ...credentials.capabilityHeader,
          "Content-Type": "application/json",
        })
      ).status,
    ).toBe(401);

    const visible = await fetch(`${baseUrl}/agent-approvals?status=pending`, {
      headers: headers({
        bearer,
        capability: credentials.capability,
      }),
    });
    expect(visible.status).toBe(200);
    expect(await visible.json()).toEqual([
      expect.objectContaining({
        id: approval.id,
        decisionNonce: approval.decisionNonce,
      }),
    ]);
  });

  it("rejects a forged signature and makes a valid decision replay-safe", async () => {
    const approval = createApproval();
    const forged = Buffer.from("forged-human-decision").toString("base64");
    expect((await decide(approval, "approved", forged)).status).toBe(403);

    const valid = signHumanApprovalDecision(credentials, approval, "approved");
    const accepted = await decide(approval, "approved", valid);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      status: "approved",
      actor: `user:${userId}`,
      decisionNonce: null,
    });

    // The nonce is consumed atomically with status; replay cannot re-decide.
    expect((await decide(approval, "approved", valid)).status).toBe(404);
  });

  it("rejects payload digest swap and status change substitutions", async () => {
    const approval = createApproval("b".repeat(64));

    const payloadSwap = signHumanApprovalDecision(
      credentials,
      approval,
      "approved",
      { payloadDigest: "c".repeat(64) },
    );
    expect((await decide(approval, "approved", payloadSwap)).status).toBe(403);

    const statusChange = signHumanApprovalDecision(
      credentials,
      approval,
      "approved",
    );
    expect((await decide(approval, "rejected", statusChange)).status).toBe(403);

    const exact = signHumanApprovalDecision(credentials, approval, "rejected");
    expect((await decide(approval, "rejected", exact)).status).toBe(200);
  });

  it("keeps direct development healthy while approval material is unavailable", async () => {
    env.humanApprovalCapabilitySha256 = "";
    env.humanApprovalPublicKey = "";
    const response = await fetch(`${baseUrl}/agent-approvals`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "HUMAN_APPROVAL_UNAVAILABLE" },
    });
  });
});
