/**
 * S4 live gate for #1480/#1481/#1483/#1484. Drives only the running sandbox's
 * public HTTP APIs; SQLite is used solely for historical telemetry/proposal
 * fixtures that have no public producer. S3 owns startup and execution.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe.sequential : describe.skip;
const timeout = 900_000;
const ids = new Set<string>();
const auditRunIds = new Set<string>();
let db: Database.Database;
let fixture: Server;
let tamperExternalBody = false;
let baselineRows: string;
let baselineFiles: string;
let baselineSessionIds = new Set<string>();
let originalGlobalConfig: Record<string, unknown> | undefined;
let mruSessionId: string | undefined;
let positiveEvidenceReceived = false;
let infraMarkerReceived = false;
const providerId = `s4-diagnosis-${process.pid}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
const modelId = `s4-diagnosis-model-${randomUUID().replace(/-/g, '').slice(0, 8)}`;

function baseUrl(): string {
  return (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
}

function engineUrl(): string {
  return (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function json<T>(response: Response, status: number): Promise<T> {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  return JSON.parse(text) as T;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function anthropicTextStream(content: string): string {
  const events = [
    { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: modelId,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null } },
    { type: 'message_stop' },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
}

function rowDigest(): string {
  const tables = [
    'agent_configs', 'agent_cookbook', 'agent_skills', 'agent_org_proposals',
    'agent_sessions', 'agent_session_messages',
  ];
  return sha(JSON.stringify(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])));
}

function tableDigest(...tables: string[]): string {
  return sha(JSON.stringify(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])));
}

async function treeDigest(root: string): Promise<string> {
  const entries: string[] = [];
  async function walk(dir: string, prefix = ''): Promise<void> {
    let names: string[];
    try { names = (await readdir(dir)).sort(); } catch { return; }
    for (const name of names) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const path = join(dir, name);
      try {
        const bytes = await readFile(path);
        entries.push(`${relative}:${sha(bytes.toString('base64'))}`);
      } catch {
        await walk(path, relative);
      }
    }
  }
  await walk(root);
  return sha(entries.join('\n'));
}

async function fileDigest(): Promise<string> {
  const home = process.env.RHYTHM_SANDBOX_HOME!;
  const skills = process.env.RHYTHM_MANAGED_SKILLS_DIR!;
  return sha(`${await treeDigest(join(home, '.config', 'opencode', 'agents'))}:${await treeDigest(skills)}`);
}

function slug(label: string): string {
  return `s4-${label}-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

async function createConfig(label: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = slug(label);
  ids.add(id);
  await json(await api('/agent-configs', { method: 'POST', body: JSON.stringify({
    id, label: `S4 ${label}`, icon: '', systemPrompt: 'Disposable S4 live fixture.',
    enabled: true, isAgent: true, sessionSelectable: false, schedulable: false, ...extra,
  }) }), 201);
  return id;
}

interface ToolSpec { tool: string; input: Record<string, unknown>; status: 'error' | 'completed'; start: number }

function seedSession(agentId: string, statusMessage: string, tools: ToolSpec[] = []): string {
  const id = randomUUID();
  const sdkSessionId = `ses_${randomUUID().replace(/-/g, '')}`;
  const sdkMessageId = `msg_${randomUUID().replace(/-/g, '')}`;
  ids.add(id);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_sessions
    (id, name, agent_kind, status, status_message, cwd, mcp_role, sdk_session_id, created_at, updated_at, is_system, category)
    VALUES (?, ?, ?, 'error', ?, '/tmp', ?, ?, ?, ?, 0, 'chat')`)
    .run(id, `s4-${agentId}`, agentId, statusMessage, agentId, sdkSessionId, now, now);
  const parts = tools.map((tool) => ({
    id: `prt_${randomUUID().replace(/-/g, '')}`, sessionID: sdkSessionId, messageID: sdkMessageId,
    type: 'tool', callID: `call_${randomUUID().replace(/-/g, '')}`, tool: tool.tool,
    state: tool.status === 'error'
      ? { status: 'error', input: tool.input, error: statusMessage, metadata: {}, time: { start: tool.start, end: tool.start + 10 } }
      : { status: 'completed', input: tool.input, output: 'ok', title: tool.tool, metadata: {}, time: { start: tool.start, end: tool.start + 10 } },
  }));
  db.prepare(`INSERT INTO agent_session_messages
    (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, tokens_json, created_at)
    VALUES (?, 'output', ?, ?, ?, ?, '{"input":100,"output":50}', ?)`)
    .run(id, statusMessage, statusMessage, sdkMessageId, JSON.stringify(parts), now);
  return id;
}

async function runOptimizer(maxLlmCallsPerRun: number): Promise<string> {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const result = await json<{ auditRunId: string; skipped: boolean }>(await api('/agent-org-optimizer/run', {
      method: 'POST', body: JSON.stringify({ maxProposalsPerRun: 500, maxLlmCallsPerRun }),
    }), 200);
    if (!result.skipped) {
      auditRunIds.add(result.auditRunId);
      return result.auditRunId;
    }
    await new Promise((wait) => setTimeout(wait, 5_000));
  }
  throw new Error('optimizer remained cold-start skipped');
}

function proposals(runId: string): Array<{ id: string; kind: string; target_ref: string | null; change_json: string | null }> {
  return db.prepare(`SELECT id, kind, target_ref, change_json FROM agent_org_proposals WHERE audit_run_id = ?`)
    .all(runId) as Array<{ id: string; kind: string; target_ref: string | null; change_json: string | null }>;
}

function fixtureOrigin(): URL {
  const search = process.env.RHYTHM_EXTERNAL_DISCOVERY_SEARCH_URL ?? '';
  if (!search) throw new Error('RHYTHM_EXTERNAL_DISCOVERY_SEARCH_URL is required for the loopback fixture');
  return new URL(search);
}

async function startFixture(): Promise<Server> {
  const origin = fixtureOrigin();
  expect(['127.0.0.1', 'localhost']).toContain(origin.hostname);
  const commit = 'c'.repeat(40);
  const reviewed = 'reviewed bytes';
  const uniqueBody = '# Unique deployment audit\nInspect deployment provenance and verify immutable release inputs.';
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', origin.origin);
    if (url.pathname === '/api/search') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ skills: [
        { name: 'Live path repair', id: 'owner/overlap/live-path-repair', source: 'owner/overlap', installs: 20 },
        { name: 'Unique deployment audit', id: 'owner/unique/unique-deployment-audit', source: 'owner/unique', installs: 20 },
      ] }));
      return;
    }
    if (/^\/repos\/owner\/(?:overlap|unique)$/.test(url.pathname)) {
      const repo = url.pathname.endsWith('overlap') ? 'overlap' : 'unique';
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ full_name: `owner/${repo}`, pushed_at: '2026-08-26T00:00:00Z',
        stargazers_count: 50, license: { spdx_id: 'MIT' }, owner: { login: 'owner' }, default_branch: 'main' }));
      return;
    }
    if (/^\/repos\/owner\/(?:overlap|unique)\/commits\/main$/.test(url.pathname)) {
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ sha: commit })); return;
    }
    if (url.pathname.includes('/owner/overlap/')) { response.end('# Live path repair\nRepair login-shell PATH configuration.'); return; }
    if (url.pathname.includes('/owner/unique/')) { response.end(uniqueBody); return; }
    if (url.pathname.includes('/owner/approval/')) { response.end(tamperExternalBody ? 'changed bytes' : reviewed); return; }
    if (request.method === 'POST' && url.pathname === '/v1/messages') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        positiveEvidenceReceived ||= body.includes('s4-positive-config-error');
        infraMarkerReceived ||= body.includes('Cannot connect to API at http://127.0.0.1:4001');
        const content = body.includes('No single recurring error')
          ? JSON.stringify({ diagnosis: 'Replace the skill', rootCause: 'skill', fixType: 'skill-edit',
            concreteFix: 'replacement', confidence: 'high', evidenceQuotes: ['No single recurring error'] })
          : body.includes('s4-positive-config-error')
            ? JSON.stringify({ diagnosis: 'Use the configured model', rootCause: 'config', fixType: 'config-change',
              concreteFix: 'model: openai/gpt-5.6-sol', confidence: 'high',
              evidenceQuotes: ['s4-positive-config-error'],
              configPatch: { agentConfigId: 'untrusted', field: 'model', value: 'openai/gpt-5.6-sol' } })
            : body.includes('s4-unsupported-cause')
              ? JSON.stringify({ diagnosis: 'Invented delegation cause', rootCause: 'skill', fixType: 'skill-edit',
                concreteFix: 'replacement', confidence: 'high', evidenceQuotes: ['quote that is absent'] })
            : '95 relevant, actionable, and complete';
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(anthropicTextStream(content));
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(Number(origin.port), origin.hostname, done); });
  return server;
}

function taskRules(markdown: string): string[] {
  const lines = markdown.split('\n---\n', 1)[0].split('\n');
  const start = lines.findIndex((line) => line === '  task:');
  if (start < 0) return [];
  return lines.slice(start + 1).filter((line) => line.startsWith('    ')).map((line) => line.trim());
}

describeLive('S4 optimizer generator and projection public-surface gate', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(baseUrl());
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
    expect(['', '4000', '4001']).not.toContain(url.port);
    const dbPath = process.env.DB_PATH ?? '';
    expect(resolve(dbPath)).toBe(resolve(process.env.RHYTHM_LIVE_DB_PATH ?? 'missing'));
    expect(process.env.RHYTHM_SANDBOX_HOME).toBeTruthy();
    expect(process.env.RHYTHM_MANAGED_SKILLS_DIR).toBeTruthy();
    expect(engineUrl()).toBeTruthy();
    const sandboxRoot = resolve(process.env.RHYTHM_SANDBOX_DIR ?? 'missing');
    for (const path of [dbPath, process.env.RHYTHM_SANDBOX_HOME!, process.env.RHYTHM_MANAGED_SKILLS_DIR!]) {
      expect(resolve(path).startsWith(`${sandboxRoot}${sep}`)).toBe(true);
    }
    expect(process.env.RHYTHM_EXTERNAL_DISCOVERY_GITHUB_ORIGIN).toBe(fixtureOrigin().origin);
    expect(process.env.RHYTHM_SKILLS_DOWNLOAD_BASE?.startsWith(fixtureOrigin().origin)).toBe(true);
    fixture = await startFixture();
    db = new Database(dbPath);
    expect((await api('/health')).ok).toBe(true);
    expect((await api('/opencode/health')).ok).toBe(true);
    baselineRows = rowDigest();
    baselineFiles = await fileDigest();
    baselineSessionIds = new Set((db.prepare('SELECT id FROM agent_sessions').all() as Array<{ id: string }>).map((row) => row.id));

    const globalConfigResponse = await fetch(`${engineUrl()}/global/config`);
    expect(globalConfigResponse.status, await globalConfigResponse.clone().text()).toBe(200);
    originalGlobalConfig = await globalConfigResponse.json() as Record<string, unknown>;
    const configured = structuredClone(originalGlobalConfig) as Record<string, unknown> & {
      provider?: Record<string, unknown>;
    };
    configured.provider = configured.provider ?? {};
    configured.provider[providerId] = {
      npm: '@ai-sdk/anthropic',
      name: 'S4 deterministic diagnosis provider',
      options: { apiKey: 's4-fixture-key', baseURL: `${fixtureOrigin().origin}/v1` },
      models: { [modelId]: { name: 'S4 deterministic diagnosis model', limit: { context: 200000, output: 4096 } } },
    };
    const configUpdate = await fetch(`${engineUrl()}/global/config`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(configured),
    });
    expect(configUpdate.status, await configUpdate.clone().text()).toBe(200);
    expect((await api('/system/refresh', { method: 'POST' })).status).toBe(200);

    mruSessionId = randomUUID();
    db.prepare(`INSERT INTO agent_sessions
      (id, name, agent_kind, status, cwd, provider_id, model_id, created_at, updated_at, is_system, category)
      VALUES (?, 'S4 deterministic diagnosis MRU', 'general', 'idle', ?, ?, ?, ?, ?, 0, 'chat')`)
      .run(mruSessionId, resolve(process.env.RHYTHM_SANDBOX_DIR!), providerId, modelId,
        '9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z');
    expect(db.prepare(`SELECT provider_id, model_id FROM agent_sessions
      WHERE provider_id IS NOT NULL AND model_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get())
      .toEqual({ provider_id: providerId, model_id: modelId });
  });

  afterAll(async () => {
    if (!db) return;
    const createdSessions = (db.prepare(`SELECT id, sdk_session_id, cwd, category FROM agent_sessions`).all() as Array<{
      id: string; sdk_session_id: string | null; cwd: string; category: string;
    }>).filter((row) => !baselineSessionIds.has(row.id));
    for (const row of createdSessions.filter((candidate) => candidate.category === 'self_improvement' && candidate.sdk_session_id)) {
      await fetch(`${engineUrl()}/session/${encodeURIComponent(row.sdk_session_id!)}`, {
        method: 'DELETE', headers: { 'X-OpenCode-Directory': row.cwd },
      }).catch(() => undefined);
    }
    for (const id of ids) await api(`/agent-configs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
    for (const runId of auditRunIds) db.prepare('DELETE FROM agent_org_proposals WHERE audit_run_id = ?').run(runId);
    for (const id of ids) {
      db.prepare('DELETE FROM agent_session_messages WHERE session_id = ?').run(id);
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
      db.prepare('DELETE FROM agent_capability_gaps WHERE id = ? OR dedup_key = ?').run(id, id);
      db.prepare('DELETE FROM agent_org_proposals WHERE id = ? OR target_ref LIKE ? OR signal_ref LIKE ?').run(id, `%${id}%`, `%${id}%`);
      db.prepare('DELETE FROM agent_cookbook WHERE id = ?').run(id);
      db.prepare('DELETE FROM agent_skills WHERE id = ?').run(id);
      db.prepare('DELETE FROM agent_configs WHERE id = ?').run(id);
    }
    if (mruSessionId) db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(mruSessionId);
    for (const { id } of createdSessions) {
      db.prepare('DELETE FROM agent_session_messages WHERE session_id = ?').run(id);
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
    }
    if (originalGlobalConfig) {
      const restored = await fetch(`${engineUrl()}/global/config`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(originalGlobalConfig),
      });
      expect(restored.status, await restored.clone().text()).toBe(200);
      expect((await api('/system/refresh', { method: 'POST' })).status).toBe(200);
    }
    if (fixture?.listening) await new Promise<void>((done) => fixture.close(() => done()));
    expect(rowDigest()).toBe(baselineRows);
    expect(await fileDigest()).toBe(baselineFiles);
    db.close();
  });

  it('optimizer generation covers recurrence, diagnosis filtering, and immutable external discovery', async () => {
    const retryId = await createConfig('retry');
    const t0 = Date.now() - 60_000;
    seedSession(retryId, 'seeded retry failure', [
      { tool: 'gitnexus_query', input: { query: 'same operation' }, status: 'error', start: t0 },
      { tool: 'gitnexus_query', input: { query: 'same operation' }, status: 'error', start: t0 + 1_000 },
    ]);
    const firstRun = await runOptimizer(0);
    expect(proposals(firstRun).filter((row) => row.kind === 'create-recipe' && row.target_ref === `agent_config:${retryId}`)).toHaveLength(0);

    seedSession(retryId, 'seeded retry failure', [
      { tool: 'gitnexus_query', input: { query: 'same operation' }, status: 'error', start: t0 },
      { tool: 'gitnexus_query', input: { query: 'same operation' }, status: 'error', start: t0 + 1_000 },
    ]);
    const secondRun = await runOptimizer(0);
    const recipes = proposals(secondRun).filter((row) => row.kind === 'create-recipe' && row.target_ref === `agent_config:${retryId}`);
    expect(recipes).toHaveLength(1);
    const recipe = JSON.parse(recipes[0].change_json!);
    expect(JSON.parse(recipe.steps_json)).not.toEqual([{ action: 'prompt', text: recipe.title }]);

    const shellId = slug('title-shell'); ids.add(shellId);
    const shellTitle = `Recipe: reduce retry loops (${retryId})`;
    db.prepare('INSERT INTO agent_cookbook (id, title, description, steps_json) VALUES (?, ?, ?, ?)')
      .run(shellId, shellTitle, 'shell', JSON.stringify([{ action: 'prompt', text: shellTitle }]));
    const shellRun = await runOptimizer(0);
    expect(proposals(shellRun).filter((row) => row.kind === 'refine-recipe' && row.target_ref?.includes(shellId))).toHaveLength(0);

    const infraId = await createConfig('infra');
    for (let i = 0; i < 6; i++) seedSession(infraId, 'Cannot connect to API at http://127.0.0.1:4001');
    const weakId = await createConfig('weak');
    for (let i = 0; i < 6; i++) seedSession(weakId, `distinct escalated outcome ${i}`);
    const positiveId = await createConfig('positive');
    for (let i = 0; i < 6; i++) seedSession(positiveId, 's4-positive-config-error');
    const unsupportedId = await createConfig('unsupported');
    for (let i = 0; i < 6; i++) seedSession(unsupportedId, 's4-unsupported-cause');
    const diagnosisRun = await runOptimizer(50);
    const diagnoses = proposals(diagnosisRun);
    expect(diagnoses.filter((row) => row.target_ref === `agent_config:${infraId}`)).toHaveLength(0);
    expect(diagnoses.filter((row) => row.kind === 'workflow-prompt-fix' && row.target_ref === `agent_config:${weakId}`)).toHaveLength(0);
    expect(diagnoses.filter((row) => row.kind === 'refine-config' && row.target_ref === `profile:${positiveId}`)).toHaveLength(1);
    expect(diagnoses.filter((row) => row.target_ref === `agent_config:${unsupportedId}`)).toHaveLength(0);
    expect(positiveEvidenceReceived).toBe(true);
    expect(infraMarkerReceived).toBe(false);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM agent_sessions
      WHERE category = 'self_improvement' AND name LIKE ?`).get(`optimizer-diagnosis: ${weakId}%`) as { n: number }).n).toBeGreaterThan(0);
    const positiveDiagnosis = db.prepare(`SELECT sdk_session_id, cwd FROM agent_sessions
      WHERE category = 'self_improvement' AND name LIKE ? ORDER BY created_at DESC LIMIT 1`)
      .get(`optimizer-diagnosis: ${positiveId}%`) as { sdk_session_id: string; cwd: string } | undefined;
    expect(positiveDiagnosis?.sdk_session_id).toBeTruthy();
    const historyResponse = await fetch(`${engineUrl()}/session/${encodeURIComponent(positiveDiagnosis!.sdk_session_id)}/message`, {
      headers: { 'X-OpenCode-Directory': positiveDiagnosis!.cwd },
    });
    expect(historyResponse.status, await historyResponse.clone().text()).toBe(200);
    const history = await historyResponse.json() as Array<{ info?: { role?: string; model?: unknown } }>;
    expect(history.find((message) => message.info?.role === 'user')?.info?.model)
      .toEqual({ providerID: providerId, modelID: modelId });

    const skill = await json<{ id: string }>(await api('/agent-skills', { method: 'POST', body: JSON.stringify({
      title: 'Live path repair', description: 'Repair login-shell PATH configuration.', status: 'published', source: 's4-live',
    }) }), 201);
    ids.add(skill.id);
    const gapId = slug('gap'); ids.add(gapId);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agent_capability_gaps
      (id, dedup_key, intent_title, intent_problem, intent_tags_json, status, created_at, updated_at)
      VALUES (?, ?, 'deployment audit', 'Verify immutable deployment provenance', '["deployment"]', 'open', ?, ?)`)
      .run(gapId, gapId, now, now);
    const discoveryRun = await runOptimizer(0);
    const external = proposals(discoveryRun).filter((row) => row.kind === 'external-adoption');
    expect(external.some((row) => row.change_json?.includes('Live path repair'))).toBe(false);
    const unique = external.filter((row) => row.change_json?.includes('Unique deployment audit'));
    expect(unique).toHaveLength(1);
    const change = JSON.parse(unique[0].change_json!);
    expect(change.downloadUrl).toMatch(new RegExp(`/owner/unique/${'c'.repeat(40)}/`));
    expect(change.contentSha256).toBe(sha('# Unique deployment audit\nInspect deployment provenance and verify immutable release inputs.'));
  }, timeout);

  it('approval fails closed on changed bytes and manager projection follows the effective roster', async () => {
    const proposalId = slug('approval'); ids.add(proposalId);
    const reviewed = 'reviewed bytes';
    const downloadBase = process.env.RHYTHM_SKILLS_DOWNLOAD_BASE!.replace(/\/$/, '');
    db.prepare(`INSERT INTO agent_org_proposals
      (id, kind, risk, external, status, title, target_ref, change_json, provenance_json, dedup_key)
      VALUES (?, 'external-adoption', 'high', 1, 'proposed', 'S4 changed bytes', 'skill:s4-changed-bytes', ?, ?, ?)`)
      .run(proposalId, JSON.stringify({ candidateKind: 'skill', skillName: 's4-changed-bytes',
        downloadUrl: `${downloadBase}/owner/approval/${'d'.repeat(40)}/SKILL.md`, contentSha256: sha(reviewed) }),
      JSON.stringify({ source: 's4-loopback', stars: 1, lastUpdated: '2026-08-26', maintainer: 's4', license: 'MIT', installCommand: 's4' }),
      `external-adoption:skill:${proposalId}`);
    const beforeApprovalRows = rowDigest();
    const beforeApprovalFiles = await fileDigest();
    const beforeApprovalTargets = tableDigest('agent_configs', 'agent_cookbook', 'agent_skills');
    tamperExternalBody = true;
    const approval = await api(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST', body: '{}' });
    const approvalBody = await approval.json().catch(() => ({})) as { status?: string };
    expect(!approval.ok || approvalBody.status === 'failed').toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_skills WHERE title = ?').get('s4-changed-bytes') as { n: number }).n).toBe(0);
    expect(tableDigest('agent_configs', 'agent_cookbook', 'agent_skills')).toBe(beforeApprovalTargets);
    expect(await fileDigest()).toBe(beforeApprovalFiles);
    expect(rowDigest()).toBe(beforeApprovalRows);

    const withWorkflow = await createConfig('manager-with', { isManager: true,
      allowedDelegatesJson: JSON.stringify(['workflow-orchestrator', 'librarian']) });
    const narrow = await createConfig('manager-narrow', { isManager: true,
      allowedDelegatesJson: JSON.stringify(['librarian']) });
    const projected: Record<string, { config: { allowedDelegatesJson: string }; markdown: string }> = {};
    for (const id of [withWorkflow, narrow]) {
      const config = await json<{ allowedDelegatesJson: string }>(await api(`/agent-configs/${id}/resync-agent-file`, { method: 'POST' }), 200);
      projected[id] = { config, markdown: await readFile(join(process.env.RHYTHM_SANDBOX_HOME!, '.config', 'opencode', 'agents', `${id}.md`), 'utf8') };
    }
    expect(projected[withWorkflow].markdown).toContain('subagent_type="workflow-orchestrator"');
    expect(taskRules(projected[withWorkflow].markdown)).toContain('"workflow-orchestrator": allow');
    expect(projected[narrow].markdown).not.toContain('subagent_type="workflow-orchestrator"');
    expect(taskRules(projected[narrow].markdown)).toEqual(['"*": deny', '"explore": allow', '"general": allow', '"librarian": allow']);
    expect(JSON.parse(projected[narrow].config.allowedDelegatesJson)).toEqual(['librarian']);

    for (const id of [withWorkflow, narrow]) expect((await api(`/agent-configs/${id}`, { method: 'DELETE' })).status).toBe(204);
  }, timeout);
});
