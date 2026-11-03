// Source/build sandbox proof: this browser port does not claim signed bundle qualification.
// The fixed custody runner performs preboot projection; this worker validates its hash-only receipt.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test as unverified } from '@playwright/test';
import { test as paidTest, expect, API, ObservedApi, expectedRevision, responseFor, assertResponse,
  validatePaidOwner, paidFixture, fixtureRoot } from './paid-parity-fixture';
import { readPaidOrgSnapshot as readSnapshot, seedFields, skillSlug,
  type Snapshot, type PaidOrgSeedReceipt } from '../../../../tools/testing/paid_org_snapshot_fixture.mjs';
import { digestArtifact } from '../../../../tools/testing/web_paid_custody.mjs';
import { assertOwnedReviewerSchedule, terminalReviewerScheduleError,
  type ReviewerScheduleState, type ReviewerScheduleRun } from '../packaged/org-evaluation-schedule-terminal';
type Row = Record<string, unknown>;
type Job = { id: string; budgetRootId: string | null; ownerUserId: number | null; status: string;
  targetRef: string; failureReason: string | null; finalCandidateId: string | null; qualifiedProposalId: string | null };
type Detail = { job: Job; candidates: Array<{ id: string; role: string; configHash: string; changeJson: string }>;
  results: Array<{ candidateId: string; phase: string; taskKey: string; status: string; score: number | null; receiptJson: string }>;
  budget: { maxTokens: number; settledTokens: number; outstandingTokens: number; hasUnknownUsage: boolean } };
type Proposal = { id: string; status: string; targetRef: string;
  preReviewEvaluation: { evaluationId: string; status: string; finalCandidateHash: string } | null };
