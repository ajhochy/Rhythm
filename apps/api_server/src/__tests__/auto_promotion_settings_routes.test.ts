/**
 * D4.4 (#1442) — real HTTP contract for the durable auto-promotion opt-in.
 *
 * Regression caught: availability, a stale client state, or a UI request can
 * never silently enable promotion. The server owns every gate and timestamp.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

import { createApp } from "../app";
import {
  env,
  isAutoPromotionFeatureAvailable,
} from "../config/env";
import { setDb } from "../database/db";
import { runMigrations } from "../database/migrations";
import { PromotionTrustStateRepository } from "../repositories/promotion_trust_state_repository";
import { SessionsRepository } from "../repositories/sessions_repository";
import { UsersRepository } from "../repositories/users_repository";
import { startTestServer } from "./helpers/real_server";

const confirmationHeader = {
  "X-Rhythm-Auto-Promotion-Confirmation": "enable-auto-promotion",
};

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("D4.4 auto-promotion settings routes", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let ordinaryAuthHeaders: Record<string, string>;
  let systemAuthHeaders: Record<string, string>;
  let repo: PromotionTrustStateRepository;

  beforeEach(async () => {
    vi.stubEnv("AUTO_PROMOTION_FEATURE_AVAILABLE", "true");
    const db = makeDb();
    setDb(db);
    repo = new PromotionTrustStateRepository(db);
    const user = new UsersRepository().create({
      name: "Opt in",
      email: "opt-in@example.com",
      role: "admin",
    });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    };
    const ordinaryUser = new UsersRepository().create({
      name: "Ordinary user",
      email: "ordinary-opt-in@example.com",
    });
    const ordinarySession = await new SessionsRepository().createAsync(
      ordinaryUser.id,
    );
    ordinaryAuthHeaders = {
      Authorization: `Bearer ${ordinarySession.token}`,
      "Content-Type": "application/json",
    };
    const systemUser = new UsersRepository().create({
      name: "System user",
      email: "system-opt-in@example.com",
      role: "system",
    });
    const systemSession = await new SessionsRepository().createAsync(
      systemUser.id,
    );
    systemAuthHeaders = {
      Authorization: `Bearer ${systemSession.token}`,
      "Content-Type": "application/json",
    };
    const server = await startTestServer(createApp());
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer();
  });

  it("issue-1442-c1: config defaults availability to false, never consent", () => {
    expect(
      (env as unknown as { autoPromotionFeatureAvailable?: boolean })
        .autoPromotionFeatureAvailable,
    ).toBe(false);
  });

  it("issue-1442-c1-review: availability requires the explicit flag and a SQLite D2 runtime", () => {
    const availability = isAutoPromotionFeatureAvailable as unknown as (
      flag?: string,
      dbClient?: "sqlite" | "postgres",
    ) => boolean;

    expect(availability(" ", "sqlite")).toBe(false);
    expect(availability("false", "sqlite")).toBe(false);
    expect(availability("true", "sqlite")).toBe(true);
    expect(availability("true", "postgres")).toBe(false);
  });

  it("issue-1442-c2: GET requires local-agent authentication and reports durable off state", async () => {
    const unauthorized = await fetch(`${baseUrl}/optimizer/auto-promotion`);
    expect(unauthorized.status).toBe(401);

    const unauthorizedPost = await fetch(
      `${baseUrl}/optimizer/auto-promotion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(unauthorizedPost.status).toBe(401);

    const response = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      headers: authHeaders,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      availability: true,
      state: {
        autoPromotionEnabled: false,
        enabledAt: null,
        autoPromotionEligible: false,
      },
    });
  });

  it("issue-1442-c2-review: an authenticated ordinary user receives 403 and cannot mutate even with exact confirmation", async () => {
    const read = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      headers: ordinaryAuthHeaders,
    });
    expect(read.status).toBe(403);

    const mutate = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      method: "POST",
      headers: { ...ordinaryAuthHeaders, ...confirmationHeader },
      body: JSON.stringify({ enabled: true }),
    });
    expect(mutate.status).toBe(403);
    expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(false);
  });

  it("issue-1442-c2-review: admin and system roles can read and explicitly enable or disable", async () => {
    await repo.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: 0,
      autoPromotionEligible: true,
    });

    for (const headers of [authHeaders, systemAuthHeaders]) {
      expect(
        (
          await fetch(`${baseUrl}/optimizer/auto-promotion`, { headers })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/optimizer/auto-promotion`, {
            method: "POST",
            headers: { ...headers, ...confirmationHeader },
            body: JSON.stringify({ enabled: true }),
          })
        ).status,
      ).toBe(200);
      expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(true);
      expect(
        (
          await fetch(`${baseUrl}/optimizer/auto-promotion`, {
            method: "POST",
            headers: { ...headers, ...confirmationHeader },
            body: JSON.stringify({ enabled: false }),
          })
        ).status,
      ).toBe(200);
      expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(false);
    }
  });

  it("issue-1442-c3: malformed body, missing/wrong confirmation, unavailable, ineligible, and regressed enables refuse without mutation", async () => {
    const request = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${baseUrl}/optimizer/auto-promotion`, {
        method: "POST",
        headers: { ...authHeaders, ...headers },
        body: JSON.stringify(body),
      });

    expect((await request({})).status).toBe(400);
    expect((await request({ enabled: true })).status).toBe(403);
    expect(
      (
        await request(
          { enabled: true },
          { "X-Rhythm-Auto-Promotion-Confirmation": "wrong" },
        )
      ).status,
    ).toBe(403);
    expect((await request({ enabled: true }, confirmationHeader)).status).toBe(
      409,
    );
    expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(false);

    await repo.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: 1,
      autoPromotionEligible: true,
    });
    expect((await request({ enabled: true }, confirmationHeader)).status).toBe(
      409,
    );
    expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(false);

    vi.stubEnv("AUTO_PROMOTION_FEATURE_AVAILABLE", "false");
    await repo.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: 0,
      autoPromotionEligible: true,
    });
    expect((await request({ enabled: true }, confirmationHeader)).status).toBe(
      409,
    );
    expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(false);
  });

  it("issue-1442-c4: enabling uses server time and disable is an explicit emergency action even when unavailable", async () => {
    await repo.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: 0,
      autoPromotionEligible: true,
    });
    const enable = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      method: "POST",
      headers: { ...authHeaders, ...confirmationHeader },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enable.status).toBe(200);
    const enabled = (await enable.json()) as {
      state: { autoPromotionEnabled: boolean; enabledAt: string | null };
    };
    expect(enabled.state.autoPromotionEnabled).toBe(true);
    expect(Date.parse(enabled.state.enabledAt ?? "")).toBeGreaterThan(0);

    vi.stubEnv("AUTO_PROMOTION_FEATURE_AVAILABLE", "false");
    const missingDisableConfirmation = await fetch(
      `${baseUrl}/optimizer/auto-promotion`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(missingDisableConfirmation.status).toBe(403);
    expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(true);

    const disable = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      method: "POST",
      headers: { ...authHeaders, ...confirmationHeader },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);
    expect(await disable.json()).toMatchObject({
      availability: false,
      state: { autoPromotionEnabled: false, enabledAt: null },
    });
  });

  it("issue-1442-c5: a stale eligible read cannot enable after a regression arrives", async () => {
    await repo.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: 0,
      autoPromotionEligible: true,
    });
    const read = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      headers: authHeaders,
    });
    expect(await read.json()).toMatchObject({
      state: { autoPromotionEligible: true },
    });

    await repo.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: 1,
      autoPromotionEligible: false,
    });
    const staleEnable = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      method: "POST",
      headers: { ...authHeaders, ...confirmationHeader },
      body: JSON.stringify({ enabled: true }),
    });
    expect(staleEnable.status).toBe(409);
    expect((await repo.getSingletonAsync()).autoPromotionEnabled).toBe(false);
  });
});
