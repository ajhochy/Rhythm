import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrations';
import { getDb, setDb } from '../../database/db';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../../repositories/tool_safety_reports_repository';
import { promoteQualifiedToolVettingAsync } from '../org_evaluation_external_effects';

const timestamp = '2026-10-21T00:00:00.000Z';
let previousDb: ReturnType<typeof setDb>;
let db: Database.Database;

afterEach(() => {
  setDb(previousDb ?? null);
  db?.close();
});

describe('qualified tool-install safety receipt promotion', () => {
  it('keeps a qualified-looking proposal unapprovable when the final validation has no Docker proof', async () => {
    db = new Database(':memory:');
    runMigrations(db);
    previousDb = setDb(db);
    const proposals = new AgentOrgProposalsRepository(db);
    const changeJson = JSON.stringify({
      toolName: 'test-tool', packageSource: 'test-tool', installMethod: 'npm install',
      testPrompts: ['basic-invocation', 'forbidden-path'],
    });
    const proposal = await proposals.createAsync({ kind: 'tool-install', status: 'proposed',
      title: 'Private tool receipt check', risk: 'high', targetRef: 'agent_config:test', changeJson });
    db.prepare(`INSERT INTO org_evaluation_jobs
      (id,source_audit_run_id,owner_user_id,status,max_tokens,validation_reserve_tokens,
       original_hash,target_ref,target_revision,input_json,final_candidate_id,qualified_proposal_id,created_at,updated_at)
      VALUES ('tool-eval',NULL,NULL,'qualified',100000,20000,?,'agent_config:test','0','{}','final',?,?,?)`)
      .run('a'.repeat(64), proposal.id, timestamp, timestamp);
    db.prepare(`INSERT INTO org_evaluation_candidates
      (id,job_id,role,ordinal,kind,target_ref,config_hash,effective_config_json,
       change_json,parent_candidate_ids_json,created_at)
      VALUES ('final','tool-eval','final',0,'tool-install','agent_config:test',?,'{}',?,'[]',?)`)
      .run('b'.repeat(64), changeJson, timestamp);

    await expect(promoteQualifiedToolVettingAsync({ proposalId: proposal.id, evaluationId: 'tool-eval' }))
      .rejects.toThrow('no immutable Docker vetting receipt');
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('pending');
    expect(await new ToolSafetyReportsRepository(getDb()).findByProposalIdAsync(proposal.id)).toBeNull();
  });
});
