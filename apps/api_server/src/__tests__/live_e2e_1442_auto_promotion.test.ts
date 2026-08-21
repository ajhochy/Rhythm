/**
 * D4.4 (#1442) live API behavior. Runs only against tools/dev/sandbox.sh:
 * a real built api_server + fork engine and copied, sanitized SQLite fixture.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertLiveE2EIsolation } from "./_live_e2e_guard";

const LIVE = process.env.RHYTHM_LIVE_E2E === "1";
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? "").replace(/\/$/, "");
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? process.env.DB_PATH ?? "";
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? "";
const confirmation = {
  "X-Rhythm-Auto-Promotion-Confirmation": "enable-auto-promotion",
};

let db: Database.Database;
let userId = 0;
let token = "";

function now(): string {
  return new Date().toISOString();
}

function authHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

describeLive("live E2E — D4.4 auto-promotion opt-in", () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(baseUrl);
    if (url.hostname !== "127.0.0.1" || url.port !== "4398") {
      throw new Error("D4.4 live test requires http://127.0.0.1:4398");
    }
    if (
      !dbPath ||
      !sandboxDir.startsWith("/private/tmp/") ||
      resolve(dbPath) !== resolve(sandboxDir, "rhythm.db")
    ) {
      throw new Error(
        "D4.4 live test requires the attested isolated sandbox database",
      );
    }
    expect((await fetch(`${baseUrl}/health`)).ok).toBe(true);
    expect((await fetch("http://127.0.0.1:4397/global/health")).ok).toBe(true);

    db = new Database(dbPath);
    db.pragma("busy_timeout = 5000");
    const suffix = randomUUID();
    userId = Number(
      db
        .prepare(
          "INSERT INTO users (name, email, google_sub, role) VALUES (?, ?, ?, 'admin')",
        )
        .run(
          "D4.4 Live User",
          `d4-1442-${suffix}@example.test`,
          `d4-1442-${suffix}`,
        ).lastInsertRowid,
    );
    token = randomUUID();
    db.prepare(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(token, userId, new Date(Date.now() + 10 * 60_000).toISOString());
    db.prepare(
      `INSERT INTO promotion_trust_state
         (id, total_verified, total_regressions, auto_promotion_enabled, enabled_at,
          trust_threshold, auto_promotion_eligible, updated_at)
       VALUES ('promotion_trust_state', 10, 0, 0, NULL, 10, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         total_verified = 10, total_regressions = 0, auto_promotion_enabled = 0,
         enabled_at = NULL, trust_threshold = 10, auto_promotion_eligible = 1,
         updated_at = excluded.updated_at`,
    ).run(now());
  });

  afterAll(() => {
    if (!db) return;
    db.prepare(
      `UPDATE promotion_trust_state
          SET auto_promotion_enabled = 0, enabled_at = NULL, updated_at = ?
        WHERE id = 'promotion_trust_state'`,
    ).run(now());
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    db.close();
  });

  it("drives the real authenticated API: availability/read -> confirmed enable -> stale regression refusal -> emergency disable", async () => {
    const initial = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      headers: authHeaders(),
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      availability: true,
      state: { autoPromotionEnabled: false, autoPromotionEligible: true },
    });

    const missingConfirmation = await fetch(
      `${baseUrl}/optimizer/auto-promotion`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(missingConfirmation.status).toBe(403);

    const enabled = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      method: "POST",
      headers: authHeaders(confirmation),
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({
      state: { autoPromotionEnabled: true, enabledAt: expect.any(String) },
    });

    // Fixture-only concurrent regression: the next HTTP enable must evaluate
    // this current durable state, not the eligible state the client read.
    db.prepare(
      `UPDATE promotion_trust_state
          SET auto_promotion_enabled = 0, enabled_at = NULL, total_regressions = 1,
              auto_promotion_eligible = 0, updated_at = ?
        WHERE id = 'promotion_trust_state'`,
    ).run(now());
    const staleEnable = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      method: "POST",
      headers: authHeaders(confirmation),
      body: JSON.stringify({ enabled: true }),
    });
    expect(staleEnable.status).toBe(409);

    // Emergency disable remains a real authenticated mutation; it clears the
    // server-owned timestamp rather than accepting a client time.
    const disabled = await fetch(`${baseUrl}/optimizer/auto-promotion`, {
      method: "POST",
      headers: authHeaders(confirmation),
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({
      state: { autoPromotionEnabled: false, enabledAt: null },
    });
  });
});
