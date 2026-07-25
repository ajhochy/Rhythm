import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import { startTestServer } from '../__tests__/helpers/real_server';

const apiRoot = join(import.meta.dirname, '..');
const repoRoot = join(apiRoot, '..', '..', '..');

function apiSource(relativePath: string): string {
  return readFileSync(join(apiRoot, relativePath), 'utf8');
}

function repoSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('issue #1175 adversarial follow-up acceptance contract', () => {
  it('issue-1175-c17: AGENT_LOCAL cannot expose the unauthenticated primary API beyond loopback', () => {
    // Regression caught: the shipping Flutter child always sets AGENT_LOCAL,
    // while listen(port) binds every interface and exposes shell/file/PTY
    // routes to the LAN without authentication.
    const server = apiSource('server.ts');
    const env = apiSource('config/env.ts');

    expect(server).toMatch(
      /agentLocal[\s\S]{0,500}(?:127\.0\.0\.1|localhost)[\s\S]{0,500}(?:listen|bind)/,
    );
    expect(server).not.toMatch(/httpServer\.listen\(\s*port\s*\)/);
    expect(server).toMatch(
      /(?:refus|throw|invalid|forbid)[\s\S]{0,500}(?:non-loopback|loopback|127\.0\.0\.1)/i,
    );
    expect(env).toMatch(/AGENT_(?:BIND_)?HOST|API_BIND_HOST/);
    expect(
      apiSource('__tests__/issue_1175_adversarial_live.test.ts'),
    ).toMatch(
      /RHYTHM_LIVE_E2E[\s\S]*(?:IPv4|127\.0\.0\.1)[\s\S]*(?:IPv6|::1)[\s\S]*(?:non.?loopback|networkInterfaces)/i,
    );
  });

  describe('issue-1175-c19: two paired users cannot cross tenant or let staff mutate Mac-global agent policy', () => {
    let db: Database.Database;
    let baseUrl: string;
    let closeServer: () => Promise<void>;

    beforeEach(async () => {
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      setDb(db);
      runMigrations(db);
      ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
    });

    afterEach(async () => {
      await closeServer();
      db.close();
    });

    async function pair(userId: number): Promise<string> {
      const session = new SessionsRepository().create(userId);
      const cloudHeaders = {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      };
      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        { method: 'POST', headers: cloudHeaders, body: '{}' },
      );
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as { pairingCode: string };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: cloudHeaders,
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          deviceName: 'Contract iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      return ((await pairResponse.json()) as { deviceToken: string })
        .deviceToken;
    }

    it('owner-scopes personal CRUD and requires admin for every Mac-global mount', async () => {
      const users = new UsersRepository();
      const owner = users.create({
        name: 'Owner',
        email: `owner-${randomUUID()}@example.com`,
      });
      const staff = users.create({
        name: 'Staff',
        email: `staff-${randomUUID()}@example.com`,
      });
      const workspace = new WorkspaceRepository().create({
        name: 'Contract workspace',
        createdBy: owner.id,
      });
      new WorkspaceRepository().addMemberDirect(workspace.id, staff.id);

      const ownerToken = await pair(owner.id);
      const staffToken = await pair(staff.id);
      const ownerHeaders = {
        Authorization: `Device ${ownerToken}`,
        'Content-Type': 'application/json',
      };
      const staffHeaders = {
        Authorization: `Device ${staffToken}`,
        'Content-Type': 'application/json',
      };

      const createdScheduleResponse = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-schedules`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({
            name: 'Owner-only schedule',
            scheduleType: 'daily',
            scheduledTime: '09:00',
            prompt: 'Owner-only prompt',
          }),
        },
      );
      expect(createdScheduleResponse.status).toBe(201);
      const createdSchedule = (await createdScheduleResponse.json()) as {
        id: string;
      };

      const staffSchedules = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-schedules`,
        { headers: staffHeaders },
      );
      expect(staffSchedules.status).toBe(200);
      expect(await staffSchedules.json()).toEqual([]);
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        const crossTenant = await fetch(
          `${baseUrl}/mobile-gateway/tools/agent-schedules/${createdSchedule.id}`,
          {
            method,
            headers: staffHeaders,
            body:
              method === 'PATCH'
                ? JSON.stringify({ enabled: false })
                : undefined,
          },
        );
        expect(
          crossTenant.status,
          `${method} must not disclose or mutate another user's schedule`,
        ).toBe(404);
      }

      const globalMounts = [
        '/agent-memory',
        '/agent-configs',
        '/agent-org-proposals',
        '/opencode/skills',
        '/opencode/commands',
      ];
      for (const mount of globalMounts) {
        const denied = await fetch(
          `${baseUrl}/mobile-gateway/tools${mount}`,
          { headers: staffHeaders },
        );
        expect(
          denied.status,
          `ordinary staff must not access Mac-global policy at ${mount}`,
        ).toBe(403);
      }
      const adminConfigs = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-configs`,
        { headers: ownerHeaders },
      );
      expect(adminConfigs.status).toBe(200);
    });
  });

  it('issue-1175-c20: loopback shell and paired-device callers cannot self-approve a human gate', () => {
    // Regression caught: AGENT_LOCAL bypass made PATCH decisions anonymous,
    // the controller trusted body.actor, and the Flutter UI sent no Bearer
    // capability. A model with shell could approve its own pending row.
    const routes = apiSource('routes/agent_approvals_routes.ts');
    const controller = apiSource(
      'controllers/agent_approvals_controller.ts',
    );
    const flutterDataSource = repoSource(
      'apps/desktop_flutter/lib/features/notifications/data/agent_approvals_data_source.dart',
    );
    const flutterAuth = repoSource(
      'apps/desktop_flutter/lib/app/core/auth/auth_session_service.dart',
    );
    const flutterPackage = repoSource(
      'apps/desktop_flutter/pubspec.yaml',
    );

    expect(routes).toMatch(
      /agentApprovalsRouter\.get\(\s*['"]\/['"]\s*,\s*requireAuth/,
    );
    expect(routes).toMatch(
      /agentApprovalsRouter\.patch\(\s*['"]\/:id['"]\s*,\s*requireAuth/,
    );
    expect(controller).toMatch(/req\.auth\?*\.user|req\.auth\.user/);
    expect(controller).not.toMatch(
      /body\.actor|typeof\s+body\.actor|repo\.decide\([^,]+,[^,]+,\s*actor\)/,
    );
    expect(flutterDataSource).toMatch(/AuthSessionStore\.headers/);
    expect(flutterPackage).toMatch(/flutter_secure_storage/);
    const tokenPersistence = flutterAuth.slice(
      flutterAuth.indexOf('Future<void> restoreSession'),
      flutterAuth.indexOf('Future<void> logout'),
    );
    expect(tokenPersistence).toMatch(/FlutterSecureStorage|secureStorage/i);
    expect(tokenPersistence).not.toMatch(
      /SharedPreferences[\s\S]{0,500}(?:session_token|_sessionTokenKey)/,
    );
  });

  it('issue-1175-c21: church-admin message and calendar prompt injection cannot immediately send outbound content', () => {
    // Regression caught: only Gmail reads crossed the taint boundary. The same
    // church-admin role could read attacker-authored thread/calendar text and
    // then send or create messages without approval.
    const boundary = repoSource(
      'apps/mcp_server/src/security/external_content_boundary.ts',
    );
    const messages = repoSource('apps/mcp_server/src/tools/messages.ts');
    const google = repoSource('apps/mcp_server/src/tools/google.ts');
    const churchAdmin = JSON.parse(
      repoSource('.mcp-roles/church-admin.mcp.json'),
    ) as { allowedTools?: string[] };

    expect(boundary).toMatch(/message(?:\.|-)?thread/i);
    expect(boundary).toMatch(/calendar(?:\.events)?/i);
    expect(messages).toMatch(/scanContextContent/);
    expect(messages).toMatch(/recordExternalContentTaint/);
    expect(messages).toMatch(/untrustedContext/);
    expect(messages).toMatch(/trustedSecurityContext\(extra\)/);
    expect(google).toMatch(
      /rhythm_list_calendar_events[\s\S]*scanContextContent[\s\S]*recordExternalContentTaint[\s\S]*untrustedContext/,
    );
    expect(churchAdmin.allowedTools).toEqual(
      expect.arrayContaining([
        'rhythm_list_message_threads',
        'rhythm_list_calendar_events',
        'rhythm_send_message',
      ]),
    );
    expect(
      repoSource(
        'apps/mcp_server/src/security/__tests__/external_content_role_graph.test.ts',
      ),
    ).toMatch(/church-admin[\s\S]*(?:message|calendar)[\s\S]*(?:send|write)/i);
  });

  it('issue-1175-c23: caller-chosen Google clients cannot mint Rhythm sessions', () => {
    // Regression caught: clientId and redirectUri came from the request, and
    // userinfo was accepted without proving the returned identity token was
    // minted for Rhythm or carried the initiating nonce.
    const controller = apiSource('controllers/auth_controller.ts');
    const oauth = apiSource('services/google_oauth_service.ts');
    const env = apiSource('config/env.ts');

    const exchange = controller.slice(
      controller.indexOf('async googleMobileExchange'),
      controller.indexOf('async beginPlanningCenterOAuth'),
    );
    expect(env).toMatch(/GOOGLE_MOBILE_CLIENT_ID/);
    expect(env).toMatch(/GOOGLE_MOBILE_REDIRECT_URI/);
    expect(exchange).not.toMatch(
      /const\s*\{[^}]*\b(?:clientId|redirectUri)\b[^}]*\}\s*=\s*req\.body/,
    );
    expect(exchange).toMatch(
      /exchangeMobileCode\(\{[\s\S]*(?:env\.googleMobileClientId|configuredClientId|mobileOAuthConfig)/,
    );
    expect(exchange).toMatch(/\bnonce\b/);
    expect(oauth).toMatch(/id_token/);
    expect(oauth).toMatch(/\baud\b/);
    expect(oauth).toMatch(/\bazp\b/);
    expect(oauth).toMatch(/\bnonce\b/);
    expect(oauth).toMatch(/\biss(?:uer)?\b/);
    expect(oauth).toMatch(/\bexp(?:iry|ires|iration)?\b/);
    expect(oauth).toMatch(/email_verified/);
    expect(
      apiSource('__tests__/google_mobile_oauth_security.test.ts'),
    ).toMatch(
      /unapproved|foreign[\s\S]*(?:client|audience)[\s\S]*(?:reject|401|403)/i,
    );
  });
});
