import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ENGINE, ObservedApi, expectedRevision, localRows,
  responseFor, assertResponse, OwnedRecords } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Profile = { id: string; label: string; revision: number; systemPrompt: string | null };
type Job = { id: string; status: string; budgetRootId: string | null; targetRef: string;
  finalCandidateId: string | null; qualifiedProposalId: string | null; maxTokens: number; failureReason: string | null };
type Detail = { job: Job; candidates: Array<{ id: string; role: string; configHash: string; changeJson: string }>;
  results: Array<{ candidateId: string; taskKey: string; phase: string; status: string; score: number | null; receiptJson: string }>;
  budget: { maxTokens: number; settledTokens: number; outstandingTokens: number; hasUnknownUsage: boolean } };
type Proposal = { id: string; status: string; kind: string; targetRef: string; changeJson: string;
  preReviewEvaluation: { evaluationId: string; originalHash: string; finalCandidateHash: string; status: string } | null };
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
type WritableDb = { prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): Array<Record<string, unknown>> };
  transaction<T>(fn: () => T): () => T; close(): void };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI Org Reviewer] packaged bounded evaluation qualifies, waits for human approval, then changes real agent behavior';

// No fixture and no explicit model loan means the normal suite reports this
// as unverified; it never opens a packaged app or quietly substitutes routes.
if (!manifestPath || process.env.RHYTHM_FEATURE_MODEL !== '1') {
  unverified(title, () => { throw new Error('UNVERIFIED: exact private fixture and RHYTHM_FEATURE_MODEL=1 are required'); });
} else test(title, async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor).toBeDefined();
  const loan = manifest.syntheticActor.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
  expect(loan && loan.issuedAt <= Date.now() && loan.stopAt - Date.now() >= 300_000 &&
    loan.stopAt <= loan.expires - 1_200_000 && loan.stopAt - loan.issuedAt <= 600_000,
  'UNVERIFIED: a fresh bounded real-model loan is required before any writes').toBe(true);
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number } }>('/auth/me')).toMatchObject({ user: { id: manifest.ownerUserId } });
  const Database = requireApi('better-sqlite3') as new (path: string) => WritableDb;
  expect(realpathSync(manifest.dbPath)).toBe(manifest.dbPath);
  const nonce = randomUUID().replaceAll('-', '').slice(0, 12);
  const profileId = `smoke-review-${nonce}`;
  const label = `[smoke] reviewer heading ${nonce}`;
  const desired = `READY-${nonce}`;
  const wrong = `WRONG-${nonce}`;
  const oldPrompt = `For every response, begin with ${wrong}. Never begin with ${desired}. No tools are needed.`;
  const taskPrompt = `Reply with one short line about today. Begin the line with ${desired}. Do not use tools.`;
  const sessionIds = [`smoke-review-${nonce}-a`, `smoke-review-${nonce}-b`];
  const settingsBefore = await api.json<{ tokenLimit: number; candidateCount: 2 | 3 }>('/agent-org-proposals/evaluations/settings');
  const jobsBefore = new Set((await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs.map(job => job.id));
  const catalog = await api.json<Array<{ provider: string; modelId: string; authorized: boolean }>>('/agents/models/catalog/full');
  expect(catalog.some(row => row.provider === 'anthropic' && row.modelId === 'claude-sonnet-4-5' && row.authorized),
    'UNVERIFIED: the exact Anthropic evaluation model must be authorized').toBe(true);
  const scheduleRows = await api.json<Array<{ id: string; name: string; prompt: string; agentConfigId: string;
    agentKind: string; allowedMcpsJson: string | null; allowedSkillsJson: string | null }>>('/agent-schedules');
  const seededReviewer = scheduleRows.find(row => row.name === 'Org Reviewer' && row.agentConfigId === 'org-reviewer');
  expect(seededReviewer).toBeDefined();
  let reviewerTaskId: string | null = null;
  const afterUse = new OwnedRecords(page, 'sessions', `org-evaluation-${nonce}`);
  let createdProfile = false;
  let settingsWritten = false;
  let evaluationIds: string[] = [];
  let proposalId: string | null = null;
  let runId: string | null = null;
  let primaryError: unknown;
  const evidence: Record<string, unknown> = { sourceRevision: expectedRevision, profileId, ownerUserId: manifest.ownerUserId,
    sourceSessions: sessionIds, reviewerTaskId: null, status: 'unrun' };
  try {
    const scheduleCreated = await api.fetch('/agent-schedules', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `[smoke] Org Reviewer ${nonce}`, description: 'Private bounded evaluation',
        scheduleType: 'weekly', scheduledDay: 1, scheduledTime: '08:30', timezone: 'America/Los_Angeles',
        prompt: seededReviewer!.prompt, agentKind: 'opencode', agentConfigId: 'org-reviewer', enabled: true,
        allowedMcps: JSON.parse(seededReviewer!.allowedMcpsJson ?? '{}'),
        allowedSkills: JSON.parse(seededReviewer!.allowedSkillsJson ?? '[]') }) });
    expect(scheduleCreated.status).toBe(201);
    const ownedReviewer = await scheduleCreated.json() as { id: string; name: string; createdByUserId: number };
    expect(ownedReviewer).toMatchObject({ name: `[smoke] Org Reviewer ${nonce}`, createdByUserId: manifest.ownerUserId });
    reviewerTaskId = ownedReviewer.id;
    evidence.reviewerTaskId = reviewerTaskId;
    const created = await api.fetch('/agent-configs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: profileId, label, icon: 'science', modelProvider: 'anthropic', modelId: 'claude-sonnet-4-5',
        systemPrompt: oldPrompt, allowedMcpsJson: '{}', allowedSkillsJson: '[]', corePermissionsJson: '{"*":"deny"}',
        allowedDelegatesJson: '[]', isAgent: true, isManager: false, enabled: true }) });
    expect(created.status).toBe(201);
    createdProfile = true;
    expect(await created.json()).toMatchObject({ id: profileId, label, systemPrompt: oldPrompt });
    const now = new Date().toISOString();
    const db = new Database(manifest.dbPath);
    try {
      db.transaction(() => {
        for (const [index, sessionId] of sessionIds.entries()) {
          const name = `[smoke] heading failure ${nonce} ${index + 1}`;
          db.prepare(`INSERT INTO agent_sessions
            (id,agent_kind,profile_id,status,cwd,name,owner_user_id,category,last_activity_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(sessionId, profileId, profileId, 'error', manifest.fixtureRoot,
            name, manifest.ownerUserId, 'chat', now, now, now);
          for (const [role, text] of [
            ['user', taskPrompt],
            ['assistant', `${wrong}: I ignored the requested heading ${desired}.`],
          ] as const) db.prepare(`INSERT INTO agent_session_messages
            (session_id,role,raw_text,stripped_text,created_at) VALUES (?,?,?,?,?)`).run(sessionId, role, text, text, now);
        }
      })();
    } finally { db.close(); }
    expect(localRows('SELECT id,status,profile_id,owner_user_id FROM agent_sessions WHERE id IN (?,?)', ...sessionIds)).toHaveLength(2);
    const changed = { tokenLimit: 100_000, candidateCount: 2 as const };
    const settingsResponse = await api.fetch('/agent-org-proposals/evaluations/settings', { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(changed) });
    expect(settingsResponse.status).toBe(200);
    settingsWritten = true;
    expect(await settingsResponse.json()).toEqual(changed);

    await page.goto('rhythm://app/index.html#/tools/tasks');
    const row = page.getByTestId(`schedule-${reviewerTaskId}`);
    await expect(row).toBeVisible();
    await row.click();
    const triggered = responseFor(page, 'POST', `/agent-schedules/${reviewerTaskId}/trigger-now`);
    await page.getByTestId('schedule-trigger').click();
    await assertResponse(await triggered, 'POST', `/agent-schedules/${reviewerTaskId}/trigger-now`, 200);
    const deadline = Math.min(Date.now() + 480_000, loan!.stopAt - 20_000);
    let cycle: Job | undefined;
    let child: Job | undefined;
    let observedJobs: Job[] = [];
    while (Date.now() < deadline) {
      observedJobs = (await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs.filter(job => !jobsBefore.has(job.id));
      cycle = observedJobs.find(job => job.budgetRootId === null);
      child = observedJobs.find(job => job.budgetRootId === cycle?.id && job.targetRef === `agent_config:${profileId}`);
      evaluationIds = [cycle?.id, child?.id].filter((id): id is string => Boolean(id));
      if (cycle && cycle.status !== 'qualified') {
        const premature = await api.json<Proposal[]>('/agent-org-proposals?status=proposed');
        expect(premature.filter(item => item.targetRef === `agent_config:${profileId}` &&
          item.preReviewEvaluation?.evaluationId === child?.id),
        'no candidate may enter human review while the whole-run budget is active').toEqual([]);
      }
      if (cycle && ['qualified', 'inconclusive', 'failed'].includes(cycle.status)) break;
      await delay(2_000);
    }
    evidence.cycle = cycle;
    evidence.child = child;
    evidence.jobs = observedJobs;
    const observed = JSON.stringify({ cycle, child, jobs: observedJobs });
    expect(cycle, `Reviewer UI trigger must create a durable whole-run cycle; observed ${observed}`).toBeDefined();
    expect(child, `Real model must diagnose the two owned failure transcripts and target exact profile; observed ${observed}`).toBeDefined();
    evaluationIds = [cycle!.id, child!.id];
    expect(cycle!.status, cycle!.failureReason ?? 'cycle did not qualify').toBe('qualified');
    expect(child!.status, child!.failureReason ?? 'child did not qualify').toBe('qualified');
    const detail = await api.json<Detail>(`/agent-org-proposals/evaluations/${child!.id}`);
    expect(detail.budget.maxTokens).toBe(100_000);
    expect(detail.budget.settledTokens).toBeGreaterThan(0);
    expect(detail.budget.settledTokens).toBeLessThanOrEqual(100_000);
    expect(detail.budget.outstandingTokens).toBe(0);
    expect(detail.budget.hasUnknownUsage).toBe(false);
    expect(detail.candidates.filter(candidate => candidate.role === 'variant')).toHaveLength(2);
    const original = detail.candidates.find(candidate => candidate.role === 'original');
    const final = detail.candidates.find(candidate => candidate.role === 'final');
    expect(original).toBeDefined(); expect(final).toBeDefined();
    const originalValidation = detail.results.filter(result => result.phase === 'validation' && result.candidateId === original!.id);
    const finalValidation = detail.results.filter(result => result.phase === 'validation' && result.candidateId === final!.id);
    expect(originalValidation.length).toBeGreaterThan(0);
    expect(new Set(finalValidation.map(result => result.taskKey))).toEqual(new Set(originalValidation.map(result => result.taskKey)));
    expect(originalValidation.every(result => result.status === 'pass')).toBe(true);
    expect(finalValidation.every(result => result.status === 'pass')).toBe(true);
    const originalSessions = originalValidation.map(result => JSON.parse(result.receiptJson).sessionId);
    const finalSessions = finalValidation.map(result => JSON.parse(result.receiptJson).sessionId);
    expect(originalSessions.every(Boolean)).toBe(true);
    expect(finalSessions.every(Boolean)).toBe(true);
    expect(new Set([...originalSessions, ...finalSessions]).size).toBe(originalSessions.length + finalSessions.length);
    expect(detail.results.filter(result => result.phase === 'probe').length).toBeGreaterThanOrEqual(4);
    proposalId = child!.qualifiedProposalId;
    expect(proposalId).toBeTruthy();
    const queue = await api.json<Proposal[]>('/agent-org-proposals?status=proposed');
    const proposal = queue.find(item => item.id === proposalId);
    expect(proposal).toMatchObject({ id: proposalId, kind: 'refine-config', targetRef: `agent_config:${profileId}`,
      preReviewEvaluation: { evaluationId: child!.id, status: 'qualified', finalCandidateHash: final!.configHash } });
    expect((await api.json<Profile>(`/agent-configs/${profileId}`)).systemPrompt).toBe(oldPrompt);

    await page.goto('rhythm://app/index.html#/tools/review');
    await page.getByRole('region', { name: 'Evaluation activity' }).getByRole('button', { name: 'Refresh evaluations' }).click();
    await page.getByTestId(`evaluation-${child!.id}`).click();
    await expect(page.getByTestId(`evaluation-${child!.id}-details`)).toContainText('qualified');
    await expect(page.getByTestId(`evaluation-${child!.id}-details`)).toContainText(`${detail.budget.settledTokens.toLocaleString()} used`);
    await page.getByTestId('review-refresh').click();
    await page.getByTestId(`proposal-${proposalId}`).click();
    await expect(page.getByTestId(`proposal-${proposalId}-details`)).toContainText(final!.configHash);
    const approved = responseFor(page, 'POST', `/agent-org-proposals/${proposalId}/approve`);
    await page.getByTestId(`proposal-approve-${proposalId}`).click();
    await page.getByTestId('proposal-confirm').click();
    const approval = await approved;
    expect(approval.status()).toBe(200);
    expect(approval.request().postDataJSON()).toMatchObject({ expectedEvaluationId: child!.id,
      finalCandidateHash: final!.configHash, originalHash: proposal!.preReviewEvaluation!.originalHash });
    const changedProfile = await api.json<Profile>(`/agent-configs/${profileId}`);
    expect(changedProfile.systemPrompt).not.toBe(oldPrompt);
    expect(sha256(changedProfile.systemPrompt ?? '')).not.toBe(sha256(oldPrompt));

    // A fresh ordinary session after approval must load the changed profile
    // through the real API + engine. The evaluator's own receipts above are
    // separate execution evidence and cannot substitute for this check.
    await afterUse.open();
    await afterUse.prepare();
    await page.getByTestId('advanced-profile').selectOption(profileId);
    const sessionCreated = responseFor(page, 'POST', '/agent-sessions');
    await page.getByTestId('advanced-create').click();
    const sessionResponse = await sessionCreated;
    await assertResponse(sessionResponse, 'POST', '/agent-sessions', 201);
    const fresh = await sessionResponse.json() as { id: string; name: string; sdkSessionId: string; profileId: string; cwd: string };
    afterUse.remember(fresh);
    expect(fresh.profileId).toBe(profileId);
    const engineSession = await fetch(`${ENGINE}/session/${encodeURIComponent(fresh.sdkSessionId)}?directory=${encodeURIComponent(fresh.cwd)}`);
    expect(engineSession.status).toBe(200);
    const prompt = await api.fetch(`/agent-sessions/${fresh.id}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: taskPrompt }) });
    expect(prompt.status).toBe(202);
    const outputDeadline = Math.min(Date.now() + 60_000, loan!.stopAt - 5_000);
    let output = '';
    while (Date.now() < outputDeadline) {
      const messages = await api.json<{ messages?: Array<{ role: string; strippedText?: string; rawText?: string }> }>(`/agent-sessions/${fresh.id}/messages`);
      output = (messages.messages ?? []).filter(message => message.role === 'assistant').map(message => message.strippedText ?? message.rawText ?? '').join('\n');
      if (output.includes(desired)) break;
      await delay(1_000);
    }
    expect(output).toContain(desired);
    expect(output).not.toContain(wrong);
    evidence.status = 'qualified-approved-used';
    evidence.proposalId = proposalId;
    evidence.realUseSessionId = fresh.id;
    evidence.originalValidationSessions = originalSessions;
    evidence.finalValidationSessions = finalSessions;
  } catch (error) { primaryError = error; throw error; }
  finally {
    const cleanupErrors: string[] = [];
    try { await afterUse.cleanup(); } catch (error) { cleanupErrors.push(`fresh session: ${String(error)}`); }
    try {
      if (settingsWritten) {
        const restored = await api.fetch('/agent-org-proposals/evaluations/settings', { method: 'PATCH',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(settingsBefore) });
        expect(restored.status).toBe(200);
      }
      if (createdProfile) {
        const current = await api.json<Profile>(`/agent-configs/${profileId}`);
        expect(current.label).toBe(label);
        expect((await api.fetch(`/agent-configs/${profileId}`, { method: 'DELETE' })).status).toBe(204);
      }
      const db = new Database(manifest.dbPath);
      try {
        db.transaction(() => {
          const owned = db.prepare('SELECT id,name,owner_user_id FROM agent_sessions WHERE id IN (?,?)').all(...sessionIds);
          for (const row of owned) {
            if (!sessionIds.includes(String(row.id)) || !String(row.name).startsWith(`[smoke] heading failure ${nonce}`) ||
                row.owner_user_id !== manifest.ownerUserId) throw Error('Refusing foreign session cleanup');
          }
          for (const id of sessionIds) db.prepare('DELETE FROM agent_sessions WHERE id=?').run(id);
          if (proposalId) {
            const proposal = db.prepare('SELECT id,target_ref,owner_user_id FROM agent_org_proposals WHERE id=?').all(proposalId)[0];
            if (proposal) {
              if (proposal.target_ref !== `agent_config:${profileId}` || Number(proposal.owner_user_id) !== manifest.ownerUserId)
                throw Error('Refusing foreign proposal cleanup');
              db.prepare('DELETE FROM agent_org_proposals WHERE id=?').run(proposalId);
            }
          }
          for (const id of [...evaluationIds].reverse()) {
            const row = db.prepare('SELECT id,target_ref,owner_user_id FROM org_evaluation_jobs WHERE id=?').all(id)[0];
            if (row && (row.owner_user_id !== manifest.ownerUserId ||
                id !== evaluationIds[0] && row.target_ref !== `agent_config:${profileId}`))
              throw Error('Refusing foreign evaluation cleanup');
            db.prepare('DELETE FROM org_evaluation_results WHERE job_id=?').run(id);
            db.prepare('DELETE FROM org_evaluation_candidates WHERE job_id=?').run(id);
            db.prepare('DELETE FROM org_evaluation_token_reservations WHERE job_id=?').run(id);
            db.prepare('DELETE FROM org_evaluation_jobs WHERE id=?').run(id);
          }
          const ownedRuns = reviewerTaskId
            ? db.prepare('SELECT id,task_id,root_session_id FROM agent_scheduled_task_runs WHERE task_id=?').all(reviewerTaskId)
            : [];
          if (ownedRuns.length > 1) throw Error('Multiple Reviewer runs appeared; refusing ambiguous cleanup');
          for (const row of ownedRuns) {
            runId = String(row.id);
            db.prepare('DELETE FROM agent_scheduled_task_runs WHERE id=? AND task_id=?').run(runId, reviewerTaskId);
            if (row.root_session_id) {
              const session = db.prepare('SELECT id,scheduled_task_id,owner_user_id,category FROM agent_sessions WHERE id=?')
                .all(String(row.root_session_id))[0];
              if (session) {
                if (session.scheduled_task_id !== reviewerTaskId || session.owner_user_id !== manifest.ownerUserId ||
                    session.category !== 'self_improvement') throw Error('Refusing foreign Reviewer session cleanup');
                db.prepare('DELETE FROM agent_sessions WHERE id=?').run(String(row.root_session_id));
              }
            }
          }
        })();
      } finally { db.close(); }
      if (reviewerTaskId) {
        const ownedTask = await api.json<{ id: string; name: string; createdByUserId: number }>(`/agent-schedules/${reviewerTaskId}`);
        expect(ownedTask).toMatchObject({ name: `[smoke] Org Reviewer ${nonce}`, createdByUserId: manifest.ownerUserId });
        expect((await api.fetch(`/agent-schedules/${reviewerTaskId}`, { method: 'DELETE' })).status).toBe(204);
      }
    } catch (error) { cleanupErrors.push(`owned fixture: ${String(error)}`); }
    evidence.reviewerRunId = runId;
    evidence.cleanupErrors = cleanupErrors;
    await testInfo.attach('org-evaluation-journey.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json',
    });
    if (cleanupErrors.length && !primaryError) throw Error(cleanupErrors.join('; '));
  }
});
