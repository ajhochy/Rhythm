import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? process.env.DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';

describeLive('live E2E — issue #1172 agent activity', () => {
  it('issue-1172-c9: live sandbox returns authenticated persisted activity without duplicate pages', async () => {
    assertLiveE2EIsolation();
    if (
      baseUrl !== 'http://127.0.0.1:5298' ||
      engineUrl !== 'http://127.0.0.1:5297'
    ) {
      throw new Error(
        'Issue #1172 live test requires sandbox API 127.0.0.1:5298 and engine 127.0.0.1:5297',
      );
    }
    if (
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/') ||
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error(
        'Issue #1172 live test requires an attested absolute sandbox database',
      );
    }

    const apiHealth = await fetch(`${baseUrl}/health`);
    expect(apiHealth.status).toBe(200);
    const engineHealth = await fetch(`${engineUrl}/global/health`);
    expect(engineHealth.status).toBe(200);

    const db = new Database(dbPath);
    const suffix = randomUUID();
    const userToken = randomUUID();
    const projectId = `live1172-project-${suffix}`;
    const scheduleId = `live1172-schedule-${suffix}`;
    const sessionIds = [
      `live1172-human-${suffix}`,
      `live1172-scheduled-${suffix}`,
      `live1172-cookbook-run-${suffix}`,
    ];
    const researchId = `live1172-research-${suffix}`;
    const webhookId = `live1172-webhook-${suffix}`;
    const cookbookId = `live1172-cookbook-${suffix}`;
    const proposalId = `live1172-proposal-${suffix}`;
    const auditRunId = `live1172-audit-${suffix}`;
    let userId: number | null = null;
    let deviceId: string | null = null;

    try {
      userId = Number(
        db.prepare(`
          INSERT INTO users (name, email, google_sub)
          VALUES (?, ?, ?)
        `).run(
          'Issue 1172 User',
          `issue-1172-${suffix}@example.com`,
          `issue-1172-${suffix}`,
        ).lastInsertRowid,
      );
      db.prepare(`
        INSERT INTO sessions (token, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(
        userToken,
        userId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );
      db.prepare(`
        INSERT INTO projects (id, name, cwd, created_at)
        VALUES (?, ?, ?, ?)
      `).run(projectId, 'Issue 1172 Live', sandboxDir, new Date().toISOString());

      const times = [
        '2026-07-25T10:06:00.000Z',
        '2026-07-25T10:05:00.000Z',
        '2026-07-25T10:04:00.000Z',
        '2026-07-25T10:03:00.000Z',
        '2026-07-25T10:02:00.000Z',
        '2026-07-25T10:01:00.000Z',
      ];
      db.prepare(`
        INSERT INTO agent_sessions
          (id, agent_kind, status, cwd, name, project_id, category,
           is_system, created_at, updated_at)
        VALUES (?, 'opencode', 'working', ?, ?, ?, 'chat', 0, ?, ?)
      `).run(
        sessionIds[0],
        sandboxDir,
        'Live human planning',
        projectId,
        times[0],
        times[0],
      );
      db.prepare(`
        INSERT INTO agent_scheduled_tasks
          (id, name, prompt, agent_config_id, last_run_at, last_run_status,
           created_at, updated_at)
        VALUES (?, ?, 'run live schedule', 'secretary', ?, 'success', ?, ?)
      `).run(scheduleId, 'Live schedule', times[1], times[1], times[1]);
      db.prepare(`
        INSERT INTO agent_sessions
          (id, agent_kind, status, cwd, name, project_id, scheduled_task_id,
           category, is_system, created_at, updated_at)
        VALUES (?, 'opencode', 'closed', ?, ?, ?, ?, 'scheduled', 1, ?, ?)
      `).run(
        sessionIds[1],
        sandboxDir,
        'Live schedule',
        projectId,
        scheduleId,
        times[1],
        times[1],
      );
      db.prepare(`
        INSERT INTO agent_webhook_endpoints
          (id, name, secret, last_triggered_at, trigger_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(
        webhookId,
        'Live webhook',
        `must-not-leak-${suffix}`,
        times[2],
        times[2],
        times[2],
      );
      db.prepare(`
        INSERT INTO agent_research_jobs
          (id, query, status, sources_json, report, error,
           requested_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'synthesizing', '[]', NULL, NULL, ?, ?, ?)
      `).run(
        researchId,
        'Live research',
        userId,
        times[3],
        times[3],
      );
      db.prepare(`
        INSERT INTO agent_cookbook
          (id, title, description, created_at, updated_at)
        VALUES (?, ?, 'Live recipe', ?, ?)
      `).run(cookbookId, 'Live cookbook run', times[4], times[4]);
      db.prepare(`
        INSERT INTO agent_sessions
          (id, agent_kind, status, cwd, name, project_id, category,
           is_system, created_at, updated_at)
        VALUES (?, 'opencode', 'idle', ?, ?, ?, 'chat', 0, ?, ?)
      `).run(
        sessionIds[2],
        sandboxDir,
        'Live cookbook run',
        projectId,
        times[4],
        times[4],
      );
      db.prepare(`
        INSERT INTO agent_org_proposals
          (id, audit_run_id, kind, risk, status, title, created_at, updated_at)
        VALUES (?, ?, 'refine-skill', 'low', 'applied', ?, ?, ?)
      `).run(
        proposalId,
        auditRunId,
        'Live optimizer',
        times[5],
        times[5],
      );

      const invalidDevice = await fetch(
        `${baseUrl}/mobile-gateway/agent-activity`,
        { headers: { Authorization: 'Device invalid-live-token' } },
      );
      expect(invalidDevice.status).toBe(401);

      const firstResponse = await fetch(
        `${baseUrl}/agent-activity?projectId=${encodeURIComponent(projectId)}&limit=2`,
        { headers: { Authorization: `Bearer ${userToken}` } },
      );
      expect(firstResponse.status).toBe(200);
      const first = (await firstResponse.json()) as {
        items: Array<{ id: string; source: string }>;
        nextCursor: string | null;
      };
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));

      const secondUrl =
        `${baseUrl}/agent-activity?projectId=${encodeURIComponent(projectId)}` +
        `&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`;
      const secondResponse = await fetch(secondUrl, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const repeatedResponse = await fetch(secondUrl, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(secondResponse.status).toBe(200);
      expect(repeatedResponse.status).toBe(200);
      const second = (await secondResponse.json()) as typeof first;
      const repeated = (await repeatedResponse.json()) as typeof first;
      expect(second).toEqual(repeated);
      expect(
        new Set([...first.items, ...second.items].map((item) => item.id)).size,
      ).toBe(first.items.length + second.items.length);

      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(codeResponse.status).toBe(201);
      const { pairingCode } = (await codeResponse.json()) as {
        pairingCode: string;
      };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingCode,
          deviceName: 'Issue 1172 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;

      const mobile = await fetch(
        `${baseUrl}/mobile-gateway/agent-activity?source=research`,
        { headers: { Authorization: `Device ${paired.deviceToken}` } },
      );
      expect(mobile.status).toBe(200);
      const mobileBody = await mobile.text();
      expect(mobileBody).toContain(researchId);
      expect(mobileBody).not.toContain(`must-not-leak-${suffix}`);
    } finally {
      db.prepare(
        `DELETE FROM agent_sessions WHERE id IN (?, ?, ?)`,
      ).run(...sessionIds);
      db.prepare('DELETE FROM agent_scheduled_tasks WHERE id = ?').run(
        scheduleId,
      );
      db.prepare('DELETE FROM agent_webhook_endpoints WHERE id = ?').run(
        webhookId,
      );
      db.prepare('DELETE FROM agent_research_jobs WHERE id = ?').run(
        researchId,
      );
      db.prepare('DELETE FROM agent_cookbook WHERE id = ?').run(cookbookId);
      db.prepare('DELETE FROM agent_org_proposals WHERE id = ?').run(
        proposalId,
      );
      const hasMobileSchema = Boolean(
        db.prepare(
          `SELECT 1
           FROM sqlite_master
           WHERE type = 'table' AND name = 'mobile_devices'`,
        ).get(),
      );
      if (deviceId && hasMobileSchema) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      if (userId !== null && hasMobileSchema) {
        db.prepare(
          'DELETE FROM mobile_pairing_codes WHERE user_id = ?',
        ).run(userId);
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(userToken);
      if (userId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
    }
  });
});