type Db = { pragma(sql: string): unknown; prepare(sql: string): {
  run(...args: unknown[]): unknown; get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
  transaction<T>(action: () => T): () => T; close(): void };

const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const snapshotPath = process.env.RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_PATH;
const snapshotSha = process.env.RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_SHA256;
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[web-parity-118] [AI Org Reviewer] packaged owner snapshot preserves error history without claiming an improvement';
function verifyManagedSkillReadback(snapshot: Snapshot, fixtureRoot: string): { present: number; absent: number } {
  const root = join(fixtureRoot, 'home', '.config', 'opencode', 'skills');
  let present = 0;
  let absent = 0;
  for (const dependency of snapshot.managedSkillDependencies) {
    const path = join(root, skillSlug(dependency.name), 'SKILL.md');
    if (dependency.state === 'absent') {
      if (existsSync(path)) throw new Error('Source-absent managed skill appeared in private engine library');
      absent++;
    } else {
      if (!existsSync(path) || sha256(readFileSync(path)) !== dependency.sha256)
        throw new Error('Private engine managed skill no longer matches the pinned source');
      present++;
    }
  }
  return { present, absent };
}

/** The destination is an already bootstrapped disposable fixture DB, never the source path. */
function importSnapshot(snapshot: Snapshot, dbPath: string, fixtureRoot: string,
  selectedProfileIds: string[], projectedProfileIds: string[]): { readbackHashes: Record<string, string>;
    selectedSessionIds: string[]; pausedRecurring: number; revisionMap: Array<{ id: string; source: number; clone: number }> } {
  const authority = paidFixture();
  if (dbPath !== authority.manifest.dbPath || fixtureRoot !== authority.manifest.fixtureRoot || dbPath === snapshot.sourcePath)
    throw new Error('Actual snapshot import requires the exact disposable runtime DB');
  const Database = requireApi('better-sqlite3') as new (path: string) => Db;
  const workspace = join(fixtureRoot, 'actual-review-workspace');
  mkdirSync(workspace, { mode: 0o700 });
  const db = new Database(dbPath);
  const selected = new Set(selectedProfileIds);
  const projected = new Set(projectedProfileIds);
  const selectedSessions = snapshot.tables.agent_sessions.filter(row => selected.has(String(row.profile_id)));
  const selectedIds = new Set(selectedSessions.map(row => String(row.id)));
  const selectedMessages = snapshot.tables.agent_session_messages.filter(row => selectedIds.has(String(row.session_id)));
  const expected: Record<string, Row[]> = {
    agent_configs: snapshot.tables.agent_configs.map(row => ({ ...row })),
    agent_skills: snapshot.tables.agent_skills,
    agent_scheduled_tasks: snapshot.tables.agent_scheduled_tasks.map(row => ({ ...row,
      // Operational safety only: preserve every other timing/configuration field.
      next_run_at: row.enabled && ['daily', 'weekly', 'monthly', 'cron'].includes(String(row.schedule_type))
        ? '2099-12-31T23:59:59.000Z' : row.next_run_at })),
    agent_cookbook: snapshot.tables.agent_cookbook,
    agent_sessions: selectedSessions.map(row => ({ ...row, cwd: workspace })),
    agent_session_messages: selectedMessages,
  };
  try {
    db.pragma('foreign_keys = ON');
    const controlProfiles = snapshot.excludedControlProfiles.map(id => db.prepare('SELECT * FROM agent_configs WHERE id=?').get(id));
    const controlSchedules = db.prepare("SELECT * FROM agent_scheduled_tasks WHERE agent_config_id='org-reviewer' ORDER BY id").all();
    const columnsFor = (table: string) => new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map(col => col.name));
    const insert = (table: string, row: Row) => {
      const keys = Object.keys(row);
      if (!keys.length || keys.some(key => !/^[a-z_][a-z0-9_]*$/.test(key) || !columnsFor(table).has(key)))
        throw new Error(`Actual review ${table} schema differs from frozen source`);
      db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .run(...keys.map(key => row[key]));
    };
    db.transaction(() => {
      for (const row of expected.agent_configs) {
        const id = String(row.id);
        const existing = db.prepare('SELECT * FROM agent_configs WHERE id=?').get(id);
        if (projected.has(id)) {
          const projection = db.prepare('SELECT projection_state,file_projected_revision FROM agent_profile_projections WHERE profile_id=?').get(id);
          if (!existing || projection?.projection_state !== 'projected' ||
              projection.file_projected_revision !== row.revision ||
              Object.values(seedFields).some(field => existing[field] !== row[field]))
            throw new Error(`Projected actual profile ${id} differs from captured semantics or revision`);
        }
        if (existing) {
          const keys = Object.keys(row).filter(key => key !== 'id' && key !== 'revision');
          if (keys.some(key => !/^[a-z_][a-z0-9_]*$/.test(key) || !columnsFor('agent_configs').has(key)))
            throw new Error('Actual profile schema differs from source');
          db.prepare(`UPDATE agent_configs SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?`)
            .run(...keys.map(key => row[key]), id);
        } else insert('agent_configs', row);
        row.revision = db.prepare('SELECT revision FROM agent_configs WHERE id=?').get(id)!.revision;
      }
      for (const table of ['agent_skills', 'agent_scheduled_tasks', 'agent_cookbook'] as const)
        for (const row of expected[table]) {
          if (table === 'agent_scheduled_tasks' && row.schedule_type === 'once' && row.enabled &&
              typeof row.next_run_at === 'string' && Date.parse(row.next_run_at) <= Date.now())
            throw new Error('An enabled copied one-shot task is due; refuse unrelated dispatch');
          db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);
          insert(table, row);
        }
      for (const table of ['agent_sessions', 'agent_session_messages'] as const)
        for (const row of expected[table]) {
          if (db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id))
            throw new Error('Actual evidence ID collides with fixture history');
          insert(table, row);
        }
      const controlsAfter = snapshot.excludedControlProfiles.map(id => db.prepare('SELECT * FROM agent_configs WHERE id=?').get(id));
      const controlSchedulesAfter = db.prepare("SELECT * FROM agent_scheduled_tasks WHERE agent_config_id='org-reviewer' ORDER BY id").all();
      if (JSON.stringify(controlsAfter) !== JSON.stringify(controlProfiles) ||
          JSON.stringify(controlSchedulesAfter) !== JSON.stringify(controlSchedules))
        throw new Error('Code-owned Reviewer controls changed during actual snapshot import');
      const fk = db.pragma('foreign_key_check') as unknown[];
      if (fk.length) throw new Error('Actual review import created a broken fixture reference');
      for (const [table, rows] of Object.entries(expected)) {
        for (const source of rows) {
          const readback = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(source.id);
          if (!readback || Object.keys(source).some(key => readback[key] !== source[key]))
            throw new Error(`Actual review ${table} readback differs from exact source fields`);
        }
      }
    })();
    return { readbackHashes: Object.fromEntries(Object.entries(expected).map(([table, rows]) =>
      [table, sha256(JSON.stringify(rows.map(row => {
        const readback = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id)!;
        return Object.fromEntries(Object.keys(row).map(key => [key, readback[key]]));
      })))])), selectedSessionIds: [...selectedIds],
      revisionMap: snapshot.tables.agent_configs.map(source => {
        const id = String(source.id);
        const clone = db.prepare('SELECT revision FROM agent_configs WHERE id=?').get(id)!;
        return { id, source: Number(source.revision), clone: Number(clone.revision) };
      }),
      pausedRecurring: expected.agent_scheduled_tasks.filter((row, index) =>
        row.next_run_at !== snapshot.tables.agent_scheduled_tasks[index].next_run_at).length };
  } finally { db.close(); }
}

