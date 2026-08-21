/**
 * D1.1 (#1426) — ToolSafetyReportsRepository: create + find-by-proposal-id,
 * dual-engine parity guard is `skill_schema_parity.test.ts`. This file only
 * exercises SQLite (the in-process better-sqlite3 engine); the Postgres
 * branch is structurally identical (same column set, same query shape) and
 * is covered indirectly by the parity test.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { AgentOrgProposalsRepository } from '../agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../tool_safety_reports_repository';

let db: Database.Database;
let proposalsRepo: AgentOrgProposalsRepository;
let repo: ToolSafetyReportsRepository;

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  proposalsRepo = new AgentOrgProposalsRepository(db);
  repo = new ToolSafetyReportsRepository(db);
  await proposalsRepo.createAsync({
    id: 'proposal-1',
    kind: 'tool-install',
    risk: 'high',
    title: 'install example-tool',
    status: 'proposed',
  });
});

describe('D1.1 ToolSafetyReportsRepository', () => {
  it('creates a report carrying every required field', async () => {
    const created = await repo.createAsync({
      proposalId: 'proposal-1',
      toolName: 'example-tool',
      toolVersion: '1.2.3',
      packageSource: 'npm:example-tool',
      installMethod: 'npm install',
      sandboxDurationMs: 4200,
      testPromptsRunCount: 3,
      forbiddenPathViolationsJson: JSON.stringify([]),
      networkCallsObservedJson: JSON.stringify([{ host: 'example.com', count: 2 }]),
      fileSystemWritesObservedJson: JSON.stringify([{ path: '/tmp/out', count: 1 }]),
      credentialAccessAttemptsCount: 0,
      verdict: 'safe',
      evidenceJson: JSON.stringify({ sha256: 'abc' }),
    });

    expect(created.id).toBeTruthy();
    expect(created.proposalId).toBe('proposal-1');
    expect(created.toolName).toBe('example-tool');
    expect(created.toolVersion).toBe('1.2.3');
    expect(created.packageSource).toBe('npm:example-tool');
    expect(created.installMethod).toBe('npm install');
    expect(created.sandboxDurationMs).toBe(4200);
    expect(created.testPromptsRunCount).toBe(3);
    expect(created.verdict).toBe('safe');
    expect(created.reason).toBeNull();
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();
  });

  it('findByProposalIdAsync returns the most recently created report for that proposal', async () => {
    await repo.createAsync({
      proposalId: 'proposal-1',
      toolName: 'example-tool',
      packageSource: 'npm:example-tool',
      installMethod: 'npm install',
      sandboxDurationMs: 100,
      testPromptsRunCount: 0,
      verdict: 'unknown',
      reason: 'sandbox_unavailable',
    });
    const second = await repo.createAsync({
      proposalId: 'proposal-1',
      toolName: 'example-tool',
      packageSource: 'npm:example-tool',
      installMethod: 'npm install',
      sandboxDurationMs: 500,
      testPromptsRunCount: 2,
      verdict: 'safe',
    });

    const found = await repo.findByProposalIdAsync('proposal-1');
    expect(found?.id).toBe(second.id);
    expect(found?.verdict).toBe('safe');
  });

  it('findByProposalIdAsync returns null when no report exists', async () => {
    expect(await repo.findByProposalIdAsync('no-such-proposal')).toBeNull();
  });

  it('rejects an unknown verdict at the database layer (closed CHECK constraint)', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO tool_safety_reports
           (id, proposal_id, tool_name, package_source, install_method, sandbox_duration_ms,
            test_prompts_run_count, verdict, created_at, updated_at)
         VALUES ('report-x','proposal-1','example-tool','npm:example-tool','npm install',100,
                 0,'super-safe','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z')`,
      ).run();
    }).toThrow();
  });

  it('redacts secret-shaped text out of evidenceJson before persisting', async () => {
    const created = await repo.createAsync({
      proposalId: 'proposal-1',
      toolName: 'example-tool',
      packageSource: 'npm:example-tool',
      installMethod: 'npm install',
      sandboxDurationMs: 100,
      testPromptsRunCount: 1,
      verdict: 'conditional',
      evidenceJson: JSON.stringify({
        note: 'token Bearer sk-abcdefghijklmnopqrstuvwx observed in sandbox output',
      }),
    });
    expect(created.evidenceJson).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(created.evidenceJson).toContain('[redacted]');
  });
});
