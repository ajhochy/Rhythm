import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const live = process.env.RHYTHM_LIVE_E2E === "1";
const baseUrl = process.env.RHYTHM_LIVE_BASE_URL ?? "http://127.0.0.1:4098";
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? "";

describe.skipIf(!live)("creative platform sandbox fixture", () => {
  it("lists capabilities and rejects a direct unsigned approval request", async () => {
    if (!dbPath.startsWith("/")) {
      throw new Error("Creative platform live test requires RHYTHM_LIVE_DB_PATH");
    }
    const db = new Database(dbPath);
    const sessionId = randomUUID();
    const sdkSessionId = `sdk-creative-platform-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, created_at, updated_at,
          permission_mode, fast_mode, is_system, delegation_depth,
          category, sdk_session_id)
       VALUES (?, ?, 'idle', ?, ?, ?, ?, 'default', 0, 0, 0, 'chat', ?)`,
    ).run(
      sessionId,
      "creative-media",
      process.cwd(),
      "Creative platform live fixture",
      now,
      now,
      sdkSessionId,
    );
    try {
      const list = await fetch(`${baseUrl}/creative-platform`);
      expect(list.status).toBe(200);
      expect((await list.json()) as unknown[]).toHaveLength(7);
      const forged = await fetch(
        `${baseUrl}/creative-platform/media-tools/request-or-start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runtimeContext: {
              sdkSessionId,
              turnId: "turn-creative-platform-forged",
              agentName: "creative-media",
              toolCallId: "call-creative-platform-forged",
            },
          }),
        },
      );
      expect(forged.status).toBe(403);
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM agent_approvals WHERE session_id = ?")
          .get(sessionId),
      ).toEqual({ count: 0 });
    } finally {
      db.prepare("DELETE FROM agent_approvals WHERE session_id = ?").run(
        sessionId,
      );
      db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(sessionId);
      db.close();
    }
  });
});
