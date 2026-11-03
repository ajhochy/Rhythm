/** Checked packaged contract codified from the private two-goal Recon. Only an exact disposable actor may reach a model turn. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as rawTest } from '@playwright/test';
import { test, expect, API, ENGINE, ObservedApi, expectedRevision, localRows, responseFor, assertResponse } from './feature-test';
import { existingPrimary, openRuns } from './primary-read';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Profile = { id: string; revision: number; label: string; ocAgent: string; systemPrompt: string; allowedMcpsJson: string | null;
  allowedSkillsJson: string | null; allowedDelegatesJson: string | null; modelProvider: string; modelId: string };
type Model = { provider: string; modelId: string; authorized: boolean; visible: boolean };
type Run = { goalId: string; objective: string; repoPath: string | null; delegationId?: string | null;
  childSessionId: string | null; worktreePath: string | null; branch: string | null;
  status: string; reported: boolean; usage: { totalTokens: number } };
type Runs = { kind: 'runs'; runs: Run[] };
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[P0] Coordinator two owned goals finish with overlapping SDK work and one marked report each';
const safeRun = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args],
  { encoding: 'utf8', timeout: 10_000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } }).trim();

if (!manifestPath || process.env.RHYTHM_FEATURE_MODEL !== '1') {
  // A default discovery/run must fail loudly before the packaged fixture can
  // launch an operator app or read any saved local profile.
  rawTest(title, () => { throw new Error('UNVERIFIED: exact private synthetic actor manifest and model opt-in required'); });
} else {
test(title, async ({ page, sessions, packaged }, testInfo) => {
  test.setTimeout(540_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNRUN: explicit model opt-in required').toBe('1');
  expect(manifestPath, 'UNRUN: synthetic fixture manifest required').toBeTruthy();
  const manifest = readQualificationFixture(manifestPath!, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'UNRUN: synthetic actor required').toBeDefined();
  expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
  const fixtureRoot = realpathSync(manifest.fixtureRoot);
  const fixtureStat = lstatSync(fixtureRoot);
  expect(fixtureRoot.startsWith('/private/tmp/') && !fixtureStat.isSymbolicLink()
    && typeof process.getuid === 'function' && fixtureStat.uid === process.getuid()
    && (fixtureStat.mode & 0o777) === 0o700,
  'only an owner-private canonical disposable fixture may be used').toBe(true);
  const loan = manifest.syntheticActor!.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
  const now = Date.now();
  expect(loan, 'UNRUN: bounded loan required').toBeDefined();
  expect(Number.isSafeInteger(loan!.issuedAt) && Number.isSafeInteger(loan!.stopAt)
    && Number.isSafeInteger(loan!.expires)).toBe(true);
  expect(loan!.issuedAt).toBeLessThanOrEqual(now);
  expect(loan!.stopAt - loan!.issuedAt).toBeLessThanOrEqual(600_000);
  expect(loan!.stopAt).toBeLessThanOrEqual(loan!.expires - 1_200_000);
  expect(loan!.stopAt - now, 'UNRUN: at least 8 minutes needed before setup').toBeGreaterThan(480_000);
  test.setTimeout(Math.min(540_000, loan!.stopAt - now - 30_000));
  const hardStop = Math.min(loan!.stopAt - 60_000, now + 525_000);
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me'))
    .toMatchObject({ user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email } });
  expect(localRows(`SELECT id FROM agent_sessions WHERE owner_user_id=? AND parent_session_id IS NULL
    AND json_extract(coordinator_conversation_json,'$.primaryOwnerRoot')=1`, manifest.ownerUserId)).toEqual([]);

  const cold = await api.json<Model[]>('/agents/models/catalog/full');
  expect(cold.find(model => model.provider === 'openai' && model.modelId === 'gpt-6-luna'))
    .toMatchObject({ authorized: true });
  const visibility = await api.fetch('/agent-models/visibility', { method: 'PATCH',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates: [
      { provider: 'openai', modelId: 'gpt-6-luna', visible: true },
    ] }) });
  expect(visibility.status).toBe(200);
  expect((await api.json<Model[]>('/agents/models/catalog/full'))
    .find(model => model.provider === 'openai' && model.modelId === 'gpt-6-luna'))
    .toMatchObject({ visible: true, authorized: true });
  const decisionConfig = await api.json<{ catalog?: { source?: string;
    models?: Array<{ providerID: string; modelID: string; enabled: boolean }> } }>('/agent-decisions/config');
  expect(decisionConfig.catalog?.source, 'live model catalog required before paid dispatch').toBe('live');
  expect(decisionConfig.catalog?.models?.find(model => model.providerID === 'openai'
    && model.modelID === 'gpt-6-luna')).toMatchObject({ enabled: true });

  // Qualification deliberately skips the bulk config_seeds importer. Install
  // ONLY the two canonical committed skill bodies into this actor's managed
  // skill directory through the normal API, then prove engine discovery.
  const skillAssets: Array<{ name: string; sourceSha256: string; location: string }> = [];
  const managedSkillRoot = path.join(realpathSync(manifest.fixtureRoot), 'opencode-config', 'skills');
  for (const name of ['workflow-orchestrator', 'verification-gate']) {
    const sourcePath = path.join(packaged.appPath, 'Contents', 'Resources', 'api_server',
      'config_seeds', 'skills', name, 'SKILL.md');
    const checkoutPath = fileURLToPath(new URL(`../../../api_server/config_seeds/skills/${name}/SKILL.md`, import.meta.url));
    expect(realpathSync(sourcePath), 'packaged skill must be an in-bundle regular file').toBe(sourcePath);
    expect(lstatSync(sourcePath).isFile() && !lstatSync(sourcePath).isSymbolicLink()).toBe(true);
    const packagedBytes = readFileSync(sourcePath);
    const sourceBytes = readFileSync(checkoutPath);
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(sha(packagedBytes), `signed-bundle ${name} skill must match the reviewed source`).toBe(sha(sourceBytes));
    const asset = packagedBytes.toString('utf8');
    const parsed = asset.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
    expect(parsed, `canonical ${name} skill frontmatter/body required`).not.toBeNull();
    const frontmatter = parsed![1];
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1];
    expect(frontmatter.match(/^name:\s*(.+)$/m)?.[1]).toBe(name);
    expect(description).toBeTruthy();
    const body = parsed![2].trim();
    expect(body.length).toBeGreaterThan(100);
    const before = await api.json<Array<{ name: string }>>('/opencode/skills');
    expect(before.filter(entry => entry.name === name), 'refuse to overwrite a non-fixture skill').toEqual([]);
    const created = await api.fetch('/opencode/skills', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description, content: body }) });
    expect(created.status, `normal API must project ${name} into fixture-managed skills`).toBe(200);
    const installed = await created.json() as { name: string; managed: boolean; location: string };
    expect(installed).toMatchObject({ name, managed: true });
    const location = realpathSync(installed.location);
    expect(location.startsWith(`${managedSkillRoot}${path.sep}`), 'skill may exist only under owned fixture').toBe(true);
    const discovered = await api.json<Array<{ name: string; managed: boolean; location: string }>>('/opencode/skills');
    expect(discovered.filter(entry => entry.name === name)).toHaveLength(1);
    expect(discovered.find(entry => entry.name === name)).toMatchObject({ managed: true, location: installed.location });
    const content = await api.json<{ name: string; content: string }>(`/opencode/skills/${name}/content`);
    expect(content.name).toBe(name);
    expect(content.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]+)$/)?.[1]?.trim())
      .toBe(body);
    skillAssets.push({ name, sourceSha256: sha(packagedBytes), location });
  }

  const original = new Map<string, Profile>();
  for (const id of ['secretary', 'workflow-orchestrator', 'verification-gate']) {
    const profile = await api.json<Profile>(`/agent-configs/${id}`);
    expect(profile.id).toBe(id);
    expect(profile.ocAgent).toBe(id);
    expect(profile.label).toMatch(/^\[smoke\] /);
    expect(profile.modelProvider).toBe('openai');
    expect(profile.systemPrompt).toBe('Work only within the explicit disposable qualification workspace. Never send external messages. Ask before commands or edits.');
    original.set(id, profile);
  }
  const patch = async (id: string, changes: Record<string, unknown>) => {
    const before = original.get(id)!;
    const response = await api.fetch(`/agent-configs/${id}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: before.revision, ...changes }) });
    expect(response.status, `synthetic ${id} profile CAS`).toBe(200);
    const after = await response.json() as Profile;
    expect(after.id).toBe(id);
    expect(after.modelId).toBe('gpt-6-luna');
    return after;
  };
  // Fixture-only authority for the already requested local coding task. The
  // reviewed workflow skill requires feasibility, one owner, verification,
  // a worktree commit, and a factual report. The generic seed's blanket
  // ask-before-edits sentence prevented one otherwise-authorized tiny edit.
  const managerPrompt = 'For this disposable qualification fixture, follow the installed workflow-orchestrator skill. '
    + 'The authored goal already authorizes changing answer.txt, running ./verify-answer.sh, and making one local commit '
    + 'on the isolated worktree branch; perform those requested local actions without asking again. '
    + 'Check the actual result and report only facts. Work inside the provided worktree only. '
    + 'Do not read credentials or private files, use the network or git remotes, install dependencies, '
    + 'send external messages, push, open a PR, merge, or touch any other repository.';
  const secretary = await patch('secretary', {
    modelProvider: 'openai', modelId: 'gpt-6-luna', isManager: true,
    allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_get_coordinator_status', 'rhythm_start_coordinator_goal'] }),
    allowedSkillsJson: '[]', allowedDelegatesJson: '["workflow-orchestrator"]',
    corePermissionsJson: JSON.stringify({ read: 'deny', edit: 'deny', bash: 'deny',
      rhythm_rhythm_get_coordinator_status: 'allow', rhythm_rhythm_start_coordinator_goal: 'allow' }),
  });
  const manager = await patch('workflow-orchestrator', {
    modelProvider: 'openai', modelId: 'gpt-6-luna', isManager: true, allowedMcpsJson: '{}',
    allowedSkillsJson: '["workflow-orchestrator"]', allowedDelegatesJson: '["verification-gate"]',
    systemPrompt: managerPrompt,
  });
  expect(manager.systemPrompt).toBe(managerPrompt);
  await patch('verification-gate', { modelProvider: 'openai', modelId: 'gpt-6-luna',
    allowedMcpsJson: '{}', allowedSkillsJson: '["verification-gate"]', allowedDelegatesJson: '[]' });
  expect(secretary.allowedMcpsJson).toBe(JSON.stringify({ rhythm: ['rhythm_get_coordinator_status', 'rhythm_start_coordinator_goal'] }));
  const engineAgents = await api.json<{ agents: Array<{ name: string; model?: string }> }>('/agent-sessions/agents?full=1');
  for (const id of ['secretary', 'workflow-orchestrator', 'verification-gate']) {
    const profile = await api.json<Profile>(`/agent-configs/${id}`);
    expect(profile.id).toBe(id);
    expect(profile.ocAgent).toBe(id);
    expect(profile.modelId).toBe('gpt-6-luna');
    expect(profile.systemPrompt).toBe(id === 'workflow-orchestrator'
      ? managerPrompt : original.get(id)!.systemPrompt);
    expect(engineAgents.agents.some(agent => agent.name === id), `live engine must discover ${id}`).toBe(true);
    const file = path.join(realpathSync(manifest.fixtureRoot), 'opencode-config', 'agents', `${id}.md`);
    expect(realpathSync(file)).toBe(file);
    expect(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink()).toBe(true);
    const projected = readFileSync(file, 'utf8');
    expect(projected).toContain('model: openai/gpt-6-luna');
    expect(projected).toContain(profile.systemPrompt);
    if (id !== 'secretary') expect(projected).toContain(id);
  }
  expect((await api.json<Profile>('/agent-configs/workflow-orchestrator')).allowedSkillsJson)
    .toBe('["workflow-orchestrator"]');
  expect((await api.json<Profile>('/agent-configs/verification-gate')).allowedSkillsJson)
    .toBe('["verification-gate"]');
  const nonce = randomUUID();
  const workspaceParent = path.join(realpathSync(manifest.fixtureRoot), 'live-artifacts');
  mkdirSync(workspaceParent, { recursive: true, mode: 0o700 });
  const workspace = mkdtempSync(path.join(workspaceParent, `coordinator-two-goal-${nonce}-`));
  const repos = [1, 2].map(index => {
    const repo = path.join(workspace, `goal-${index}`);
    mkdirSync(repo, { mode: 0o700 });
    safeRun(repo, ['init', '-b', 'main']);
    safeRun(repo, ['config', 'user.name', 'Rhythm qualification']);
    safeRun(repo, ['config', 'user.email', 'qualification@invalid.example']);
    safeRun(repo, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(path.join(repo, 'answer.txt'), `Goal ${index}: pending\n`, { flag: 'wx', mode: 0o600 });
    // A real stability check: inspect the target file once per second for
    // fifteen seconds. Two children can overlap while each verifies its own
    // result, but elapsed time alone is never credited as overlap.
    const verification = `#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexpected='Goal ${index}: 19'\ni=0\nwhile [ "$i" -lt 15 ]; do\n  actual=$(cat answer.txt)\n  [ "$actual" = "$expected" ] || { printf 'answer mismatch at check %s\\n' "$i" >&2; exit 1; }\n  i=$((i + 1))\n  sleep 1\ndone\nprintf 'verified Goal ${index}: 19 over 15 checks\\n'\n`;
    writeFileSync(path.join(repo, 'verify-answer.sh'), verification, { flag: 'wx', mode: 0o700 });
    expect(lstatSync(path.join(repo, 'verify-answer.sh')).mode & 0o111).not.toBe(0);
    safeRun(repo, ['add', 'answer.txt', 'verify-answer.sh']);
    safeRun(repo, ['commit', '-m', `fixture goal ${index}`]);
    expect(safeRun(repo, ['remote'])).toBe('');
    return { repo: realpathSync(repo), head: safeRun(repo, ['rev-parse', 'HEAD']), index };
  });

  const receipt: Record<string, unknown> = { sourceRevision: expectedRevision, nonce,
    ownerUserId: manifest.ownerUserId, repos, skillAssets, status: 'preflight', observations: [] as unknown[] };
  const receiptPath = testInfo.outputPath(`coordinator-two-goal-${nonce}.json`);
  const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let root: { id: string; project_id: string; profile_id?: string } | null = null;
  let terminal = false;
  try {
    await sessions.open();
    expect(sessions.api?.origin).toBe(API);
    const resolve = responseFor(page, 'POST', '/coordinator-conversations/resolve');
    const choice = responseFor(page, 'POST', '/coordinator-conversations/setup');
    await page.getByTestId('rhythm-primary-entry').click();
    await assertResponse(await resolve, 'POST', '/coordinator-conversations/resolve', 503);
    const choiceResponse = await choice;
    await assertResponse(choiceResponse, 'POST', '/coordinator-conversations/setup', 200);
    expect(await choiceResponse.json()).toMatchObject({ kind: 'setup_profile_choice_required',
      profileChoices: expect.arrayContaining([expect.objectContaining({ id: 'secretary' })]) });
    const setup = responseFor(page, 'POST', '/coordinator-conversations/setup');
    await page.getByTestId('rhythm-setup-profile-secretary').click();
    const setupResponse = await setup;
    await assertResponse(setupResponse, 'POST', '/coordinator-conversations/setup', 201);
    const body = await setupResponse.json() as { sessionId: string; projectId: string };
    root = await existingPrimary(page) as { id: string; project_id: string; profile_id?: string };
    expect(root?.id).toBe(body.sessionId);
    expect(root?.project_id).toBe(body.projectId);
    expect(localRows('SELECT profile_id,owner_user_id FROM agent_sessions WHERE id=?', root!.id))
      .toMatchObject([{ profile_id: 'secretary', owner_user_id: manifest.ownerUserId }]);
    expect((await page.evaluate(async () => (await (window as any).rhythmShell.auth.currentSession())?.user.id)))
      .toBe(manifest.ownerUserId);
    await page.getByTestId('session-actions').click();
    await page.getByTestId('composer-model').selectOption('openai/gpt-6-luna');
    const pinned = responseFor(page, 'PATCH', `/agent-sessions/${root!.id}`);
    await page.getByTestId('model-session-default').click();
    await assertResponse(await pinned, 'PATCH', `/agent-sessions/${root!.id}`, 200);
    expect(localRows('SELECT model_mode,provider_id,model_id FROM agent_sessions WHERE id=?', root!.id))
      .toMatchObject([{ model_mode: 'fixed', provider_id: 'openai', model_id: 'gpt-6-luna' }]);
    expect(loan!.stopAt - Date.now(), 'UNRUN: too little loan before first UI send').toBeGreaterThan(360_000);
    receipt.root = { sessionId: root!.id, projectId: root!.project_id };
    receipt.status = 'ready-to-send';
    // C2 captures only a direct action request. Keep the nonce in the exact
    // authored objective, but lead with the product's ordinary "Change" verb.
    const goalTexts = repos.map(({ repo, index }) =>
      `Change only answer.txt in the existing git repository at ${repo} to exactly "Goal ${index}: 19". Run the already committed ./verify-answer.sh there; it checks answer.txt once per second for 15 seconds and must pass. Commit only answer.txt on your isolated worktree branch. [smoke] ${nonce} goal ${index}. These local edits, commands, and this commit are already authorized. Do not contact any person, service, website, or remote. Report the actual branch, worktree, verification result, and commit.`);
    const runs = async (): Promise<Run[]> => {
      const response = await api.fetch('/coordinator-conversations/runs', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: root!.id, projectId: root!.project_id }) });
      expect(response.status).toBe(200);
      const result = await response.json() as Runs;
      expect(result.kind).toBe('runs');
      return result.runs;
    };
    const send = async (message: string) => {
      const pending = responseFor(page, 'POST', '/coordinator-conversations/message');
      await page.getByTestId('composer-input').fill(message);
      await page.getByTestId('composer-send').click();
      const response = await pending;
      await assertResponse(response, 'POST', '/coordinator-conversations/message', 200);
      expect((await response.json() as { kind: string }).kind).toBe('foreground_accepted');
    };
    const waitFor = async (predicate: (found: Run[]) => boolean, label: string,
      stopOnCompletedNoGoal = false) => {
      const started = Date.now();
      let terminalNoGoal: { messageId: string; firstSeen: number; samples: number } | null = null;
      while (Date.now() < hardStop) {
        const found = await runs();
        if (predicate(found)) return found;
        if (stopOnCompletedNoGoal && Date.now() - started >= 12_000) {
          const parent = localRows('SELECT coordinator_conversation_json,sdk_session_id,cwd FROM agent_sessions WHERE id=?', root!.id)[0];
          const conversation = JSON.parse(String(parent?.coordinator_conversation_json ?? '{}')) as {
            goals?: Array<{ objective?: string; state?: string }> };
          const ownedGoals = (conversation.goals ?? []).filter(goal => goal.objective?.includes(nonce));
          const delegations = localRows('SELECT id FROM agent_async_delegations WHERE parent_session_id=?', root!.id);
          const outputs = localRows('SELECT info_json,parts_json FROM agent_session_messages WHERE session_id=? AND role=?',
            root!.id, 'output');
          const completed = outputs.map(row => {
            const info = JSON.parse(String(row.info_json ?? '{}')) as { id?: string; finish?: string;
              time?: { completed?: number } };
            const parts = JSON.parse(String(row.parts_json ?? '[]')) as Array<{ type?: string; text?: string;
              tool?: string; state?: { status?: string; input?: Record<string, unknown>; error?: unknown } }>;
            return { info, parts };
          }).filter(row => (row.info.time?.completed ?? 0) >= started)
            .sort((a, b) => (a.info.time?.completed ?? 0) - (b.info.time?.completed ?? 0)).at(-1);
          const sdkId = String(parent?.sdk_session_id ?? '');
          const cwd = String(parent?.cwd ?? '');
          const finalMessage = completed?.info.finish === 'stop'
            && completed.parts.every(part => part.type !== 'tool'
              || ['completed', 'error'].includes(part.state?.status ?? ''));
          if (finalMessage && completed?.info.id && sdkId.startsWith('ses_') && cwd) {
            const statusResponse = await fetch(`${ENGINE}/session/status?directory=${encodeURIComponent(cwd)}`,
              { signal: AbortSignal.timeout(10_000) });
            expect(statusResponse.status, 'real engine status must be readable before early stop').toBe(200);
            const statuses = await statusResponse.json() as Record<string, { type?: string }>;
            // OpenCode omits idle sessions from this map. A finished tool-call
            // step may have time.completed but is not a terminal turn.
            const idle = (statuses[sdkId]?.type ?? 'idle') === 'idle';
            const previous = terminalNoGoal as { messageId: string; firstSeen: number; samples: number } | null;
            if (idle) terminalNoGoal = previous?.messageId === completed.info.id
              ? { ...previous, samples: previous.samples + 1 }
              : { messageId: completed.info.id, firstSeen: Date.now(), samples: 1 };
            else terminalNoGoal = null;
          } else terminalNoGoal = null;
          const stableTerminal = terminalNoGoal as { messageId: string; firstSeen: number; samples: number } | null;
          if (completed && stableTerminal && stableTerminal.messageId === completed.info.id
            && stableTerminal.samples >= 2 && Date.now() - stableTerminal.firstSeen >= 2_000
            && delegations.length === 0
            && (ownedGoals.length === 0 || ownedGoals.every(goal => goal.state === 'captured'))
            && !found.some(run => run.objective.includes(nonce))) {
            const textParts = completed.parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('');
            const toolMetadata = completed.parts.filter(part => part.type === 'tool').map(part => {
              const input = part.state?.input ?? {};
              const target = typeof input.name === 'string' ? input.name : '';
              return { tool: part.tool === 'mcp_dispatch' ? 'mcp_dispatch' : 'other',
                status: part.state?.status ?? 'unknown',
                action: ['search', 'describe', 'execute'].includes(String(input.action ?? 'execute'))
                  ? String(input.action ?? 'execute') : 'other',
                target: ['rhythm_get_coordinator_status', 'rhythm_start_coordinator_goal',
                  'rhythm_rhythm_get_coordinator_status', 'rhythm_rhythm_start_coordinator_goal'].includes(target)
                  ? target : 'other',
                errorCategory: part.state?.status === 'error' ? 'tool-error' : null };
            });
            receipt.failureReason = ownedGoals.length === 0
              ? 'completed-secretary-without-captured-goal-or-delegation'
              : 'completed-secretary-with-captured-goal-but-no-delegation';
            receipt.rootSdk = { sdkSessionPresent: Boolean(parent?.sdk_session_id),
              assistantMessageId: completed.info.id ?? null, assistantCompleted: true,
              assistantFinish: completed.info.finish, stableIdleSamples: stableTerminal.samples,
              partTypes: completed.parts.map(part => part.type ?? 'unknown'),
              refusalCategory: /not permitted|allowlist|unavailable/i.test(textParts)
                ? 'coordinator-tool-unavailable' : /no startable goals|no authorized goal id/i.test(textParts)
                  ? 'no-startable-goal' : 'completed-without-delegation',
              toolMetadata };
            throw new Error('UNVERIFIED: completed Secretary turn created no nonce-owned delegation');
          }
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, 2_000));
      }
      throw new Error(`UNVERIFIED: loan deadline while waiting for ${label}`);
    };
    await send(goalTexts[0]);
    const one = await waitFor(found => found.some(run => run.objective.includes(nonce) && run.repoPath === repos[0].repo
      && !!run.delegationId && !!run.childSessionId), 'first signed delegation', true);
    (receipt.observations as unknown[]).push({ phase: 'first-dispatch', runs: one });
    expect(hardStop - Date.now(), 'UNVERIFIED: insufficient loan for second UI goal').toBeGreaterThan(150_000);
    await send(goalTexts[1]);
    const two = await waitFor(found => repos.every(repo => found.some(run => run.objective.includes(nonce)
      && run.repoPath === repo.repo && !!run.delegationId && !!run.childSessionId)), 'two signed delegations');
    (receipt.observations as unknown[]).push({ phase: 'second-dispatch', runs: two });
    const owned = two.filter(run => run.objective.includes(nonce));
    expect(owned).toHaveLength(2);
    expect(new Set(owned.map(run => run.goalId)).size).toBe(2);
    expect(new Set(owned.map(run => run.delegationId)).size).toBe(2);
    expect(new Set(owned.map(run => run.childSessionId)).size).toBe(2);
    expect(new Set(owned.map(run => run.worktreePath)).size).toBe(2);
    const finished = await waitFor(found => found.filter(run => run.objective.includes(nonce)).length === 2
      && found.filter(run => run.objective.includes(nonce)).every(run =>
        ['finished', 'failed', 'cancelled'].includes(run.status) && run.reported), 'terminal SDK outcomes and reports');
    const finalRuns = finished.filter(run => run.objective.includes(nonce));
    expect(finalRuns).toHaveLength(2);
    for (const run of finalRuns) {
      expect(run.status, `owned goal ${run.goalId} must finish successfully`).toBe('finished');
      expect(run.reported, `owned goal ${run.goalId} must deliver its report`).toBe(true);
    }
    receipt.status = 'observed-terminal';
    receipt.finalRuns = finalRuns;
    const snapshotBothRunning = two.filter(run => run.objective.includes(nonce)).every(run => run.status === 'running');
    // Capture concurrency evidence before effect assertions, so a failed
    // commit/verification proof still leaves attributable timing in receipt.
    // Delegation created_at is before promptAsync; it is not a run start.
    const sdkIntervals = finalRuns.map(run => {
      const assistantInfos = localRows(`SELECT info_json FROM agent_session_messages
        WHERE session_id=? AND role='output' AND info_json IS NOT NULL`, run.childSessionId)
        .map(message => JSON.parse(String(message.info_json)) as {
          time?: { created?: number; completed?: number } });
      const validTimes = assistantInfos.map(info => info.time).filter((time): time is {
        created: number; completed: number } => Boolean(time
          && Number.isSafeInteger(time.created) && Number.isSafeInteger(time.completed)
          && time.created! > 0 && time.completed! >= time.created!));
      return { goalId: run.goalId, childSessionId: run.childSessionId,
        firstAssistantCreatedMs: assistantInfos.length > 0 && validTimes.length === assistantInfos.length
          ? Math.min(...validTimes.map(time => time.created)) : null,
        lastAssistantCompletedMs: assistantInfos.length > 0 && validTimes.length === assistantInfos.length
          ? Math.max(...validTimes.map(time => time.completed)) : null,
        assistantMessages: assistantInfos.length };
    });
    const [firstInterval, secondInterval] = sdkIntervals;
    const attributableBounds = sdkIntervals.length === 2 && sdkIntervals.every(interval =>
      interval.firstAssistantCreatedMs !== null && interval.lastAssistantCompletedMs !== null);
    const observedOverlap = attributableBounds
      ? Math.max(firstInterval.firstAssistantCreatedMs!, secondInterval.firstAssistantCreatedMs!)
        < Math.min(firstInterval.lastAssistantCompletedMs!, secondInterval.lastAssistantCompletedMs!)
      : null;
    receipt.overlap = { source: 'persisted SDK assistant message time.created/time.completed',
      snapshotBothRunning, sdkIntervals, observedOverlap,
      conclusion: observedOverlap === null ? 'UNVERIFIED-missing-sdk-time-bound'
        : observedOverlap ? 'observed-sdk-interval-intersection' : 'no-sdk-interval-intersection-observed' };
    expect(observedOverlap, 'two exact child SDK execution intervals must intersect').toBe(true);
    const fixtureWorktreeRoot = realpathSync(path.join(manifest.fixtureRoot, 'xdg-data', 'opencode', 'worktree'));
    for (const repo of repos) {
      const run = finalRuns.find(item => item.repoPath === repo.repo)!;
      expect(run.worktreePath).toBeTruthy();
      const worktreePath = realpathSync(run.worktreePath!);
      const relativeWorktree = path.relative(fixtureWorktreeRoot, worktreePath);
      expect(relativeWorktree && relativeWorktree !== '..' && !relativeWorktree.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativeWorktree), 'worktree must be under exact fixture OpenCode XDG root').toBe(true);
      expect(lstatSync(run.worktreePath!).isSymbolicLink(), 'worktree path must not be a symlink').toBe(false);
      expect(worktreePath).not.toBe(repo.repo);
      expect(realpathSync(safeRun(worktreePath, ['rev-parse', '--show-toplevel']))).toBe(worktreePath);
      const commonDir = realpathSync(path.resolve(worktreePath, safeRun(worktreePath, ['rev-parse', '--git-common-dir'])));
      expect(commonDir, 'worktree must be attached to its exact nonce-owned source repo').toBe(realpathSync(path.join(repo.repo, '.git')));
      expect(safeRun(worktreePath, ['branch', '--show-current'])).toBe(run.branch);
      expect(safeRun(repo.repo, ['rev-parse', 'HEAD'])).toBe(repo.head);
      expect(safeRun(repo.repo, ['status', '--porcelain'])).toBe('');
      expect(safeRun(repo.repo, ['remote'])).toBe('');
      const committedHead = safeRun(worktreePath, ['rev-parse', 'HEAD']);
      expect(committedHead, `goal ${repo.index} must commit a new result`).not.toBe(repo.head);
      expect(safeRun(worktreePath, ['rev-list', '--count', `${repo.head}..HEAD`]),
        `goal ${repo.index} must make exactly one commit`).toBe('1');
      expect(safeRun(worktreePath, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']))
        .toBe('answer.txt');
      expect(safeRun(worktreePath, ['show', 'HEAD:answer.txt'])).toBe(`Goal ${repo.index}: 19`);
      expect(safeRun(worktreePath, ['status', '--porcelain'])).toBe('');
      const child = localRows('SELECT id,parent_session_id,agent_kind,profile_id,sdk_session_id,cwd,worktree_path,worktree_branch FROM agent_sessions WHERE id=?', run.childSessionId);
      expect(child).toHaveLength(1);
      expect(child[0]).toMatchObject({ id: run.childSessionId, parent_session_id: root!.id,
        agent_kind: 'workflow-orchestrator', profile_id: null, cwd: worktreePath,
        worktree_path: run.worktreePath, worktree_branch: run.branch });
      const delegation = localRows('SELECT id,parent_session_id,child_session_id,target_agent_config_id,status,notified_at FROM agent_async_delegations WHERE id=?', run.delegationId);
      expect(delegation).toHaveLength(1);
      expect(delegation[0]).toMatchObject({ parent_session_id: root!.id, child_session_id: run.childSessionId,
        target_agent_config_id: 'workflow-orchestrator' });
      expect(delegation[0].notified_at).toBeTruthy();
      const messages = localRows('SELECT sdk_message_id,parts_json,tokens_json FROM agent_session_messages WHERE session_id=?', run.childSessionId);
      const verificationOutput = messages.flatMap(message => {
        try { return (JSON.parse(String(message.parts_json ?? '[]')) as Array<{
          type?: string; state?: { status?: string; output?: unknown } }>).filter(part =>
          part.type === 'tool' && part.state?.status === 'completed').map(part =>
          JSON.stringify(part.state?.output ?? null)); }
        catch { throw new Error(`UNVERIFIED: malformed SDK parts for owned child ${run.childSessionId}`); }
      });
      expect(verificationOutput.some(output => output.includes(`verified Goal ${repo.index}: 19 over 15 checks`)),
        `goal ${repo.index} must actually run the committed stability check`).toBe(true);
      const assistantInfos = localRows(`SELECT info_json FROM agent_session_messages
        WHERE session_id=? AND role='output' AND info_json IS NOT NULL`, run.childSessionId)
        .map(message => JSON.parse(String(message.info_json)) as { providerID?: string; modelID?: string;
          time?: { created?: number; completed?: number } });
      expect(assistantInfos.length, `real SDK assistant required for ${run.childSessionId}`).toBeGreaterThan(0);
      for (const info of assistantInfos) {
        expect(info).toMatchObject({ providerID: 'openai', modelID: 'gpt-6-luna' });
        expect(info.time?.completed).toBeTruthy();
      }
      const dispatches = localRows(`SELECT origin,requested_source,requested_provider_id,requested_model_id,
        final_provider_id,final_model_id,outcome FROM agent_turn_dispatches WHERE session_id=?`, run.childSessionId);
      expect(dispatches, `direct workflow child must use the loaned OpenCode provider`).toContainEqual(
        expect.objectContaining({ origin: 'delegation', requested_source: 'agent_config',
          requested_provider_id: 'openai', requested_model_id: 'gpt-6-luna',
          final_provider_id: 'openai', final_model_id: 'gpt-6-luna', outcome: 'accepted' }));
      receipt[`child-${repo.index}`] = { sessionId: run.childSessionId, sdkSessionId: child[0].sdk_session_id,
        committedHead, verificationObserved: true,
        messageCount: messages.length, assistantModels: assistantInfos.map(info => `${info.providerID}/${info.modelID}`),
        partTypes: messages.flatMap(message => {
          try { return (JSON.parse(String(message.parts_json)) as Array<{ type: string }>).map(part => part.type); }
          catch { return []; }
        }) };
    }
    const sessionTree = localRows(`WITH RECURSIVE tree(id) AS (
      SELECT ? UNION SELECT s.id FROM agent_sessions s JOIN tree t ON s.parent_session_id=t.id
    ) SELECT id FROM tree`, root!.id);
    const approvedSkillNames = new Set(skillAssets.map(asset => asset.name));
    const canonicalCoordinatorTools = ['rhythm_rhythm_get_coordinator_status',
      'rhythm_rhythm_start_coordinator_goal'];
    const secretaryDescriptions: Array<{ requestedName: string; status: string | null;
      executeName: string | null; registeredName: string | null }> = [];
    receipt.secretaryDescriptions = secretaryDescriptions;
    const toolObservations: Array<{ sessionId: string; tool: string; status: string | null;
      action: string; family: string; target: string; requestedSkill: string; inputKeys: string[] }> = [];
    const toolParts: Array<{ sessionId: string; sessionKind: string; part: { tool?: string;
      state?: { status?: string; input?: Record<string, unknown>; output?: unknown } } }> = [];
    const assistantModels: Array<{ sessionId: string; info: { providerID?: string; modelID?: string } }> = [];
    // Collect the complete sanitized sequence before any tool audit assertion.
    // A later strict failure must not hide other discovery or execution calls.
    receipt.toolObservations = toolObservations;
    for (const session of sessionTree) {
      const sessionKind = String(localRows('SELECT agent_kind FROM agent_sessions WHERE id=?', session.id)[0]?.agent_kind ?? '');
      const infos = localRows(`SELECT info_json FROM agent_session_messages
        WHERE session_id=? AND role='output' AND info_json IS NOT NULL`, session.id);
      for (const row of infos) {
        const info = JSON.parse(String(row.info_json)) as { providerID?: string; modelID?: string };
        assistantModels.push({ sessionId: String(session.id), info });
      }
      for (const message of localRows('SELECT parts_json FROM agent_session_messages WHERE session_id=?', session.id)) {
        let parts: Array<{ type?: string; tool?: string; state?: { status?: string;
          input?: Record<string, unknown>; output?: unknown } }> = [];
        try { parts = JSON.parse(String(message.parts_json ?? '[]')) as typeof parts; }
        catch { throw new Error(`UNVERIFIED: malformed SDK parts for owned session ${session.id}`); }
        for (const part of parts.filter(candidate => candidate.type === 'tool')) {
          toolParts.push({ sessionId: String(session.id), sessionKind, part });
          const input = part.state?.input ?? {};
          const name = part.tool ?? '';
          const target = typeof input.name === 'string' ? input.name : '';
          const nestedArguments = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
            ? input.arguments as Record<string, unknown> : undefined;
          const skillName = target === 'skill' ? nestedArguments?.name : target;
          const normalizedAction = input.action ?? 'execute';
          const normalizedFamily = input.family === undefined ? 'mcp' : input.family;
          toolObservations.push({ sessionId: String(session.id), tool: name,
            status: part.state?.status ?? null,
            action: ['search', 'describe', 'execute', 'skill'].includes(String(normalizedAction)) ? String(normalizedAction) : 'other',
            family: ['builtin', 'mcp'].includes(String(normalizedFamily)) ? String(normalizedFamily) : 'other',
            target: approvedSkillNames.has(target) || ['skill', 'bash', 'read', 'edit', 'write', 'apply_patch',
              'glob', 'grep', 'rhythm_delegate_async', 'rhythm_delegation_status', 'rhythm_delegation_result',
              'rhythm_get_coordinator_status', 'rhythm_start_coordinator_goal',
              'rhythm_rhythm_get_coordinator_status', 'rhythm_rhythm_start_coordinator_goal'].includes(target)
              ? target : 'other',
            requestedSkill: typeof skillName === 'string' && approvedSkillNames.has(skillName) ? skillName : 'other',
            inputKeys: Object.keys(input).sort() });
        }
      }
    }
    for (const { sessionId, info } of assistantModels) {
      expect(info, `no descendant may route to a non-loaned provider in ${sessionId}`)
        .toMatchObject({ providerID: 'openai', modelID: 'gpt-6-luna' });
    }
    for (const { sessionId, sessionKind, part } of toolParts) {
          const input = part.state?.input ?? {};
          const name = part.tool ?? '';
          const target = typeof input.name === 'string' ? input.name : '';
          const nestedArguments = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
            ? input.arguments as Record<string, unknown> : undefined;
          const skillName = target === 'skill' ? nestedArguments?.name : target;
          const action = input.action ?? 'execute';
          const family = input.family === undefined ? 'mcp' : input.family;
          if (sessionId === root!.id) {
            expect(name, 'Secretary may use only signed Coordinator controls').toBe('mcp_dispatch');
          } else {
            const encoded = JSON.stringify(input).toLowerCase();
            expect(encoded, `unexpected outbound command/tool input in owned child ${sessionId}`)
              .not.toMatch(/(?:\bcurl\b|\bwget\b|https?:\/\/|\bssh\b|\bscp\b|\brsync\b|\bgit\s+(?:push|fetch|pull)\b|\bnpm\s+install\b|\bnpx\b|\bbrew\b|\bclaude\b|\bcodex\b|\bgemini\b)/);
          }
          if (name === 'mcp_dispatch') {
            expect(['mcp', 'builtin']).toContain(family);
            expect(['search', 'describe', 'execute', 'skill']).toContain(action);
            if (sessionId === root!.id && action === 'skill') {
              // Secretary has no skill grant. The parser rejects this action
              // before any lookup or effect; retain the attempt as an error.
              expect(Object.keys(input).every(key => ['action', 'name', 'family', 'arguments'].includes(key))).toBe(true);
              expect(part.state?.status).toBe('error');
            } else if (action === 'search') {
              expect(Object.keys(input).every(key => ['action', 'query', 'family'].includes(key))).toBe(true);
              expect(input.query === undefined || typeof input.query === 'string').toBe(true);
              if (typeof input.query === 'string') expect(Buffer.byteLength(input.query)).toBeLessThanOrEqual(512);
              if (sessionId === root!.id) expect(family).toBe('mcp');
              // Metadata discovery returns only the current profile's eligible catalog.
              // It is not execution evidence.
            } else if (action === 'describe') {
              expect(Object.keys(input).every(key => ['action', 'name', 'family'].includes(key))).toBe(true);
              expect(typeof target).toBe('string');
              expect(target.length).toBeGreaterThan(0);
              if (sessionId === root!.id) {
                expect(family).toBe('mcp');
                expect(['rhythm_get_coordinator_status', 'rhythm_start_coordinator_goal',
                  'rhythm_rhythm_get_coordinator_status', 'rhythm_rhythm_start_coordinator_goal']).toContain(target);
                const described = { requestedName: target, status: part.state?.status ?? null,
                  executeName: null as string | null, registeredName: null as string | null };
                secretaryDescriptions.push(described);
                if (part.state?.status === 'completed') {
                  const descriptor = JSON.parse(String(part.state.output ?? '')) as {
                    name?: unknown; executeName?: unknown; registeredName?: unknown };
                  described.executeName = typeof descriptor.executeName === 'string'
                    && canonicalCoordinatorTools.includes(descriptor.executeName)
                    ? descriptor.executeName : 'other';
                  described.registeredName = typeof descriptor.registeredName === 'string'
                    && ['rhythm_get_coordinator_status', 'rhythm_start_coordinator_goal']
                      .includes(descriptor.registeredName)
                    ? descriptor.registeredName : descriptor.registeredName === undefined ? null : 'other';
                  expect(canonicalCoordinatorTools).toContain(descriptor.name);
                  expect(descriptor.executeName).toBe(descriptor.name);
                  if (descriptor.registeredName !== undefined)
                    expect(descriptor.registeredName).toBe(String(descriptor.name).replace(/^rhythm_/, ''));
                }
              } else if (family === 'builtin') {
                expect(['read', 'edit', 'write', 'apply_patch', 'bash', 'glob', 'grep', 'skill']).toContain(target);
                if (target === 'skill') {
                  expect(['workflow-orchestrator', 'verification-gate']).toContain(sessionKind);
                  expect(approvedSkillNames.has(sessionKind)).toBe(true);
                }
              } else {
                expect(sessionKind).toBe('workflow-orchestrator');
                expect(['rhythm_delegate_async', 'rhythm_delegation_status', 'rhythm_delegation_result']).toContain(target);
              }
            } else if (sessionId === root!.id) {
              expect(action).toBe('execute');
              expect(Object.keys(input).every(key => ['action', 'name', 'family', 'arguments'].includes(key))).toBe(true);
              expect(family).toBe('mcp');
              expect(canonicalCoordinatorTools, 'Secretary execution must use the returned canonical executeName')
                .toContain(target);
              expect(part.state?.status, 'signed Coordinator control must execute successfully').toBe('completed');
              expect(nestedArguments).toBeDefined();
            } else {
              if (action === 'skill') {
                // An observed skill-shaped SDK part may refer only to this
                // exact child's installed skill. The fork's actual skill tool
                // accepts {name}; mcp_dispatch's parser does not accept
                // action=skill, so an error part is recorded as an attempted
                // retrieval, never credited as a successful load.
                const args = nestedArguments;
                const requestedSkill = skillName;
                expect(['workflow-orchestrator', 'verification-gate']).toContain(sessionKind);
                expect(approvedSkillNames.has(sessionKind)).toBe(true);
                expect(requestedSkill).toBe(sessionKind);
                expect(input.family === undefined || input.family === 'builtin').toBe(true);
                if (target === 'skill') expect(Object.keys(args ?? {}).sort()).toEqual(['name']);
                if (part.state?.status === 'completed') {
                  expect(typeof part.state.output).toBe('string');
                  expect(part.state?.output).toContain(`<skill_content name="${sessionKind}">`);
                } else {
                  expect(part.state?.status).toBe('error');
                }
              } else if (action === 'execute' && family === 'builtin') {
                expect(Object.keys(input).every(key => ['action', 'name', 'family', 'arguments'].includes(key))).toBe(true);
                expect(input.arguments === undefined || nestedArguments !== undefined).toBe(true);
                expect(['read', 'edit', 'write', 'apply_patch', 'bash', 'glob', 'grep', 'skill'])
                  .toContain(input.name);
                if (input.name === 'skill') {
                  expect(['workflow-orchestrator', 'verification-gate']).toContain(sessionKind);
                  expect(Object.keys(nestedArguments ?? {}).sort()).toEqual(['name']);
                  expect(nestedArguments?.name).toBe(sessionKind);
                  expect(part.state?.status).toBe('completed');
                  expect(part.state?.output).toContain(`<skill_content name="${sessionKind}">`);
                }
              } else {
                expect(action).toBe('execute');
                expect(Object.keys(input).every(key => ['action', 'name', 'family', 'arguments'].includes(key))).toBe(true);
                expect(family).toBe('mcp');
                expect(sessionKind).toBe('workflow-orchestrator');
                expect(['rhythm_delegate_async', 'rhythm_delegation_status', 'rhythm_delegation_result'])
                  .toContain(input.name);
                expect(nestedArguments).toBeDefined();
              }
            }
          } else {
            expect(sessionId).not.toBe(root!.id);
            expect(['read', 'edit', 'write', 'apply_patch', 'bash', 'glob', 'grep', 'skill']).toContain(name);
            if (name === 'skill') {
              expect(['workflow-orchestrator', 'verification-gate']).toContain(sessionKind);
              expect(input.name).toBe(sessionKind);
              expect(part.state?.status).toBe('completed');
              expect(part.state?.output).toContain(`<skill_content name="${sessionKind}">`);
            }
          }
    }
    await openRuns(page);
    await expect(page.getByTestId('coordinator-run-open')).toHaveCount(2);
    for (const run of finalRuns) {
      await expect(page.getByTestId('coordinator-run-open').filter({ hasText: run.objective }))
        .toContainText(run.status === 'finished' ? 'Finished' : run.status === 'failed' ? 'Failed' : 'Stopped');
    }
    const repeat = (await runs()).filter(run => run.objective.includes(nonce));
    expect(repeat.map(run => [run.goalId, run.delegationId, run.childSessionId, run.reported]))
      .toEqual(finalRuns.map(run => [run.goalId, run.delegationId, run.childSessionId, run.reported]));
    const readRootMessages = () => localRows(`SELECT id,role,sdk_message_id,parts_json,info_json
      FROM agent_session_messages WHERE session_id=? ORDER BY id`, root!.id).map(row => {
        let parts: Array<{ type?: string; text?: string }>;
        let info: { providerID?: string; modelID?: string; time?: { completed?: number } } | null;
        try {
          parts = JSON.parse(String(row.parts_json ?? '[]')) as typeof parts;
          info = row.info_json ? JSON.parse(String(row.info_json)) as typeof info : null;
        } catch { throw new Error('UNVERIFIED: malformed Coordinator SDK transcript'); }
        expect(Array.isArray(parts), 'Coordinator SDK parts must be an array').toBe(true);
        return { id: Number(row.id), role: String(row.role), sdkMessageId: row.sdk_message_id
          ? String(row.sdk_message_id) : null, info,
        textParts: parts.filter(part => part.type === 'text' && typeof part.text === 'string')
          .map(part => part.text!) };
      });
    const rootAssistants = localRows(`SELECT info_json FROM agent_session_messages
      WHERE session_id=? AND role='output' AND info_json IS NOT NULL`, root!.id)
      .map(row => JSON.parse(String(row.info_json)) as { providerID?: string; modelID?: string;
        time?: { completed?: number } });
    expect(rootAssistants.length, 'real Secretary SDK turns required').toBeGreaterThanOrEqual(2);
    for (const info of rootAssistants) expect(info).toMatchObject({ providerID: 'openai', modelID: 'gpt-6-luna' });
    const wakeRows = readRootMessages();
    const wakeProofs = finalRuns.map(run => {
      expect(run.branch && run.worktreePath && run.childSessionId,
        `owned goal ${run.goalId} needs an attributable wake`).toBeTruthy();
      const wakeMessages = wakeRows.filter(message => message.role === 'input'
        && message.textParts.some(text => text.includes('[Async delegation update]')
          && text.includes(run.childSessionId!) && text.includes(run.branch!)
          && text.includes(run.worktreePath!)
          && /<!-- rhythm-async-delegation:msg_rhythm_async_[a-f0-9]{24} -->/.test(text)));
      expect(wakeMessages, `exactly one marked SDK wake must include goal ${run.goalId}`).toHaveLength(1);
      const wake = wakeMessages[0];
      const markers = wake.textParts.flatMap(text =>
        [...text.matchAll(/<!-- rhythm-async-delegation:(msg_rhythm_async_[a-f0-9]{24}) -->/g)]
          .map(match => match[1]));
      expect(markers, `one delivery marker in wake for goal ${run.goalId}`).toHaveLength(1);
      return { run, wake, markers };
    });
    // `reported` means the async wake was enqueued. It does not mean the
    // Secretary's next SDK output has completed. Re-read only this root's
    // persisted messages until both attributable reports arrive or the
    // shorter of the existing loan stop and this bounded callback window.
    const reportDeadline = Math.min(hardStop, Date.now() + 90_000);
    let pollCount = 0;
    let reportRows: ReturnType<typeof readRootMessages> = [];
    do {
      reportRows = readRootMessages();
      pollCount += 1;
      const goals = wakeProofs.map(({ run, wake }) => ({
        goalId: run.goalId,
        wakeRowId: wake.id,
        candidates: reportRows.filter(message => message.id > wake.id).map(message => ({
          role: message.role,
          rowId: message.id,
          sdkMessageId: message.sdkMessageId,
          completed: Number.isSafeInteger(message.info?.time?.completed),
          modelMatch: message.info?.providerID === 'openai' && message.info.modelID === 'gpt-6-luna',
          branchPathMatch: message.textParts.some(text => text.includes(run.branch!)
            && text.includes(run.worktreePath!)),
        })),
      }));
      receipt.postWakeDiagnostics = { pollCount, goals };
      if (goals.every(goal => goal.candidates.some(message => message.role === 'output'
        && message.completed && message.modelMatch && message.branchPathMatch))) break;
      if (Date.now() >= reportDeadline) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000));
    } while (Date.now() < reportDeadline);
    receipt.reportMatches = wakeProofs.map(({ run, wake, markers }) => {
      // The wake is an input prompt, never credit it as the Secretary's report.
      // SDK output after that row must separately name the exact owned branch
      // and worktree, with completed OpenAI/Luna message metadata.
      const reports = reportRows.filter(message => message.role === 'output'
        && message.id > wake.id && message.info?.providerID === 'openai'
        && message.info.modelID === 'gpt-6-luna'
        && Number.isSafeInteger(message.info.time?.completed)
        && message.textParts.some(text => text.includes(run.branch!)
          && text.includes(run.worktreePath!)));
      expect(reports.length, `real post-wake Secretary report for goal ${run.goalId}`).toBeGreaterThan(0);
      return { goalId: run.goalId, childSessionId: run.childSessionId,
        wake: { role: wake.role, rowId: wake.id, sdkMessageId: wake.sdkMessageId,
          markerCount: markers.length, markerMessageId: markers[0] },
        reports: reports.map(message => ({ role: message.role, rowId: message.id,
          sdkMessageId: message.sdkMessageId, completedMs: message.info?.time?.completed ?? null })) };
    });
    terminal = true;
    receipt.status = 'terminal-cleanup-authorized';
  } finally {
    if (root && !terminal) {
      receipt.status = 'UNVERIFIED-retain-fixture';
      // Stop only exactly identified nonce-owned runs; unknown children retain
      // the fixture and fail so the caller can inspect before any deletion.
      const response = await api.fetch('/coordinator-conversations/runs', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: root.id, projectId: root.project_id }) }).catch(() => null);
      const visible = response?.ok ? ((await response.json()) as Runs).runs : [];
      for (const run of visible.filter(item => item.objective.includes(nonce)
        && repos.some(repo => repo.repo === item.repoPath) && ['running', 'needs_you'].includes(item.status))) {
        await api.fetch('/coordinator-conversations/runs/cancel', { method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: root.id, projectId: root.project_id, goalId: run.goalId }) }).catch(() => null);
      }
    }
    save();
  }
});
}
