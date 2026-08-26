/** Live acceptance evidence for #1479/#1482. Never start servers from this file. */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe.sequential : describe.skip;
const execFileAsync = promisify(execFile);
const RUN_TIMEOUT_MS = 900_000;
const OBSERVED_SESSIONS = 10;

type McpRow = { name: string; status: string; tools: string[] };
type ToolChoice = { serverName: string; toolName: string; callable: string };
type Proposal = {
  id: string;
  auditRunId: string | null;
  kind: string;
  changeJson: string | null;
  targetRef: string | null;
};

function apiUrl(): string {
  return (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
}

function engineUrl(): string {
  return (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

function slug(role: string): string {
  return `scope-live-${role}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

describeLive('issues #1479/#1482 optimizer scope live behavior', () => {
  let db: Database.Database;
  let tool: ToolChoice;
  let secondaryServer: string;

  beforeAll(async () => {
    assertLiveE2EIsolation();
    const apiOrigin = new URL(apiUrl());
    const engine = new URL(engineUrl());
    if (apiOrigin.protocol !== 'http:' || apiOrigin.hostname !== '127.0.0.1' || apiOrigin.port !== '4098') {
      throw new Error('live optimizer scope gate requires API http://127.0.0.1:4098');
    }
    if (engine.protocol !== 'http:' || engine.hostname !== '127.0.0.1' || engine.port !== '4097') {
      throw new Error('live optimizer scope gate requires engine http://127.0.0.1:4097');
    }
    const dbPath = resolve(process.env.DB_PATH ?? '');
    const liveDbPath = resolve(process.env.RHYTHM_LIVE_DB_PATH ?? '');
    const sandboxDbPath = resolve(process.env.RHYTHM_SANDBOX_DIR ?? '', 'rhythm.db');
    if (!process.env.DB_PATH || !process.env.RHYTHM_LIVE_DB_PATH || dbPath !== liveDbPath || dbPath !== sandboxDbPath) {
      throw new Error('DB_PATH and RHYTHM_LIVE_DB_PATH must exactly equal <RHYTHM_SANDBOX_DIR>/rhythm.db');
    }

    const engineToolsResponse = await fetch(`${engineUrl()}/mcp/tools`);
    expect(engineToolsResponse.status).toBe(200);
    const engineTools = await engineToolsResponse.json() as unknown;
    expect(Array.isArray(engineTools)).toBe(true);
    const ids = engineTools as string[];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const mcpResponse = await api('/opencode/mcp');
    expect(mcpResponse.status).toBe(200);
    const rows = await mcpResponse.json() as McpRow[];
    const choices = rows
      .filter((row) => row.status === 'connected' && Array.isArray(row.tools))
      .flatMap((row) => ids
        .filter((id) => id.startsWith(`${row.name}_`))
        .map((id) => ({
          serverName: row.name,
          callable: id,
          toolName: id.slice(row.name.length + 1),
        })))
      .filter((choice) => rows.some(
        (row) => row.name === choice.serverName && row.tools.includes(choice.toolName),
      ))
      .sort((a, b) => b.serverName.length - a.serverName.length);
    expect(choices.length, 'no connected API server mapped to the real engine catalog').toBeGreaterThan(0);
    tool = choices[0];
    const secondary = rows.find((row) => row.status === 'connected' && row.name !== tool.serverName);
    expect(secondary, 'proposal-apply fixture requires a second connected MCP server').toBeTruthy();
    secondaryServer = secondary!.name;
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
  });

  afterAll(() => db?.close());

  function scopeBytes(profileId: string): string | null {
    const row = db.prepare(
      'SELECT allowed_mcps_json AS scope FROM agent_configs WHERE id = ?',
    ).get(profileId) as { scope: string | null } | undefined;
    if (!row) throw new Error(`missing fixture profile ${profileId}`);
    return row.scope;
  }

  function scopeDigest(): { count: number; sha256: string } {
    const rows = db.prepare(
      'SELECT id, allowed_mcps_json AS scope FROM agent_configs ORDER BY id',
    ).all() as Array<{ id: string; scope: string | null }>;
    return {
      count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    };
  }

  async function createProfile(
    id: string,
    allowedMcpsJson: string,
    systemPrompt = 'Optimizer scope live fixture',
  ): Promise<void> {
    const response = await api('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({
        id,
        label: id,
        icon: '',
        command: '',
        enabled: true,
        isAgent: true,
        isManager: false,
        systemPrompt,
        allowedMcpsJson,
        allowedSkillsJson: '[]',
        sessionSelectable: false,
        schedulable: false,
      }),
    });
    expect(response.status, await response.text()).toBe(201);
  }

  async function deleteProfile(id: string): Promise<void> {
    await api(`/agent-configs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  it('rejects phantom writes/applies and exposes a read-only operator drift report', async () => {
    const profileId = slug('phantom');
    const proposalId = randomUUID();
    const phantom = `phantom_${randomUUID().replaceAll('-', '')}`;
    const validScope = JSON.stringify({ [tool.serverName]: [tool.toolName] });
    let created = false;
    try {
      await createProfile(profileId, validScope);
      created = true;
      const roundtrip = await api(`/agent-configs/${encodeURIComponent(profileId)}`);
      expect(roundtrip.status).toBe(200);
      expect((await roundtrip.json() as { allowedMcpsJson: string }).allowedMcpsJson).toBe(validScope);

      const beforeRejectedPatch = scopeBytes(profileId);
      const rejected = await api(`/agent-configs/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          allowedMcpsJson: JSON.stringify({ [tool.serverName]: [phantom] }),
        }),
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toMatch(/unknown MCP tool grant/i);
      expect(scopeBytes(profileId)).toBe(beforeRejectedPatch);

      const accepted = await api(`/agent-configs/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ allowedMcpsJson: validScope }),
      });
      expect(accepted.status).toBe(200);

      // No API can create a proposal row or historical invalid scope. Seed only
      // those producer states, then drive approval and reporting publicly.
      const historicalScope = JSON.stringify({
        [tool.serverName]: [tool.toolName, phantom],
        [secondaryServer]: null,
      });
      db.prepare('UPDATE agent_configs SET allowed_mcps_json = ? WHERE id = ?')
        .run(historicalScope, profileId);
      db.prepare(
        `INSERT INTO agent_org_proposals
          (id, kind, risk, status, title, target_ref, change_json, dedup_key)
         VALUES (?, 'prune-scope', 'high', 'proposed', ?, ?, ?, ?)`,
      ).run(
        proposalId,
        `Prune ${secondaryServer}`,
        `agent_config:${profileId}:mcp:${secondaryServer}`,
        JSON.stringify({ agentConfigId: profileId, field: 'allowedMcpsJson', remove: [secondaryServer] }),
        `scope-live-${proposalId}`,
      );
      const rejectedApproval = await api(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST' });
      expect(rejectedApproval.status).toBe(400);
      expect(await rejectedApproval.text()).toMatch(/unknown MCP tool grant/i);
      expect(scopeBytes(profileId)).toBe(historicalScope);

      const beforeCli = scopeDigest();
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/cli/index.ts', 'mcp-tool-grant-drift', '--engine-url', engineUrl()],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DB_CLIENT: 'sqlite',
            DB_PATH: process.env.RHYTHM_LIVE_DB_PATH,
          },
        },
      );
      const report = JSON.parse(stdout) as Array<{ profileId: string; serverName: string; toolName: string }>;
      expect(report).toContainEqual({ profileId, serverName: tool.serverName, toolName: phantom });
      expect(`${stdout}${stderr}`).not.toContain(validScope);
      expect(scopeDigest()).toEqual(beforeCli);
    } finally {
      db.prepare('DELETE FROM agent_org_proposals WHERE id = ?').run(proposalId);
      if (created) await deleteProfile(profileId);
    }
  }, RUN_TIMEOUT_MS);

  it('keeps exercised/chartered/explicit scopes and proposes only the unused control', async () => {
    const ids = {
      used: slug('used'),
      charter: slug('charter'),
      explicit: slug('explicit'),
      control: slug('control'),
    };
    const profileIds = Object.values(ids);
    const sessionIds: string[] = [];
    let auditRunId: string | null = null;
    try {
      await createProfile(ids.used, JSON.stringify([tool.serverName]));
      await createProfile(
        ids.charter,
        JSON.stringify([tool.serverName]),
        `This charter requires ${tool.serverName.toUpperCase().replaceAll('-', '_')}.`,
      );
      await createProfile(ids.explicit, JSON.stringify({ [tool.serverName]: [tool.toolName] }));
      await createProfile(ids.control, JSON.stringify([tool.serverName]));

      const aged = new Date(Date.now() - 30 * 86_400_000).toISOString();
      for (const id of profileIds) {
        db.prepare('UPDATE agent_configs SET created_at = ? WHERE id = ?').run(aged, id);
        const parentId = randomUUID();
        db.prepare(
          `INSERT INTO agent_sessions
            (id, agent_kind, status, cwd, name, category, is_system, created_at, updated_at)
           VALUES (?, 'scope-live-parent', 'completed', '/tmp', ?, 'chat', 0, ?, ?)`,
        ).run(parentId, `parent-${id}`, aged, aged);
        sessionIds.push(parentId);
        for (let index = 0; index < OBSERVED_SESSIONS; index++) {
          const sessionId = randomUUID();
          const sdkSessionId = `ses_${randomUUID().replaceAll('-', '')}`;
          const sdkMessageId = `msg_${randomUUID().replaceAll('-', '')}`;
          db.prepare(
            `INSERT INTO agent_sessions
              (id, agent_kind, status, cwd, name, sdk_session_id, parent_session_id,
               category, is_system, created_at, updated_at)
             VALUES (?, ?, 'completed', '/tmp', ?, ?, ?, 'chat', 0, ?, ?)`,
          ).run(sessionId, id, `child-${id}-${index}`, sdkSessionId, parentId, aged, aged);
          sessionIds.push(sessionId);
          const parts = id === ids.used && index === 0 ? [{
            id: `prt_${randomUUID().replaceAll('-', '')}`,
            sessionID: sdkSessionId,
            messageID: sdkMessageId,
            type: 'tool',
            callID: `call_${randomUUID().replaceAll('-', '')}`,
            tool: tool.callable,
            state: {
              status: 'completed',
              input: {},
              output: 'ok',
              title: tool.toolName,
              metadata: {},
              time: { start: Date.now() - 1000, end: Date.now() },
            },
          }] : [];
          db.prepare(
            `INSERT INTO agent_session_messages
              (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, created_at)
             VALUES (?, 'output', 'seeded output', 'seeded output', ?, ?, ?)`,
          ).run(sessionId, sdkMessageId, JSON.stringify(parts), aged);
        }
      }

      const before = scopeDigest();
      const runResponse = await api('/agent-org-optimizer/run', {
        method: 'POST',
        body: JSON.stringify({ maxProposalsPerRun: 500, maxLlmCallsPerRun: 0, mode: 'shadow' }),
      });
      if (runResponse.status !== 200) {
        throw new Error(`optimizer run failed (${runResponse.status}): ${await runResponse.text()}`);
      }
      const run = await runResponse.json() as {
        auditRunId: string;
        mode: string;
        skipped?: boolean;
        skippedReason?: string;
      };
      expect(run.skipped ?? false, run.skippedReason).toBe(false);
      expect(run.mode).toBe('shadow');
      auditRunId = run.auditRunId;

      const proposalsResponse = await api('/agent-org-proposals?status=proposed');
      expect(proposalsResponse.status).toBe(200);
      const proposals = (await proposalsResponse.json() as Proposal[])
        .filter((proposal) => proposal.auditRunId === auditRunId)
        .filter((proposal) => profileIds.some((id) =>
          proposal.targetRef?.includes(id) || proposal.changeJson?.includes(id)));
      const tightenIds = proposals
        .filter((proposal) => proposal.kind === 'tighten-scope')
        .flatMap((proposal) => profileIds.filter((id) =>
          proposal.targetRef?.includes(id) || proposal.changeJson?.includes(id)));
      expect(tightenIds).not.toContain(ids.used);
      expect(tightenIds).not.toContain(ids.charter);
      expect(tightenIds).not.toContain(ids.explicit);
      expect(tightenIds).toContain(ids.control);
      expect(scopeDigest()).toEqual(before);
    } finally {
      if (auditRunId) {
        db.prepare('DELETE FROM agent_org_proposals WHERE audit_run_id = ?').run(auditRunId);
      }
      for (const sessionId of sessionIds.reverse()) {
        db.prepare('DELETE FROM agent_session_messages WHERE session_id = ?').run(sessionId);
        db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId);
      }
      for (const id of profileIds) await deleteProfile(id);
    }
  }, RUN_TIMEOUT_MS);
});
