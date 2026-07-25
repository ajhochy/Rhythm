import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';

function cloudHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function deviceHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Device ${token}`,
    'Content-Type': 'application/json',
  };
}

describeLive('live E2E — issue #1175 pairing and mobile tool authorization', () => {
  it('uses a public one-time pairing capability and enforces owner/admin tool policy', async () => {
    const parsedUrl = new URL(baseUrl);
    if (
      parsedUrl.hostname !== '127.0.0.1' ||
      parsedUrl.port === '4001' ||
      !parsedUrl.port
    ) {
      throw new Error(
        'Issue #1175 live test requires an explicit isolated 127.0.0.1 non-4001 API URL',
      );
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/') ||
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error(
        'Issue #1175 live test requires an attested isolated sandbox database',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    const adminToken = randomUUID();
    const staffToken = randomUUID();
    const now = new Date().toISOString();
    let adminId: number | null = null;
    let staffId: number | null = null;
    let proposalId: string | null = null;
    let workspaceId: number | null = null;
    const deviceIds: string[] = [];
    const hasTable = (name: string): boolean =>
      Boolean(
        db
          .prepare(
            `SELECT 1 FROM sqlite_master
             WHERE type = 'table' AND name = ?`,
          )
          .get(name),
      );
    try {
      const insertUser = db.prepare(
        `INSERT INTO users (name, email, google_sub)
         VALUES (?, ?, ?)`,
      );
      adminId = Number(
        insertUser.run(
          'Issue 1175 Admin',
          `issue-1175-admin-${runId}@example.com`,
          `issue-1175-admin-${runId}`,
        ).lastInsertRowid,
      );
      staffId = Number(
        insertUser.run(
          'Issue 1175 Staff',
          `issue-1175-staff-${runId}@example.com`,
          `issue-1175-staff-${runId}`,
        ).lastInsertRowid,
      );
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?), (?, ?, ?)`,
      ).run(
        adminToken,
        adminId,
        expiresAt,
        staffToken,
        staffId,
        expiresAt,
      );
      workspaceId = Number(
        db
          .prepare(
            `INSERT INTO workspaces (name, join_code, created_by, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            'Issue 1175 Live Workspace',
            randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(),
            adminId,
            now,
          ).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO workspace_members
           (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', ?), (?, ?, 'staff', ?)`,
      ).run(workspaceId, adminId, now, workspaceId, staffId, now);

      const health = await fetch(`${baseUrl}/mobile-gateway/health`);
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as { hostId: string };
      expect(healthBody.hostId).toBeTruthy();

      const pair = async (
        sessionToken: string,
        hostileUserId: number,
      ): Promise<{ deviceId: string; deviceToken: string; userId: number }> => {
        const codeResponse = await fetch(
          `${baseUrl}/mobile-gateway/pairing-codes`,
          { method: 'POST', headers: cloudHeaders(sessionToken), body: '{}' },
        );
        expect(codeResponse.status).toBe(201);
        const code = (await codeResponse.json()) as {
          pairingCode: string;
          hostId: string;
        };
        expect(code.hostId).toBe(healthBody.hostId);
        const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: code.pairingCode,
            hostId: code.hostId,
            userId: hostileUserId,
            deviceName: 'Issue 1175 Live iPhone',
          }),
        });
        expect(pairResponse.status).toBe(201);
        const paired = (await pairResponse.json()) as {
          deviceId: string;
          deviceToken: string;
          userId: number;
        };
        deviceIds.push(paired.deviceId);

        const replay = await fetch(`${baseUrl}/mobile-gateway/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: code.pairingCode,
            hostId: code.hostId,
            deviceName: 'Issue 1175 Replay iPhone',
          }),
        });
        expect(replay.status).toBe(409);
        return paired;
      };

      const admin = await pair(adminToken, staffId);
      const staff = await pair(staffToken, adminId);
      expect(admin.userId).toBe(adminId);
      expect(staff.userId).toBe(staffId);

      const scheduleResponse = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-schedules`,
        {
          method: 'POST',
          headers: deviceHeaders(admin.deviceToken),
          body: JSON.stringify({
            name: 'Issue 1175 owned live schedule',
            scheduleType: 'daily',
            scheduledTime: '09:00',
            prompt: 'Run the live owner check.',
            createdByUserId: staffId,
          }),
        },
      );
      expect(scheduleResponse.status).toBe(201);
      const schedule = (await scheduleResponse.json()) as {
        id: string;
        createdByUserId: number;
      };
      expect(schedule.createdByUserId).toBe(adminId);

      const staffList = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-schedules`,
        { headers: deviceHeaders(staff.deviceToken) },
      );
      expect(staffList.status).toBe(200);
      expect(JSON.stringify(await staffList.json())).not.toContain(schedule.id);
      const crossTrigger = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-schedules/${schedule.id}/trigger-now`,
        { method: 'POST', headers: deviceHeaders(staff.deviceToken), body: '{}' },
      );
      expect(crossTrigger.status).toBe(404);

      const staffMemory = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-memory`,
        {
          method: 'POST',
          headers: deviceHeaders(staff.deviceToken),
          body: JSON.stringify({ content: 'Staff must not write global memory' }),
        },
      );
      expect(staffMemory.status).toBe(403);
      const adminMemory = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-memory`,
        {
          method: 'POST',
          headers: deviceHeaders(admin.deviceToken),
          body: JSON.stringify({ content: 'Admin live global memory check' }),
        },
      );
      expect(adminMemory.status).toBe(201);

      proposalId = randomUUID();
      db.prepare(
        `INSERT INTO agent_org_proposals
           (id, kind, risk, status, title, decided_by_user_id, created_at, updated_at)
         VALUES (?, 'live-auth-review', 'high', 'proposed', ?, NULL, ?, ?)`,
      ).run(proposalId, 'Issue 1175 live reviewer identity', now, now);
      const staffReject = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-org-proposals/${proposalId}/reject`,
        {
          method: 'POST',
          headers: deviceHeaders(staff.deviceToken),
          body: JSON.stringify({ decidedByUserId: adminId }),
        },
      );
      expect(staffReject.status).toBe(403);
      const adminReject = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-org-proposals/${proposalId}/reject`,
        {
          method: 'POST',
          headers: deviceHeaders(admin.deviceToken),
          body: JSON.stringify({ decidedByUserId: staffId }),
        },
      );
      expect(adminReject.status).toBe(200);
      expect(
        db
          .prepare(
            'SELECT decided_by_user_id FROM agent_org_proposals WHERE id = ?',
          )
          .get(proposalId),
      ).toEqual({ decided_by_user_id: adminId });

      const removeSchedule = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-schedules/${schedule.id}`,
        { method: 'DELETE', headers: deviceHeaders(admin.deviceToken) },
      );
      expect(removeSchedule.status).toBe(204);
      for (const paired of [admin, staff]) {
        const revoked = await fetch(
          `${baseUrl}/mobile-gateway/devices/${paired.deviceId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Device ${paired.deviceToken}` },
          },
        );
        expect(revoked.status).toBe(204);
      }
    } finally {
      if (proposalId && hasTable('agent_org_proposals')) {
        db.prepare('DELETE FROM agent_org_proposals WHERE id = ?').run(
          proposalId,
        );
      }
      if (deviceIds.length > 0 && hasTable('mobile_devices')) {
        db.prepare(
          `DELETE FROM mobile_devices
           WHERE id IN (${deviceIds.map(() => '?').join(', ')})`,
        ).run(...deviceIds);
      }
      if (hasTable('agent_memory')) {
        db.prepare(
          `DELETE FROM agent_memory
           WHERE content = 'Admin live global memory check'`,
        ).run();
      }
      if (hasTable('mobile_pairing_codes')) {
        db.prepare(
          `DELETE FROM mobile_pairing_codes
           WHERE user_id IN (
             SELECT id FROM users WHERE google_sub LIKE ?
           )`,
        ).run(`issue-1175-%-${runId}`);
      }
      if (workspaceId !== null) {
        db.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(
          workspaceId,
        );
        db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
      }
      db.prepare(
        `DELETE FROM sessions
         WHERE user_id IN (
           SELECT id FROM users WHERE google_sub LIKE ?
         )`,
      ).run(`issue-1175-%-${runId}`);
      db.prepare(
        `DELETE FROM users WHERE google_sub LIKE ?`,
      ).run(`issue-1175-%-${runId}`);
      db.close();
    }
  });
});
