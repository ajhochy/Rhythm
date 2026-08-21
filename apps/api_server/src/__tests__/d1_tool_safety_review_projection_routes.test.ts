import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { startTestServer } from './helpers/real_server';

const VETTING_FAILURE_REASONS = [
  'sandbox_unavailable',
  'invalid_scenario_ids',
  'unsafe_tool_name',
  'unsafe_package_source',
  'unsupported_install_method',
  'sandbox_start_failed',
  'sandbox_terminated',
  'sandbox_evidence_incomplete',
  'sandbox_candidate_failed',
  'sandbox_observer_unavailable',
  'sandbox_error',
] as const;

describe('D1.5 tool safety review projection route', () => {
  let db: Database.Database;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'true');
    const [{ runMigrations }, { setDb }, { createApp }] = await Promise.all([
      import('../database/migrations'), import('../database/db'), import('../app'),
    ]);
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['sandbox-vetted', 'pending', 'rejected', 'approved', 'failed', 'applied'])(
    'returns the same closed projection for tool-install status %s',
    async (status) => {
      // Regression: list used to emit raw change_json and every report blob,
      // making a browser client a second arbitrary-payload boundary.
      const proposalId = `tool-${status}`;
      db.prepare(`INSERT INTO agent_org_proposals
        (id, kind, risk, external, status, title, change_json, revision, created_at, updated_at)
        VALUES (?, 'tool-install', 'high', 1, ?, 'Install tool', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .run(proposalId, status, JSON.stringify({ toolName: 'raw-tool', packageSource: 'raw:source', token: 'sk-not-for-ui' }));
      db.prepare(`INSERT INTO tool_safety_reports
        (id, proposal_id, tool_name, package_source, install_method, sandbox_duration_ms,
         test_prompts_run_count, forbidden_path_violations_json, network_calls_observed_json,
         file_system_writes_observed_json, credential_access_attempts_count, verdict, reason, evidence_json)
        VALUES (?, ?, 'safe-tool', 'npm:safe-tool', 'npm install', 17, 2,
         '["ssh-private-key"]', '[{"host":"registry.npmjs.org","count":2}]',
         '[{"path":"/workspace/cache","count":1}]', 0, 'conditional',
         'sandbox_candidate_failed', '{"stdout":"raw output", "token":"sk-not-for-ui"}')`)
        .run(`report-${status}`, proposalId);

      const response = await fetch(`${baseUrl}/agent-org-proposals?status=${status}`);
      expect(response.status).toBe(200);
      const [body] = await response.json() as Array<Record<string, unknown>>;

      expect(body.changeJson).toBeNull();
      expect(body).not.toHaveProperty('toolSafetyReport');
      expect(JSON.stringify(body)).not.toContain('sk-not-for-ui');
      expect(JSON.stringify(body)).not.toContain('raw output');
      expect(body.toolSafety).toEqual({
        state: 'ready',
        tool: { name: 'safe-tool', packageSource: 'npm:safe-tool' },
        verdict: 'conditional',
        forbiddenPathViolations: [{ label: 'ssh-private-key', count: 1 }],
        networkCalls: [{ host: 'registry.npmjs.org', count: 2 }],
        workspaceWriteCount: 1,
        credentialAccessAttemptsCount: 0,
        scenarioAttemptsCount: 2,
        sandboxDurationMs: 17,
        reason: 'sandbox_candidate_failed',
      });
    },
  );

  it.each(VETTING_FAILURE_REASONS)(
    'projects the fixed vetting reason %s without exposing the durable report',
    async (reason) => {
      const proposalId = `fixed-reason-${reason}`;
      db.prepare(`INSERT INTO agent_org_proposals
        (id, kind, risk, external, status, title, change_json, revision, created_at, updated_at)
        VALUES (?, 'tool-install', 'high', 1, 'pending', 'Install tool', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .run(proposalId, JSON.stringify({ token: 'sk-not-for-ui' }));
      db.prepare(`INSERT INTO tool_safety_reports
        (id, proposal_id, tool_name, package_source, install_method, sandbox_duration_ms,
         test_prompts_run_count, forbidden_path_violations_json, network_calls_observed_json,
         file_system_writes_observed_json, credential_access_attempts_count, verdict, reason, evidence_json)
        VALUES (?, ?, 'safe-tool', 'npm:safe-tool', 'npm install', 17, 2,
         '[]', '[]', '[]', 0, 'unknown', ?, '{"raw":"sk-not-for-ui"}')`)
        .run(`report-${reason}`, proposalId, reason);

      const response = await fetch(`${baseUrl}/agent-org-proposals?status=pending`);
      expect(response.status).toBe(200);
      const [body] = await response.json() as Array<Record<string, unknown>>;

      expect(body.toolSafety).toMatchObject({
        state: 'ready',
        verdict: 'unknown',
        reason,
      });
      expect(JSON.stringify(body)).not.toContain('sk-not-for-ui');
    },
  );

  it('fails closed to an unknown malformed projection without raw report JSON', async () => {
    db.prepare(`INSERT INTO agent_org_proposals
      (id, kind, risk, external, status, title, change_json, revision, created_at, updated_at)
      VALUES ('malformed', 'tool-install', 'high', 1, 'pending', 'Install tool', '{"token":"sk-not-for-ui"}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO tool_safety_reports
      (id, proposal_id, tool_name, package_source, install_method, sandbox_duration_ms,
       test_prompts_run_count, forbidden_path_violations_json, network_calls_observed_json,
       file_system_writes_observed_json, credential_access_attempts_count, verdict, reason, evidence_json)
      VALUES ('bad-report', 'malformed', 'unsafe tool; sk-not-for-ui', 'npm:unsafe', 'npm install', -1, 2,
       'not-json', '[]', '[]', 0, 'safe', 'raw reason sk-not-for-ui', '{"stderr":"raw"}')`).run();

    const response = await fetch(`${baseUrl}/agent-org-proposals?status=pending`);
    const [body] = await response.json() as Array<Record<string, unknown>>;
    expect(body.changeJson).toBeNull();
    expect(body.toolSafety).toEqual({ state: 'malformed', verdict: 'unknown' });
    expect(JSON.stringify(body)).not.toContain('sk-not-for-ui');
  });
});