/** Exercise the ordinary private recovery projection after the copied row's version advances. */
async function resyncSelectedProfiles(snapshot: Snapshot, dbPath: string, selectedIds: string[], api: ObservedApi) {
  const Database = requireApi('better-sqlite3') as new (path: string) => Db;
  const source = new Map(snapshot.tables.agent_configs.map(row => [String(row.id), row]));
  const operational: Array<{ id: string; sourceRevision: number; cloneRevision: number;
    sourceUpdatedAt: unknown; cloneUpdatedAt: unknown }> = [];
  for (const id of selectedIds) {
    const original = source.get(id)!;
    const before = await api.json<{ revision: number; systemPrompt: string | null }>(`/agent-configs/${encodeURIComponent(id)}`);
    if (before.systemPrompt !== original.system_prompt)
      throw new Error(`Selected ${id} prompt drifted before ordinary projection`);
    const resynced = await api.fetch(`/agent-configs/${encodeURIComponent(id)}/resync-agent-file`, { method: 'POST' });
    if (resynced.status !== 200) throw new Error(`Selected ${id} ordinary projection failed (${resynced.status})`);
    const updated = await resynced.json() as { id: string; revision: number; systemPrompt: string | null };
    if (updated.id !== id || updated.revision !== before.revision || updated.systemPrompt !== original.system_prompt)
      throw new Error(`Selected ${id} recovery projection changed the imported semantic version`);
    const db = new Database(dbPath);
    try {
      const row = db.prepare('SELECT * FROM agent_configs WHERE id=?').get(id);
      const projection = db.prepare('SELECT projection_state,file_projected_revision FROM agent_profile_projections WHERE profile_id=?').get(id);
      if (!row || projection?.projection_state !== 'projected' || projection.file_projected_revision !== row.revision ||
          row.revision !== updated.revision || Object.keys(original).some(key =>
            key !== 'revision' && key !== 'updated_at' && row[key] !== original[key]))
        throw new Error(`Selected ${id} semantic row or durable projection differs after ordinary resync`);
      operational.push({ id, sourceRevision: Number(original.revision), cloneRevision: Number(row.revision),
        sourceUpdatedAt: original.updated_at, cloneUpdatedAt: row.updated_at });
    } finally { db.close(); }
  }
  return operational;
}

