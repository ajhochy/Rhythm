import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Org Reviewer bounded run admission', () => {
  let db: Database.Database | null = null;
  let previousDb: ReturnType<typeof import('../database/db')['setDb']>;

  afterEach(async () => {
    const { setDb } = await import('../database/db');
    setDb(previousDb ?? null);
    db?.close();
    vi.resetModules();
  });

  it('records a real self-improvement session and fails closed before any unbounded engine turn', async () => {
    vi.resetModules();
    const { runMigrations } = await import('../database/migrations');
    const { setDb } = await import('../database/db');
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { AgentSessionsRepository } = await import('../repositories/agent_sessions_repository');
    const { run } = await import('../services/agent_runner');
    db = new Database(':memory:');
    runMigrations(db);
    previousDb = setDb(db);
    new AgentConfigsRepository().insert({ id: 'org-reviewer', label: 'Reviewer fixture', icon: 'shield',
      modelProvider: 'anthropic', modelId: 'claude-sonnet-4-5', allowedMcpsJson: '{}' });
    const result = await run({ prompt: 'This prompt must not start the normal parent model turn',
      agentConfigId: 'org-reviewer', ownerUserId: null });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/least-privilege/);
    const session = new AgentSessionsRepository().findById(result.sessionId);
    expect(session).toMatchObject({ profileId: 'org-reviewer', category: 'self_improvement',
      isSystem: true, status: 'error', sdkSessionId: null, permissionMode: 'default' });
  });

  it('passes the stored fourteen-day lookback into the owner-scoped review context before model work', async () => {
    vi.resetModules();
    const { runMigrations } = await import('../database/migrations');
    const { setDb } = await import('../database/db');
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { OrgReviewerService } = await import('../services/org_reviewer_service');
    const { saveOrgEvaluationSettingsAsync } = await import('../services/org_evaluation_settings');
    const { runOrgEvaluationReview } = await import('../services/org_evaluation_review_runner');
    db = new Database(':memory:');
    runMigrations(db);
    previousDb = setDb(db);
    new AgentConfigsRepository().insert({ id: 'org-reviewer', label: 'Reviewer fixture', icon: 'shield',
      modelProvider: 'anthropic', modelId: 'claude-sonnet-4-5', allowedMcpsJson: '{}' });
    await saveOrgEvaluationSettingsAsync({ tokenLimit: 100_000, candidateCount: 2, lookbackDays: 14 });
    vi.spyOn(OrgReviewerService.prototype, 'assertServerEvaluationProfile').mockImplementation(() => {});
    vi.spyOn(OrgReviewerService.prototype, 'assertServerEvaluationTask').mockResolvedValue(undefined);
    const context = vi.spyOn(OrgReviewerService.prototype, 'evaluationContext')
      .mockRejectedValue(new Error('stopped after bounded context selection'));
    const result = await runOrgEvaluationReview({ prompt: 'Review known older failures',
      agentConfigId: 'org-reviewer', ownerUserId: null });
    expect(result.status).toBe('error');
    expect(result.error).toContain('stopped after bounded context selection');
    expect(context).toHaveBeenCalledWith(null, 14);
    vi.restoreAllMocks();
  });
});
