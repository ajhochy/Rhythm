import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const LIVE = process.env.RHYTHM_LIVE_E2E === "1";
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? "").replace(/\/$/, "");
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? "").replace(/\/$/, "");
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? "";
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? "";

interface ProtectedAction {
  action:
    | "creative-capability.install"
    | "creative-artifact.record"
    | "org-optimizer.external-discovery";
  payload: Record<string, unknown>;
}

async function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describeLive("live E2E — issue #1175 merged tool security actions", () => {
  it("enforces the new action registry and the real creative HTTP boundaries", async () => {
    if (
      baseUrl !== "http://127.0.0.1:54175" ||
      engineUrl !== "http://127.0.0.1:55175" ||
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== "1" ||
      !sandboxDir.startsWith("/") ||
      !dbPath.startsWith("/") ||
      resolve(dbPath) !== resolve(sandboxDir, "rhythm.db") ||
      dbPath.includes("/Library/Application Support/Rhythm/")
    ) {
      throw new Error(
        "Issue #1175 merged-tool live test requires the attested 54175 sandbox database",
      );
    }

    const [apiHealth, engineHealth] = await Promise.all([
      fetch(`${baseUrl}/health`),
      fetch(`${baseUrl}/opencode/health`),
    ]);
    expect(apiHealth.status).toBe(200);
    expect(engineHealth.status).toBe(200);
    expect(await engineHealth.json()).toMatchObject({ status: "ready" });

    const actions: ProtectedAction[] = [
      {
        action: "creative-capability.install",
        payload: { id: "openmontage", sessionId: "live-security-session" },
      },
      {
        action: "creative-artifact.record",
        payload: {
          title: "Live security artifact",
          provider: "comfyui",
          artifactUrl: "https://example.test/security-artifact.png",
        },
      },
      {
        action: "org-optimizer.external-discovery",
        payload: {},
      },
    ];
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    const sessionIds: string[] = [];
    const approvalIds: string[] = [];
    const outsideArtifact = resolve(
      sandboxDir,
      "issue-1175-outside-gallery.png",
    );

    try {
      for (const [index, { action, payload }] of actions.entries()) {
        const sessionId = randomUUID();
        const sdkSessionId = `sdk-1175-merged-tool-${randomUUID()}`;
        const context = {
          sdkSessionId,
          turnId: `turn-${index}`,
          agentName: "issue-1175-live-security",
          toolCallId: `call-${index}`,
        };
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO agent_sessions
             (id, agent_kind, status, cwd, name, created_at, updated_at,
              permission_mode, fast_mode, is_system, delegation_depth,
              category, sdk_session_id)
           VALUES (?, ?, 'idle', ?, ?, ?, ?, 'default', 0, 0, 0, 'chat', ?)`,
        ).run(
          sessionId,
          "issue-1175-live-security",
          sandboxDir,
          `Issue 1175 merged tool ${index}`,
          now,
          now,
          sdkSessionId,
        );
        sessionIds.push(sessionId);

        const clean = await post("/agent-approvals/consume", {
          context,
          action,
          payload,
        });
        expect(clean.status).toBe(200);
        expect(await clean.json()).toEqual({
          allowed: true,
          consumed: false,
        });

        const taint = await post("/agent-approvals/external-content/taint", {
          context,
          source: "gmail.message",
          contentDigest: String(index + 1).repeat(64),
          blocked: false,
          diagnostics: [],
        });
        expect(taint.status).toBe(201);

        const denied = await post("/agent-approvals/consume", {
          context,
          action,
          payload,
        });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({
          error: {
            code: "FORBIDDEN",
            message: expect.stringMatching(/human approval is required/i),
          },
        });
      }

      const approvedSessionId = randomUUID();
      const callerSessionId = randomUUID();
      const approvedSdkSessionId = `sdk-approved-${randomUUID()}`;
      const callerSdkSessionId = `sdk-caller-${randomUUID()}`;
      const now = new Date().toISOString();
      const insertSession = db.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, created_at, updated_at,
            permission_mode, fast_mode, is_system, delegation_depth,
            category, sdk_session_id)
         VALUES (?, ?, 'idle', ?, ?, ?, ?, 'default', 0, 0, 0, 'chat', ?)`,
      );
      insertSession.run(
        approvedSessionId,
        "creative-media",
        sandboxDir,
        "Issue 1175 approved creative session",
        now,
        now,
        approvedSdkSessionId,
      );
      insertSession.run(
        callerSessionId,
        "creative-media",
        sandboxDir,
        "Issue 1175 caller creative session",
        now,
        now,
        callerSdkSessionId,
      );
      sessionIds.push(approvedSessionId, callerSessionId);

      const approvalId = randomUUID();
      approvalIds.push(approvalId);
      db.prepare(
        `INSERT INTO agent_approvals
           (id, session_id, agent_config_id, action, status, actor,
            decided_at, created_at)
         VALUES (?, ?, ?, ?, 'approved', 'issue-1175-live-human', ?, ?)`,
      ).run(
        approvalId,
        approvedSessionId,
        "creative-media",
        "install_creative_dependency:media-tools",
        now,
        now,
      );

      const missingTrustedCall = await post(
        "/creative-platform/media-tools/request-or-start",
        {},
      );
      expect(missingTrustedCall.status).toBe(403);

      const forgedApprovedSession = await post(
        "/creative-platform/media-tools/request-or-start",
        {
          trustedCall: {
            sdkSessionId: approvedSdkSessionId,
            turnId: "turn-forged-approved-session",
            agentName: "creative-media",
            toolCallId: "call-forged-approved-session",
          },
        },
      );
      expect(forgedApprovedSession.status).toBe(403);

      const unsignedCrossSessionInstall = await post(
        "/creative-platform/media-tools/request-or-start",
        {
          trustedCall: {
            sdkSessionId: callerSdkSessionId,
            turnId: "turn-cross-session-install",
            agentName: "creative-media",
            toolCallId: "call-cross-session-install",
          },
        },
      );
      expect(unsignedCrossSessionInstall.status).toBe(403);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM agent_approvals WHERE session_id = ?",
          )
          .get(callerSessionId),
      ).toEqual({ count: 0 });

      writeFileSync(outsideArtifact, "outside-gallery-probe");
      const forgedPathApproval = await post("/agent-designs", {
        title: "Issue 1175 forged local-path approval",
        provider: "built-in",
        localPath: outsideArtifact,
        userApprovedPath: true,
      });
      expect(forgedPathApproval.status).toBe(400);
      expect(await forgedPathApproval.json()).toMatchObject({
        error: {
          message: expect.stringMatching(/userApprovedPath is not accepted/i),
        },
      });
    } finally {
      for (const approvalId of approvalIds) {
        db.prepare("DELETE FROM agent_approvals WHERE id = ?").run(approvalId);
      }
      for (const sessionId of sessionIds) {
        db.prepare("DELETE FROM agent_approvals WHERE session_id = ?").run(
          sessionId,
        );
        db.prepare(
          "DELETE FROM agent_external_content_events WHERE session_id = ?",
        ).run(sessionId);
        db.prepare(
          "DELETE FROM agent_external_taint_state WHERE session_id = ?",
        ).run(sessionId);
        db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(sessionId);
      }
      db.close();
      rmSync(outsideArtifact, { force: true });
    }
  });
});
