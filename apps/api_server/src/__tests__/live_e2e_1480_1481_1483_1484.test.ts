/**
 * S4 live gate for #1480/#1481/#1483/#1484. Drives only the running sandbox's
 * public HTTP APIs; SQLite is used solely for historical telemetry/proposal
 * fixtures that have no public producer. S3 owns startup and execution.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';
import {
  BROAD_TABLES,
  INSTALL_TABLES,
  diffTableRows,
  snapshotBytes,
  snapshotTables,
  type TableRows,
  classifyScoringPrompt,
  parseScoringPrompt,
  runBoundedPhase,
  waitForBroadRowsToSettle,
} from './_s4_harness_rows';
import { titleSimilarity } from '../services/org_audit_service';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe.sequential : describe.skip;
const timeout = 900_000;
const ids = new Set<string>();
const auditRunIds = new Set<string>();
let db: Database.Database;
let fixture: Server;
let tamperExternalBody = false;
let baselineRows: TableRows | undefined;
let baselineFiles: string | undefined;
let baselineSessionIds = new Set<string>();
let sandboxConfigPath: string | undefined;
let originalAnthropicPresent = false;
let originalAnthropicProvider: unknown;
let originalOtherProviders: Record<string, unknown> = {};
let mruSessionId: string | undefined;
let positiveEvidenceReceived = false;
let infraMarkerReceived = false;
const candidateScoreRequests: string[] = [];
const uniqueDraftScoreRequests: string[] = [];
const otherScoreRequests: string[] = [];
const extractedScoredBodies: string[] = [];
let skillDownloadRequests = 0;
const providerId = 'anthropic';
const modelId = 'claude-haiku-4-5';
const candidateSlug = randomUUID().replace(/-/g, '');
const candidateName = `S4 deployment audit ${candidateSlug}`;
const candidateBody = `# ${candidateName}\nInspect deployment provenance for run ${candidateSlug} and verify immutable release inputs.`;
const candidateDedupKey = `external-adoption:skill:${candidateName.toLowerCase()}`;
const deploymentGap = {
  title: 'deployment audit',
  problem: 'Verify immutable deployment provenance',
  tags: ['deployment'],
} as const;
const deploymentAuditPurpose = [
  `name: ${deploymentGap.title}`,
  `description: ${deploymentGap.problem}`,
  `whenToUse: ${deploymentGap.tags.join(', ')}`,
].join('\n');
const expectedDraftBody = [
  `# ${deploymentGap.title}`,
  '',
  '## Problem',
  '',
  deploymentGap.problem,
  '',
  '## Topics',
  '',
  deploymentGap.tags.map((tag) => `- ${tag}`).join('\n'),
  '',
].join('\n').trim();

interface OptimizerResult {
  auditRunId: string;
  skipped: boolean;
  capped: boolean;
  proposalsCreated: number;
  byKind: Record<string, number>;
  erroredReason?: string;
}

const optimizerResults = new Map<string, OptimizerResult>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolvePromise(value); },
      (error) => { clearTimeout(timer); rejectPromise(error); },
    );
  });
}

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

async function treeDigest(root: string): Promise<string> {
  const entries: string[] = [];
  async function walk(dir: string, prefix = ''): Promise<void> {
    let dirents;
    try { dirents = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = dirent.name;
      const relative = prefix ? `${prefix}/${name}` : name;
      const path = join(dir, name);
      if (dirent.isDirectory()) {
        await walk(path, relative);
      } else {
        const bytes = await readFile(path);
        entries.push(`${relative}:${sha(bytes.toString('base64'))}`);
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
    const result = await json<OptimizerResult>(await api('/agent-org-optimizer/run', {
      method: 'POST', body: JSON.stringify({ maxProposalsPerRun: 500, maxLlmCallsPerRun }),
    }), 200);
    if (!result.skipped) {
      auditRunIds.add(result.auditRunId);
      optimizerResults.set(result.auditRunId, result);
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
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', origin.origin);
    if (url.pathname === '/api/search') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ skills: [
        { name: 'Live path repair', id: 'owner/overlap/live-path-repair', source: 'owner/overlap', installs: 20 },
        { name: candidateName, id: `owner/unique/${candidateSlug}`, source: 'owner/unique', installs: 20 },
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
    if (url.pathname.includes('/owner/unique/')) { response.end(candidateBody); return; }
    if (url.pathname.includes('/owner/approval/')) {
      skillDownloadRequests += 1;
      response.end(tamperExternalBody ? 'changed bytes' : reviewed);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/messages') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        positiveEvidenceReceived ||= body.includes('s4-positive-config-error');
        infraMarkerReceived ||= body.includes('Cannot connect to API at http://127.0.0.1:4001');
        let content: string;
        const scoringPrompt = parseScoringPrompt(body);
        if (scoringPrompt) {
          extractedScoredBodies.push(scoringPrompt.body);
          const scoringKind = classifyScoringPrompt(
            scoringPrompt,
            candidateBody,
            expectedDraftBody,
            deploymentAuditPurpose,
          );
          if (scoringKind === 'uniqueDraft') {
            uniqueDraftScoreRequests.push(scoringPrompt.body);
            content = '20 skeletal intent stub without an actionable procedure';
          } else if (scoringKind === 'candidate') {
            candidateScoreRequests.push(scoringPrompt.body);
            content = '95 precise, complete, reusable, and actionable';
          } else {
            otherScoreRequests.push(scoringPrompt.body);
            content = '50 deterministic non-target score';
          }
        } else if (body.includes('No single recurring error')) {
          content = JSON.stringify({ diagnosis: 'Replace the skill', rootCause: 'skill', fixType: 'skill-edit',
            concreteFix: 'replacement', confidence: 'high', evidenceQuotes: ['No single recurring error'] });
        } else if (body.includes('s4-positive-config-error')) {
          content = JSON.stringify({ diagnosis: 'Use the configured model', rootCause: 'config', fixType: 'config-change',
            concreteFix: 'model: openai/gpt-5.6-sol', confidence: 'high',
            evidenceQuotes: ['s4-positive-config-error'],
            configPatch: { agentConfigId: 'untrusted', field: 'model', value: 'openai/gpt-5.6-sol' } });
        } else if (body.includes('s4-unsupported-cause')) {
          content = JSON.stringify({ diagnosis: 'Invented delegation cause', rootCause: 'skill', fixType: 'skill-edit',
            concreteFix: 'replacement', confidence: 'high', evidenceQuotes: ['quote that is absent'] });
        } else {
          content = '95 relevant, actionable, and complete';
        }
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
    baselineRows = snapshotTables(db, BROAD_TABLES);
    baselineFiles = await fileDigest();
    baselineSessionIds = new Set((db.prepare('SELECT id FROM agent_sessions').all() as Array<{ id: string }>).map((row) => row.id));

    const sandboxRootPath = await realpath(resolve(process.env.RHYTHM_SANDBOX_DIR!));
    const sandboxHomePath = await realpath(resolve(process.env.RHYTHM_SANDBOX_HOME!));
    expect(sandboxHomePath).toBe(join(sandboxRootPath, 'home'));
    sandboxConfigPath = await realpath(join(sandboxHomePath, '.config', 'opencode', 'opencode.json'));
    expect(sandboxConfigPath.startsWith(`${join(sandboxRootPath, 'home')}${sep}`)).toBe(true);
    const sandboxConfig = JSON.parse(await readFile(sandboxConfigPath, 'utf8')) as {
      provider?: Record<string, unknown>;
    };
    const originalProviders = sandboxConfig.provider ?? {};
    originalAnthropicPresent = Object.hasOwn(originalProviders, providerId);
    originalAnthropicProvider = originalAnthropicPresent
      ? structuredClone(originalProviders[providerId])
      : undefined;
    originalOtherProviders = structuredClone(Object.fromEntries(
      Object.entries(originalProviders).filter(([id]) => id !== providerId),
    ));

    const configUpdate = await fetch(`${engineUrl()}/global/config`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: {
        [providerId]: {
          npm: '@ai-sdk/anthropic',
          name: 'S4 deterministic Anthropic Haiku provider',
          options: { apiKey: 's4-fixture-key', baseURL: `${fixtureOrigin().origin}/v1` },
          models: { [modelId]: { name: 'S4 deterministic Anthropic Haiku model',
            limit: { context: 200000, output: 4096 } } },
        },
      } }),
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
    const cleanupErrors: Error[] = [];
    const attempt = async (label: string, operation: () => Promise<unknown> | unknown): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(new Error(`${label}: ${String(error)}`, { cause: error }));
      }
    };
    let createdSessions: Array<{
      id: string;
      sdk_session_id: string | null;
      parent_session_id: string | null;
      cwd: string;
    }> = [];

    try {
      if (db) {
        await attempt('enumerate owned sessions', () => {
          createdSessions = (db.prepare('SELECT id, sdk_session_id, parent_session_id, cwd FROM agent_sessions').all() as typeof createdSessions)
            .filter((row) => !baselineSessionIds.has(row.id));
        });
      }

      const sdkSessions = createdSessions.filter((row) => row.sdk_session_id);
      const ownedLocalIds = new Set(createdSessions.map((row) => row.id));
      const topLevelSessions = sdkSessions.filter((row) =>
        !row.parent_session_id || !ownedLocalIds.has(row.parent_session_id));
      const readOwnedSessionStatuses = async (): Promise<Map<string, string>> => {
        const statuses = new Map<string, string>();
        for (const cwd of new Set(sdkSessions.map((row) => row.cwd))) {
          const response = await fetch(`${engineUrl()}/session/status`, {
            headers: { 'X-OpenCode-Directory': cwd },
            signal: AbortSignal.timeout(2_000),
          });
          if (!response.ok) throw new Error(`${cwd}: status HTTP ${response.status}`);
          const bySdkId = await response.json() as Record<string, { type?: unknown }>;
          for (const row of sdkSessions.filter((session) => session.cwd === cwd)) {
            const type = bySdkId[row.sdk_session_id!]?.type;
            if (typeof type === 'string') statuses.set(row.sdk_session_id!, type);
          }
        }
        return statuses;
      };

      await attempt('close fixture server', async () => {
        if (!fixture?.listening) return;
        fixture.closeAllConnections();
        await withTimeout(new Promise<void>((done, fail) => fixture.close((error) => error ? fail(error) : done())), 2_000, 'fixture close');
      });

      await attempt('restore anthropic provider', async () => {
        if (!sandboxConfigPath) return;
        await withTimeout((async () => {
          const sandboxRootPath = await realpath(resolve(process.env.RHYTHM_SANDBOX_DIR!));
          const sandboxHomePath = await realpath(resolve(process.env.RHYTHM_SANDBOX_HOME!));
          expect(sandboxHomePath).toBe(join(sandboxRootPath, 'home'));
          const verifiedConfigPath = await realpath(sandboxConfigPath);
          expect(verifiedConfigPath.startsWith(`${join(sandboxRootPath, 'home')}${sep}`)).toBe(true);
          const config = JSON.parse(await readFile(verifiedConfigPath, 'utf8')) as { provider?: Record<string, unknown> };
          config.provider = config.provider ?? {};
          if (originalAnthropicPresent) config.provider.anthropic = structuredClone(originalAnthropicProvider);
          else delete config.provider.anthropic;
          const temporaryPath = `${verifiedConfigPath}.s4-${process.pid}-${randomUUID()}.tmp`;
          try {
            await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
            await rename(temporaryPath, verifiedConfigPath);
          } finally {
            await unlink(temporaryPath).catch(() => undefined);
          }
          expect((await api('/system/refresh', { method: 'POST', signal: AbortSignal.timeout(4_000) })).status).toBe(200);
        })(), 5_000, 'anthropic provider restoration');
      });

      let statusReadSucceeded = false;
      let activeTopLevelSessions: typeof topLevelSessions = [];
      await attempt('identify active owned top-level sessions', async () => {
        const statuses = await readOwnedSessionStatuses();
        activeTopLevelSessions = topLevelSessions.filter((row) =>
          ['busy', 'retry'].includes(statuses.get(row.sdk_session_id!) ?? 'idle'));
        statusReadSucceeded = true;
      });

      let abortSucceeded = statusReadSucceeded;
      await attempt('abort active owned top-level engine sessions', async () => {
        if (!statusReadSucceeded) return;
        const aborted = await runBoundedPhase(activeTopLevelSessions, {
          maxConcurrency: 4,
          phaseTimeoutMs: 6_000,
          requestTimeoutMs: 2_000,
          operation: async (row, signal) => {
            const response = await fetch(`${engineUrl()}/session/${encodeURIComponent(row.sdk_session_id!)}/abort`, {
              method: 'POST',
              headers: { 'X-OpenCode-Directory': row.cwd },
              signal,
            });
            if (!response.ok) throw new Error(`${row.sdk_session_id}: abort HTTP ${response.status}`);
          },
        });
        const failures = aborted.filter((result) => result.status === 'rejected');
        if (failures.length) {
          abortSucceeded = false;
          throw new AggregateError(failures.map((result) => result.reason), 'engine session aborts failed');
        }
      });

      let ownedSessionsIdle = false;
      const pollOwnedSessionsIdle = async (): Promise<void> => {
        const deadline = Date.now() + 8_000;
        do {
          const statuses = await readOwnedSessionStatuses();
          const activeIds = sdkSessions
            .filter((row) => ['busy', 'retry'].includes(statuses.get(row.sdk_session_id!) ?? 'idle'))
            .map((row) => row.sdk_session_id!);
          if (activeIds.length === 0) {
            ownedSessionsIdle = true;
            return;
          }
          await new Promise((wait) => setTimeout(wait, 250));
        } while (Date.now() < deadline);
        throw new Error(`owned engine sessions remained active: ${sdkSessions.map((row) => row.sdk_session_id).join(',')}`);
      };
      await attempt('prove owned engine sessions idle', async () => {
        if (!statusReadSucceeded || !abortSucceeded) return;
        await pollOwnedSessionsIdle();
      });

      if (ownedSessionsIdle) await attempt('delete owned top-level engine sessions', async () => {
        const deleted = await runBoundedPhase(topLevelSessions, {
          maxConcurrency: 4,
          phaseTimeoutMs: 8_000,
          requestTimeoutMs: 3_000,
          operation: async (row, signal) => {
            const response = await fetch(`${engineUrl()}/session/${encodeURIComponent(row.sdk_session_id!)}`, {
              method: 'DELETE',
              headers: { 'X-OpenCode-Directory': row.cwd },
              signal,
            });
            if (!response.ok && response.status !== 404) {
              throw new Error(`${row.sdk_session_id}: HTTP ${response.status}`);
            }
          },
        });
        deleted.forEach((result, index) => {
          if (result.status !== 'rejected') return;
          const sessionId = topLevelSessions[index].sdk_session_id!;
          console.warn(`[S4] idle top-level engine session delete diagnostic: ${sessionId}: ${String(result.reason)}`);
        });
      });

      if (db) await attempt('full producer settlement', () => waitForBroadRowsToSettle(db, { timeoutMs: 10_000 }));

      await attempt('delete owned configs', async () => {
        const deleted = await withTimeout(Promise.allSettled([...ids].map(async (id) => {
          const response = await api(`/agent-configs/${encodeURIComponent(id)}`, {
            method: 'DELETE', signal: AbortSignal.timeout(3_000),
          });
          if (!response.ok && response.status !== 404) throw new Error(`${id}: HTTP ${response.status}`);
        })), 5_000, 'owned config cleanup');
        const failures = deleted.filter((result) => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'config deletes failed');
      });

      if (db) {
        for (const runId of auditRunIds) {
          await attempt(`delete proposals for run ${runId}`, () => {
            db.prepare('DELETE FROM agent_org_proposals WHERE audit_run_id = ?').run(runId);
          });
        }
        await attempt('delete candidate exact dedup row', () => {
          db.prepare('DELETE FROM agent_org_proposals WHERE dedup_key = ?').run(candidateDedupKey);
        });
        const deletes: Array<[string, string, unknown[]]> = [];
        for (const id of ids) {
          deletes.push(
            [`messages ${id}`, 'DELETE FROM agent_session_messages WHERE session_id = ?', [id]],
            [`session ${id}`, 'DELETE FROM agent_sessions WHERE id = ?', [id]],
            [`gap ${id}`, 'DELETE FROM agent_capability_gaps WHERE id = ? OR dedup_key = ?', [id, id]],
            [`proposal refs ${id}`, 'DELETE FROM agent_org_proposals WHERE id = ? OR target_ref LIKE ? OR signal_ref LIKE ?', [id, `%${id}%`, `%${id}%`]],
            [`cookbook ${id}`, 'DELETE FROM agent_cookbook WHERE id = ?', [id]],
            [`skill ${id}`, 'DELETE FROM agent_skills WHERE id = ?', [id]],
            [`config row ${id}`, 'DELETE FROM agent_configs WHERE id = ?', [id]],
          );
        }
        if (mruSessionId) deletes.push(['MRU session', 'DELETE FROM agent_sessions WHERE id = ?', [mruSessionId]]);
        for (const { id } of createdSessions) {
          deletes.push(
            [`created messages ${id}`, 'DELETE FROM agent_session_messages WHERE session_id = ?', [id]],
            [`created session ${id}`, 'DELETE FROM agent_sessions WHERE id = ?', [id]],
          );
        }
        for (const [label, sql, parameters] of deletes) {
          await attempt(`delete ${label}`, () => { db.prepare(sql).run(...parameters); });
        }

        await attempt('final short settlement and baseline assertions', async () => {
          if (!baselineRows || baselineFiles === undefined) return;
          const settledRows = await waitForBroadRowsToSettle(db, { timeoutMs: 2_500 });
          expect(diffTableRows(baselineRows, settledRows, BROAD_TABLES)).toEqual([]);
          expect(snapshotBytes(settledRows)).toBe(snapshotBytes(baselineRows));
          expect(await fileDigest()).toBe(baselineFiles);
        });
      }

      await attempt('final provider baseline assertion', async () => {
        if (!sandboxConfigPath) return;
        const restoredResponse = await fetch(`${engineUrl()}/global/config`, { signal: AbortSignal.timeout(4_000) });
        expect(restoredResponse.status, await restoredResponse.clone().text()).toBe(200);
        const restored = await restoredResponse.json() as { provider?: Record<string, unknown> };
        const restoredProviders = restored.provider ?? {};
        if (originalAnthropicPresent) expect(restoredProviders.anthropic).toEqual(originalAnthropicProvider);
        else expect(Object.hasOwn(restoredProviders, 'anthropic')).toBe(false);
        expect(Object.fromEntries(Object.entries(restoredProviders).filter(([id]) => id !== providerId)))
          .toEqual(originalOtherProviders);
      });
    } finally {
      if (db?.open) {
        try { db.close(); } catch (error) { cleanupErrors.push(new Error(`close database: ${String(error)}`, { cause: error })); }
      }
    }

    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'S4 teardown failed');
  }, 45_000);

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
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
      .run(gapId, gapId, deploymentGap.title, deploymentGap.problem, JSON.stringify(deploymentGap.tags), now, now);
    const installedOverlapMatches = (db.prepare('SELECT id, title, body FROM agent_skills').all() as Array<{
      id: string; title: string; body: string | null;
    }>).filter((installed) =>
      titleSimilarity(installed.title, candidateName) >= 0.5 ||
      titleSimilarity(`${installed.title} ${installed.body ?? ''}`, `${candidateName} ${candidateBody}`) >= 0.5,
    ).map(({ id, title }) => ({ id, title }));
    expect(installedOverlapMatches, 'candidate must not collide with installed overlap veto').toEqual([]);
    expect(db.prepare('SELECT id, audit_run_id, status FROM agent_org_proposals WHERE dedup_key = ?').get(candidateDedupKey),
      'candidate exact dedup key must be unused before optimizer run').toBeUndefined();

    const discoveryRun = await runOptimizer(0);
    const external = proposals(discoveryRun).filter((row) => row.kind === 'external-adoption');
    expect(external.some((row) => row.change_json?.includes('Live path repair'))).toBe(false);
    const unique = db.prepare(`SELECT id, kind, target_ref, change_json, dedup_key FROM agent_org_proposals
      WHERE audit_run_id = ? AND dedup_key = ?`).all(discoveryRun, candidateDedupKey) as Array<{
        id: string; kind: string; target_ref: string | null; change_json: string | null; dedup_key: string;
      }>;
    const globalMatchingDedupRow = db.prepare(`SELECT id, audit_run_id, status, kind, target_ref, dedup_key
      FROM agent_org_proposals WHERE dedup_key = ?`).get(candidateDedupKey);
    const runResult = optimizerResults.get(discoveryRun);
    const failureDiagnostics = JSON.stringify({
      run: runResult && {
        capped: runResult.capped,
        proposalsCreated: runResult.proposalsCreated,
        error: runResult.erroredReason,
        byKind: runResult.byKind,
      },
      scorer: {
        candidate: candidateScoreRequests,
        uniqueDraft: uniqueDraftScoreRequests,
        otherScore: otherScoreRequests,
        extractedScoredBodies,
      },
      preProviderSessionErrors: (db.prepare(`SELECT id, name, status, status_message FROM agent_sessions
        WHERE category = 'self_improvement' AND status = 'error' ORDER BY created_at`).all() as Array<Record<string, unknown>>)
        .filter((row) => !baselineSessionIds.has(String(row.id))),
      currentRunProposals: proposals(discoveryRun),
      globalMatchingDedupRow,
      installedOverlapMatches,
    });
    expect(candidateScoreRequests, failureDiagnostics).toHaveLength(1);
    expect(uniqueDraftScoreRequests, failureDiagnostics).toHaveLength(1);
    expect(candidateScoreRequests, failureDiagnostics).toEqual([candidateBody]);
    expect(uniqueDraftScoreRequests, failureDiagnostics).toEqual([expectedDraftBody]);
    expect(unique, failureDiagnostics).toHaveLength(1);
    const change = JSON.parse(unique[0].change_json!);
    expect(change.downloadUrl).toMatch(new RegExp(`/owner/unique/${'c'.repeat(40)}/`));
    expect(change.skillName).toBe(candidateName);
    expect(change.contentSha256).toBe(sha(candidateBody));
  }, timeout);

  it('pr-1489-c16-c20: real install boundary rejects invalid provenance before fetch or mutation', async () => {
    await waitForBroadRowsToSettle(db);
    const profileId = await createConfig('provenance-boundary');
    const skillName = slug('allowed-install');
    const reviewed = 'reviewed bytes';
    const reviewedHash = sha(reviewed);
    const downloadBase = process.env.RHYTHM_SKILLS_DOWNLOAD_BASE!.replace(/\/$/, '');
    const allowedOrigin = fixtureOrigin();
    const alternateLoopbackHost = allowedOrigin.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    const invalidUrl = new URL(`${downloadBase}/owner/approval/HEAD/SKILL.md`);
    invalidUrl.protocol = 'http:';
    invalidUrl.hostname = alternateLoopbackHost;
    const beforeRejectedBroadRows = snapshotTables(db, BROAD_TABLES);
    const beforeRejectedInstallRows = snapshotTables(db, INSTALL_TABLES);
    const beforeRejectedFiles = await fileDigest();
    const beforeProfile = db.prepare('SELECT * FROM agent_configs WHERE id = ?').get(profileId);
    skillDownloadRequests = 0;

    const { buildRealExternalAdoptionDeps } = await import('../services/org_proposal_appliers_wiring');
    const { deleteManagedSkill, readManagedSkillBytes } = await import('../services/rhythm_managed_skills');
    const installSkill = buildRealExternalAdoptionDeps().installSkill;
    await expect(installSkill({
      skillName,
      downloadUrl: invalidUrl.toString(),
      contentSha256: reviewedHash,
      agentConfigId: profileId,
    })).rejects.toThrow(/allowed origin|commit-pinned/i);
    expect(skillDownloadRequests).toBe(0);
    expect(db.prepare('SELECT * FROM agent_configs WHERE id = ?').get(profileId)).toEqual(beforeProfile);
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_skills WHERE id = ? OR title = ?').get(skillName, skillName) as { n: number }).n).toBe(0);
    expect(snapshotBytes(snapshotTables(db, INSTALL_TABLES))).toBe(snapshotBytes(beforeRejectedInstallRows));
    expect(await fileDigest()).toBe(beforeRejectedFiles);
    const afterRejectedBroadRows = await waitForBroadRowsToSettle(db).catch((error) => {
      console.warn(`[S4] unrelated broad rows did not settle after provenance rejection: ${String(error)}`);
      return snapshotTables(db, BROAD_TABLES);
    });
    const unrelatedBroadDiff = diffTableRows(beforeRejectedBroadRows, afterRejectedBroadRows, BROAD_TABLES);
    if (unrelatedBroadDiff.length) {
      console.warn(`[S4] unrelated broad-row convergence after provenance rejection: ${JSON.stringify(unrelatedBroadDiff)}`);
    }

    expect((await api(`/agent-configs/${profileId}`, { method: 'DELETE' })).status).toBe(204);
    ids.delete(profileId);
    expect(db.prepare('SELECT * FROM agent_profile_projections WHERE profile_id = ?').get(profileId))
      .toBeUndefined();
    const beforeInstallRows = snapshotTables(db, INSTALL_TABLES);
    const beforeInstallFiles = await fileDigest();
    try {
      const installed = await installSkill({
        skillName,
        downloadUrl: `${downloadBase}/owner/approval/${'e'.repeat(40)}/SKILL.md`,
        contentSha256: reviewedHash,
      });
      expect(installed.created).toBe(true);
      expect(skillDownloadRequests).toBe(1);
      expect(readManagedSkillBytes(skillName)?.toString('utf8')).toContain(reviewed);
    } finally {
      deleteManagedSkill(skillName);
    }
    expect(snapshotBytes(snapshotTables(db, INSTALL_TABLES))).toBe(snapshotBytes(beforeInstallRows));
    expect(await fileDigest()).toBe(beforeInstallFiles);
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
    const beforeApprovalRows = snapshotTables(db, BROAD_TABLES);
    const beforeApprovalFiles = await fileDigest();
    const beforeApprovalTargets = snapshotTables(db, BROAD_TABLES.filter(({ name }) =>
      ['agent_configs', 'agent_cookbook', 'agent_skills'].includes(name)));
    tamperExternalBody = true;
    const approval = await api(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST', body: '{}' });
    const approvalBody = await approval.json().catch(() => ({})) as { status?: string };
    expect(!approval.ok || approvalBody.status === 'failed').toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_skills WHERE title = ?').get('s4-changed-bytes') as { n: number }).n).toBe(0);
    expect(snapshotBytes(snapshotTables(db, BROAD_TABLES.filter(({ name }) =>
      ['agent_configs', 'agent_cookbook', 'agent_skills'].includes(name)))))
      .toBe(snapshotBytes(beforeApprovalTargets));
    expect(await fileDigest()).toBe(beforeApprovalFiles);
    expect(snapshotBytes(snapshotTables(db, BROAD_TABLES))).toBe(snapshotBytes(beforeApprovalRows));

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