let seedPlan: { projectedIds: string[]; unprojectedDependencies: string[]; profileIds: string[] } | null = null;
const test = paidTest.extend<{}, { actualProfileSeed: void }>({
  actualProfileSeed: [async ({}, use) => {
    const { manifest, receipt: custody } = paidFixture(true);
    if (!manifest.profileSeedPath) throw new Error('Actual paid snapshot requires its preboot profile seed');
    const profileSeedPath = manifest.profileSeedPath;
    const receiptPath = process.env.RHYTHM_WEB_PAID_ORG_SEED_RECEIPT;
    if (receiptPath !== join(fixtureRoot(), 'paid-org-seed.json'))
      throw new Error('Actual preboot receipt escaped the paid fixture');
    const stat = lstatSync(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.nlink !== 1 ||
        (stat.mode & 0o777) !== 0o600 || stat.size > 16 * 1024 || realpathSync(receiptPath) !== receiptPath)
      throw new Error('Actual preboot receipt is not one private owned file');
    const bytes = readFileSync(receiptPath);
    if (sha256(bytes) !== custody.orgSeedReceiptSha256)
      throw new Error('Actual preboot receipt differs from paid custody');
    const seed = JSON.parse(bytes.toString('utf8')) as PaidOrgSeedReceipt;
    expect(seed).toMatchObject({ schemaVersion: 1, kind: 'web-paid-org-seed-v1', sourceRevision: expectedRevision,
      fixtureRoot: manifest.fixtureRoot, manifestPath, profileSeedPath: manifest.profileSeedPath,
      sourceConfigRoot: custody.sourceRoot, snapshotSha256: snapshotSha, profileIds: ['secretary'], projectedProfileIds: ['secretary'] });
    if (!/^[a-f0-9]{64}$/.test(seed.profileSeedSha256) || !/^[a-f0-9]{64}$/.test(seed.managedSkillsSha256) ||
        sha256(readFileSync(profileSeedPath)) !== seed.profileSeedSha256 ||
        digestArtifact(join(seed.sourceConfigRoot, 'skills')) !== seed.managedSkillsSha256 ||
        !Array.isArray(seed.unprojectedDependencyIds) || seed.unprojectedDependencyIds.some(id => typeof id !== 'string' || seed.projectedProfileIds.includes(id)) ||
        new Set(seed.unprojectedDependencyIds).size !== seed.unprojectedDependencyIds.length)
      throw new Error('Actual preboot projection hashes or dependency metadata changed');
    seedPlan = { profileIds: seed.profileIds, projectedIds: seed.projectedProfileIds, unprojectedDependencies: seed.unprojectedDependencyIds };
    await use();
    if (sha256(readFileSync(receiptPath)) !== custody.orgSeedReceiptSha256 ||
        sha256(readFileSync(profileSeedPath)) !== seed.profileSeedSha256 ||
        digestArtifact(join(seed.sourceConfigRoot, 'skills')) !== seed.managedSkillsSha256)
      throw new Error('Actual preboot receipt or sealed source projection changed during the run');
  }, { scope: 'worker', auto: true }],
});
if (!manifestPath || !snapshotPath || !snapshotSha || process.env.RHYTHM_FEATURE_MODEL !== '1' || process.env.RHYTHM_WEB_PAID_TEST !== '1') {
  unverified(title, () => { throw new Error('UNVERIFIED: paid browser custody, real snapshot path/SHA, and model authorization required'); });
} else test(title, async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const { manifest, loan } = paidFixture();
  expect(loan.issuedAt <= Date.now() && loan.stopAt - Date.now() >= 300_000 &&
    loan.stopAt <= loan.expires - 1_200_000, 'A fresh bounded real-model loan is required').toBe(true);
  const snapshot = readSnapshot(snapshotPath, snapshotSha, manifest.ownerUserId);
  expect(seedPlan, 'The actual profile seed must be validated from preboot paid custody').not.toBeNull();
  const requested = seedPlan!.profileIds;
  expect(requested).toEqual(['secretary']);
  expect(requested.every(id => snapshot.provenance.some(row => row.profileId === id))).toBe(true);
  const selectedProvenance = snapshot.provenance.filter(row => requested.includes(row.profileId));
  const api = new ObservedApi(API);
  expect(await validatePaidOwner(api)).toBe(manifest.ownerUserId);
  const existing = new Set((await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs.map(job => job.id));
  const imported = importSnapshot(snapshot, manifest.dbPath, manifest.fixtureRoot, requested, seedPlan!.projectedIds);
  const managedSkillReadback = verifyManagedSkillReadback(snapshot, manifest.fixtureRoot);
  const reprojection = await resyncSelectedProfiles(snapshot, manifest.dbPath, requested, api);
  for (const row of reprojection) {
    const mapping = imported.revisionMap.find(candidate => candidate.id === row.id)!;
    mapping.clone = row.cloneRevision;
  }
  const settings = await api.json<{ tokenLimit: number; candidateCount: 2 | 3; lookbackDays: 7 | 14 }>('/agent-org-proposals/evaluations/settings');
  expect(settings.tokenLimit, 'The actual run must keep the shared default 1,500,000-token cap').toBe(1_500_000);
  const nonce = randomUUID().slice(0, 8);
  const taskName = `[smoke] Actual Org Reviewer ${nonce}`;
  const report: Record<string, unknown> = { proof: 'source-build-browser-sandbox', signedBundleClaimed: false, sourceRevision: expectedRevision, snapshotSha256: snapshotSha,
    sourceCapturedAt: snapshot.capturedAt, selectedProfileIds: requested,
    selectedProvenance: selectedProvenance.map(({ sessionId, profileId, selectionRole, sourceStatus, sourceCreatedAt, sourceMessageCount, sourceRowsSha256 }) =>
      ({ sessionId, profileId, selectionRole, sourceStatus, sourceCreatedAt, sourceMessageCount, sourceRowsSha256,
        insideReviewerFourteenDays: Date.parse(sourceCreatedAt) >= Date.now() - 14 * 86_400_000 })),
    omissions: snapshot.omissions, managedSkillReadback, importReadbackHashes: imported.readbackHashes,
    importedSessionIds: imported.selectedSessionIds, pausedRecurringSchedules: imported.pausedRecurring,
    projectedProfileIds: seedPlan!.projectedIds, unprojectedDelegateDependencies: seedPlan!.unprojectedDependencies,
    sourceToCloneRevisions: imported.revisionMap,
    selectedProjectionOperations: reprojection,
    historicalSelectionMeaning: 'failure means stored error status; counterexample means non-error status, not a verified successful task',
    outcome: 'unrun' };
  let reviewerTaskId: string | null = null;
  let cycleId: string | null = null;
  let jobIds: string[] = [];
  let proposalIds: string[] = [];
  let settingsWriteAttempted = false;
  let primaryError: unknown;
  try {
    const reviewLoaded = responseFor(page, 'GET', '/agent-org-proposals/evaluations/settings');
    await page.goto('/#/tools/review');
    await assertResponse(await reviewLoaded, 'GET', '/agent-org-proposals/evaluations/settings', 200);
    const settingsRegion = page.getByRole('region', { name: 'Evaluation settings' });
    await expect(settingsRegion).toBeVisible();
    await expect(settingsRegion.getByLabel('Review lookback')).toHaveValue(String(settings.lookbackDays));
    if (settings.lookbackDays !== 14) {
      await settingsRegion.getByLabel('Review lookback').selectOption('14');
      const saved = responseFor(page, 'PATCH', '/agent-org-proposals/evaluations/settings');
      settingsWriteAttempted = true;
      await settingsRegion.getByRole('button', { name: 'Save evaluation settings' }).click();
      const response = await saved;
      await assertResponse(response, 'PATCH', '/agent-org-proposals/evaluations/settings', 200);
      expect(response.request().postDataJSON()).toEqual({ ...settings, lookbackDays: 14 });
    }
    expect(await api.json('/agent-org-proposals/evaluations/settings')).toEqual({ ...settings, lookbackDays: 14 });
    report.evaluationSettings = { ...settings, lookbackDays: 14 };
    const controls = await api.json<Array<{ id: string; name: string; prompt: string; agentConfigId: string;
      agentKind: string; allowedMcpsJson: string | null; allowedSkillsJson: string | null }>>('/agent-schedules');
    const control = controls.find(row => row.name === 'Org Reviewer' && row.agentConfigId === 'org-reviewer');
    expect(control, 'Current code-owned Reviewer control must remain available').toBeDefined();
    const created = await api.fetch('/agent-schedules', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: taskName, description: 'Private actual-owner snapshot review', scheduleType: 'weekly',
        scheduledDay: 1, scheduledTime: '08:30', timezone: 'America/Los_Angeles', prompt: control!.prompt,
        agentKind: 'opencode', agentConfigId: 'org-reviewer', enabled: true,
        allowedMcps: JSON.parse(control!.allowedMcpsJson ?? '{}'),
        allowedSkills: JSON.parse(control!.allowedSkillsJson ?? '[]') }) });
    expect(created.status).toBe(201);
    reviewerTaskId = String((await created.json() as { id: string }).id);
    await page.goto('/#/tools/tasks');
    const row = page.getByTestId(`schedule-${reviewerTaskId}`);
    await expect(row).toBeVisible(); await row.click();
    const triggered = responseFor(page, 'POST', `/agent-schedules/${reviewerTaskId}/trigger-now`);
    await page.getByTestId('schedule-trigger').click();
    await assertResponse(await triggered, 'POST', `/agent-schedules/${reviewerTaskId}/trigger-now`, 200);
    const deadline = Math.min(Date.now() + 480_000, loan.stopAt - 20_000);
    let cycle: Job | undefined;
    let jobs: Job[] = [];
    while (Date.now() < deadline) {
      jobs = (await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs.filter(job => !existing.has(job.id));
      cycle = jobs.find(job => job.budgetRootId === null && job.ownerUserId === manifest.ownerUserId);
      if (cycle) {
        cycleId = cycle.id;
        jobIds = jobs.filter(job => job.id === cycle!.id || job.budgetRootId === cycle!.id).map(job => job.id);
        const proposedDuringCycle = await api.json<Proposal[]>('/agent-org-proposals?status=proposed');
        const leaked = proposedDuringCycle.filter(proposal => jobIds.includes(proposal.preReviewEvaluation?.evaluationId ?? ''));
        if (!['qualified', 'inconclusive', 'failed'].includes(cycle.status))
          expect(leaked, 'No child may queue while the shared cycle is open').toEqual([]);
        if (['qualified', 'inconclusive', 'failed'].includes(cycle.status)) break;
      } else {
        const schedule = await api.json<ReviewerScheduleState>(`/agent-schedules/${reviewerTaskId}`);
        if (assertOwnedReviewerSchedule(schedule, { id: reviewerTaskId, name: taskName, ownerUserId: manifest.ownerUserId })) {
          const runs = await api.json<ReviewerScheduleRun[]>(`/agent-schedules/${reviewerTaskId}/runs?limit=1`);
          throw terminalReviewerScheduleError(schedule, runs);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    expect(cycle, 'UI-triggered Reviewer must create a durable shared-budget cycle').toBeDefined();
    expect(['qualified', 'inconclusive', 'failed']).toContain(cycle!.status);
    const allJobs = (await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs;
    const children = allJobs.filter(job => job.budgetRootId === cycle!.id);
    jobIds = [cycle!.id, ...children.map(job => job.id)];
    const details = await Promise.all(jobIds.map(id => api.json<Detail>(`/agent-org-proposals/evaluations/${id}`)));
    report.cycle = cycle;
    report.evaluationDetails = details;
    const root = details.find(detail => detail.job.id === cycle!.id)!;
    expect(root.budget.maxTokens).toBe(1_500_000);
    expect(root.budget.settledTokens + root.budget.outstandingTokens).toBeLessThanOrEqual(1_500_000);
    if (cycle!.status === 'qualified') {
      expect(root.budget.outstandingTokens).toBe(0);
      expect(root.budget.hasUnknownUsage).toBe(false);
    }
    const frozen = JSON.parse(String((root.job as Job & { inputJson: string }).inputJson)) as {
      context?: { metadata?: { windowDays?: number }; batches?: Array<{
        sessionEvidence?: Array<{ sessionId: string; profileId: string; status: string;
          messages?: Array<{ messageId: string; text: string }> }>;
        profiles?: Array<{ [key: string]: unknown; id: string; targetRevision: string; systemPrompt: string | null;
          model: { providerId: string | null; modelId: string | null }; allowedMcps: unknown;
          allowedSkills: unknown; corePermissions: unknown; allowedDelegates: unknown }>;
        omittedConfigurationSummaries?: boolean }> } };
    expect(frozen.context?.metadata?.windowDays, 'Reviewer must use the selected fourteen-day window').toBe(14);
    const batches = frozen.context?.batches ?? [];
    const evidence = batches.flatMap(batch => batch.sessionEvidence ?? []);
    const sourceSessions = new Map(snapshot.tables.agent_sessions.map(row => [String(row.id), row]));
    const sourceMessages = new Map(snapshot.tables.agent_session_messages.map(row => [String(row.sdk_message_id ?? row.id), row]));
    const expectedRecent = selectedProvenance.filter(item => {
      const source = sourceSessions.get(item.sessionId)!;
      const recentAt = Date.parse(String(source.last_activity_at ?? source.updated_at ?? source.created_at));
      return recentAt >= Date.now() - 14 * 86_400_000 && item.sourceMessageCount > 0;
    });
    for (const item of expectedRecent) {
      const matched = evidence.find(row => row.sessionId === item.sessionId);
      expect(matched, `Actual ${item.selectionRole} ${item.sessionId} must reach the Reviewer`).toBeDefined();
      expect(matched).toMatchObject({ profileId: item.profileId, status: item.sourceStatus });
      expect((matched!.messages ?? []).some(message => sourceMessages.has(message.messageId) &&
        typeof message.text === 'string' && message.text.trim().length > 0),
      `Actual ${item.selectionRole} ${item.sessionId} needs a citable stored message`).toBe(true);
    }
    if (requested.includes('secretary')) {
      const secretaryFailures = expectedRecent.filter(item => item.profileId === 'secretary' && item.selectionRole === 'failure');
      expect(secretaryFailures.length).toBe(2);
      expect(expectedRecent.filter(item => item.profileId === 'secretary' && item.selectionRole === 'counterexample').length).toBe(1);
      expect(batches.some(batch => secretaryFailures.every(failure =>
        batch.sessionEvidence?.some(session => session.sessionId === failure.sessionId))),
      'Both actual Secretary failures must share one complete diagnosis batch').toBe(true);
      // The earlier packaged scan included the session IDs but dropped the
      // useful evidence: a 4,145-character reply and terminal system errors.
      // Derive exact bytes from the private pinned snapshot, never commit them.
      const failureReadback: Array<{ sessionId: string; messageId: string; role: string;
        bytes: number; sha256: string }> = [];
      for (const item of secretaryFailures) {
        const rows = snapshot.tables.agent_session_messages.filter(row => row.session_id === item.sessionId);
        const storedText = (row: Row) => String(row.stripped_text || row.raw_text || '');
        const terminal = [...rows].reverse().find(row => row.role === 'system' && storedText(row).trim());
        const longFailureReplies = rows.filter(row => row.role === 'output' &&
          storedText(row).length > 4_000 && Buffer.byteLength(storedText(row)) <= 8 * 1024 &&
          /\b(?:fail(?:ed|ure)?|error|cancel(?:led|ed|lation)?|timed? out|timeout)\b/i.test(storedText(row)));
        for (const source of [...longFailureReplies, ...(terminal ? [terminal] : [])]) {
          const messageId = String(source.sdk_message_id ?? source.id);
          const text = storedText(source);
          const visible = evidence.filter(session => session.sessionId === item.sessionId)
            .flatMap(session => session.messages ?? []).find(message => message.messageId === messageId);
          expect(visible, `Available failure evidence ${messageId} must reach the diagnosis input`).toBeDefined();
          expect(sha256(visible!.text), `Failure evidence ${messageId} must preserve exact stored bytes`).toBe(sha256(text));
          failureReadback.push({ sessionId: item.sessionId, messageId, role: String(source.role),
            bytes: Buffer.byteLength(text), sha256: sha256(text) });
        }
      }
      expect(failureReadback.some(row => row.role === 'system'), 'Pinned Secretary history must include its terminal error').toBe(true);
      expect(failureReadback.some(row => row.bytes > 4_000), 'Pinned Secretary history must include its previously omitted long failure').toBe(true);
      report.failureEvidenceReadback = failureReadback;
    }
    for (const batch of batches) expect(Buffer.byteLength(JSON.stringify(batch)),
      'Failure evidence must retain the existing model-input byte limit').toBeLessThanOrEqual(23_000);
    report.contextIncludedSessionIds = evidence.map(row => row.sessionId);
    report.contextOmittedProfiles = requested.filter(id => !batches.some(batch =>
      batch.profiles?.some(profile => profile.id === id)) && batches.some(batch =>
      batch.omittedConfigurationSummaries && batch.sessionEvidence?.some(row => row.profileId === id)));
    for (const id of requested) {
      if ((report.contextOmittedProfiles as string[]).includes(id)) continue;
      const profile = batches.flatMap(batch => batch.profiles ?? []).find(row => row.id === id);
      const source = snapshot.tables.agent_configs.find(row => row.id === id)!;
      expect(profile, `Actual ${id} profile summary cannot disappear`).toBeDefined();
      const mapped = imported.revisionMap.find(row => row.id === id)!;
      expect(profile!.targetRevision).toBe(String(mapped.clone));
      expect(profile!.systemPrompt).toBe(typeof source.system_prompt === 'string'
        ? source.system_prompt.slice(0, 4_000) : source.system_prompt);
      expect(profile!.model).toEqual({ providerId: source.model_provider, modelId: source.model_id });
      for (const [parsedField, rawField] of [
        ['allowedMcps', 'allowed_mcps_json'], ['allowedSkills', 'allowed_skills_json'],
        ['corePermissions', 'core_permissions_json'], ['allowedDelegates', 'allowed_delegates_json'],
      ] as const) {
        const summaryRawField = `${parsedField}Json`;
        if (profile![`${summaryRawField}Omitted`] === 'Byte bound') continue;
        expect(profile![summaryRawField], `Actual ${id} ${rawField} bytes must survive context`).toBe(source[rawField]);
        expect(profile![parsedField]).toEqual(source[rawField] === null ? null : JSON.parse(String(source[rawField])));
      }
    }
    report.contextRecentSourceSessionIds = expectedRecent.map(item => item.sessionId);
    report.scanOutcome = { cycleStatus: cycle!.status, cycleReason: cycle!.failureReason,
      contextBatchCount: batches.length, evaluatedTargetCount: children.length,
      diagnosedNoTargets: cycle!.status === 'qualified' && children.length === 0 };
    const proposed = await api.json<Proposal[]>('/agent-org-proposals?status=proposed');
    const linked = proposed.filter(proposal => jobIds.includes(proposal.preReviewEvaluation?.evaluationId ?? ''));
    proposalIds = linked.map(proposal => proposal.id);
    report.linkedProposals = linked;
    for (const detail of details) {
      expect(detail.budget.settledTokens).toBeLessThanOrEqual(detail.budget.maxTokens);
      if (detail.job.status === 'qualified') {
        expect(detail.budget.outstandingTokens).toBe(0);
        expect(detail.budget.hasUnknownUsage).toBe(false);
      }
    }
    for (const proposal of linked) {
      const child = details.find(detail => detail.job.id === proposal.preReviewEvaluation?.evaluationId);
      expect(cycle!.status, 'No proposal may enter review before shared cycle closes qualified').toBe('qualified');
      expect(child?.job.status, 'Only independently qualified children may enter review').toBe('qualified');
      expect(child!.job.qualifiedProposalId).toBe(proposal.id);
      const original = child!.candidates.find(candidate => candidate.role === 'original');
      const final = child!.candidates.find(candidate => candidate.role === 'final');
      expect(original).toBeDefined(); expect(final).toBeDefined();
      expect(proposal.preReviewEvaluation?.finalCandidateHash).toBe(final!.configHash);
      const originals = child!.results.filter(result => result.candidateId === original!.id && result.phase === 'validation');
      const finals = child!.results.filter(result => result.candidateId === final!.id && result.phase === 'validation');
      expect(originals.length).toBeGreaterThan(0);
      expect(new Set(finals.map(result => result.taskKey))).toEqual(new Set(originals.map(result => result.taskKey)));
      expect(finals.every(result => result.status === 'pass' && result.score === 1)).toBe(true);
      expect(finals.some(result => result.score! > (originals.find(other => other.taskKey === result.taskKey)?.score ?? 1))).toBe(true);
    }
    if (cycle!.status !== 'qualified') expect(linked, 'Inconclusive whole-run budget must never publish').toEqual([]);
    report.outcome = linked.length ? 'qualified-improvement-proved' : 'scan-safety-passed-improvement-unqualified';
    report.unqualifiedReasons = details.filter(detail => detail.job.status !== 'qualified').map(detail =>
      ({ id: detail.job.id, status: detail.job.status, reason: detail.job.failureReason }));
    testInfo.annotations.push({ type: 'org-evaluation-outcome', description: String(report.outcome) });
  } catch (error) {
    primaryError = error;
    const known = cycleId ? [...new Set([cycleId, ...jobIds])] : jobIds;
    report.failureEvaluationDetails = await Promise.all(known.map(async id => {
      try { return await api.json<Detail>(`/agent-org-proposals/evaluations/${id}`); }
      catch { return { id, unavailable: true }; }
    }));
    report.failure = String(error);
    throw error;
  }
  finally {
    const cleanupErrors: string[] = [];
    try {
      if (settingsWriteAttempted) {
        const restored = await api.fetch('/agent-org-proposals/evaluations/settings', {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
        });
        if (restored.status !== 200) throw Error('Private evaluation settings restoration failed');
        expect(await api.json('/agent-org-proposals/evaluations/settings')).toEqual(settings);
      }
    } catch (error) { cleanupErrors.push(`evaluation settings: ${String(error)}`); }
    try {
      if (reviewerTaskId) {
        const owned = await api.json<{ id: string; name: string; createdByUserId: number }>(`/agent-schedules/${reviewerTaskId}`);
        if (owned.name !== taskName || owned.createdByUserId !== manifest.ownerUserId) throw Error('Refusing foreign Reviewer cleanup');
        const deleted = await api.fetch(`/agent-schedules/${reviewerTaskId}`, { method: 'DELETE' });
        if (deleted.status !== 204) throw Error('Owned Reviewer schedule cleanup failed');
      }
    } catch (error) { cleanupErrors.push(String(error)); }
    report.cleanupErrors = cleanupErrors;
    await testInfo.attach('actual-org-review-evaluation.json', { body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json' });
    if (cleanupErrors.length && !primaryError) throw Error(cleanupErrors.join('; '));
  }
});
