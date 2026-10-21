/** Real API/engine fixture helpers. Only the LLM transport is scripted. */
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { expect } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { UNTRUSTED_FENCE_OPEN, UNTRUSTED_FENCE_CLOSE } from '../security/untrusted_fence';

export const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
export const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
export const REVIEWER = 'org-reviewer';
export const READ = 'rhythm_read_org_review_context';
export const SUBMIT = 'rhythm_submit_org_review_proposal';
export const SESSION = 'rhythm_read_org_review_session';
export const CATALOG = 'rhythm_read_org_review_catalog';
export type Json = Record<string, any>;
export type Evidence = { sessionId: string; messageId: string; quote: string };

export const LOCAL_REVIEWER_MCP_ENTRYPOINT = resolve(__dirname, '../../../mcp_server/dist/index.js');

function assertReviewerMcpIsolation(config: unknown): void {
  // Inspect only the routing fields. Never stringify this object in errors:
  // mcp.rhythm.environment also contains the API token.
  const rhythm = (config as Json | null)?.mcp?.rhythm;
  if (!rhythm || rhythm.type !== 'local' || rhythm.enabled === false) {
    throw new Error('UNVERIFIED: sandbox Rhythm MCP must be an enabled local server');
  }
  for (const key of ['RHYTHM_API_URL', 'RHYTHM_AGENT_URL']) {
    let safe = false;
    try {
      const value = rhythm.environment?.[key];
      if (typeof value === 'string') {
        const url = new URL(value);
        safe = url.origin === 'http://127.0.0.1:4098' && !url.username && !url.password &&
          !url.search && !url.hash && url.pathname === '/';
      }
    } catch { /* A malformed URL is an isolation failure; its contents are private. */ }
    if (!safe) throw new Error(`UNVERIFIED: sandbox Rhythm MCP ${key} must route to the isolated API on 4098`);
  }
  const command: unknown = rhythm.command;
  if (!Array.isArray(command) || command.length !== 2 || command[0] !== 'node' || command[1] !== LOCAL_REVIEWER_MCP_ENTRYPOINT) {
    throw new Error('UNVERIFIED: sandbox Rhythm MCP must use this checkout\'s built local entrypoint');
  }
}

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
}
export async function json<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}
export async function poll<T>(read: () => Promise<T | null>, timeout = 30_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error('UNVERIFIED: timed out waiting for the real sandbox behavior');
}
export async function guard(): Promise<void> {
  assertLiveE2EIsolation();
  expect(new URL(API).origin).toBe('http://127.0.0.1:4098');
  expect(new URL(ENGINE).origin).toBe('http://127.0.0.1:4097');
  expect(await json('/opencode/health')).toMatchObject({ status: 'ready' });
  const engine = await fetch(`${ENGINE}/global/health`);
  expect(engine.status).toBe(200);
  expect(await engine.json()).toMatchObject({ healthy: true });
  const configuration = await fetch(`${ENGINE}/global/config`, { redirect: 'error' });
  if (!configuration.ok) throw new Error('UNVERIFIED: unable to inspect sandbox Rhythm MCP routing');
  assertReviewerMcpIsolation(await configuration.json());
}

function sse(model: string, call?: { name: string; input: Json }, text = 'Fixture turn completed.'): string {
  const content = call ? { type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name: call.name, input: {} } : { type: 'text', text: '' };
  return [
    { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: content },
    { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { input_tokens: 5, output_tokens: 5 } },
    { type: 'message_stop' },
  ].map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
}

function unwrap(value: any): any {
  if (typeof value === 'string') {
    const start = value.indexOf(UNTRUSTED_FENCE_OPEN);
    const end = value.lastIndexOf(UNTRUSTED_FENCE_CLOSE);
    if (start >= 0 && end > start) {
      // Parse only the fenced data region. Scanner prose outside that region
      // must never become a substitute context object or expected outcome.
      return unwrap(value.slice(start + UNTRUSTED_FENCE_OPEN.length, end).trim());
    }
    try { return unwrap(JSON.parse(value)); } catch { return value; }
  }
  if (value?.data !== undefined && (value?.success !== undefined || value?.ok !== undefined)) return unwrap(value.data);
  if (value?.structuredContent !== undefined) return unwrap(value.structuredContent);
  if (Array.isArray(value?.content)) {
    const texts = value.content.filter((block: any) => block.type === 'text').map((block: any) => block.text);
    if (texts.length === 1) return unwrap(texts[0]);
  }
  return value;
}

export class ReviewerHarness {
  readonly providerId = `org-reviewer-contract-${process.pid}-${randomUUID().slice(0, 8)}`;
  readonly modelId = 'signed-tool-transport';
  readonly marker = `[smoke] org-reviewer-${randomUUID()}`;
  readonly sessions: Json[] = [];
  private readonly sessionOwnerTokens = new Map<string, string>();
  readonly profiles: string[] = [];
  readonly schedules: string[] = [];
  readonly bodies: Json[] = [];
  private server: Server | null = null;
  private providerConfigured = false;
  private nextCall: { name: string; input: Json; family: 'mcp' | 'builtin' } | undefined;
  private nextText: string | undefined;
  readonly dispatchSelections: Json[] = [];
  reviewerSession!: Json;
  client = createOpencodeClient({ baseUrl: ENGINE, directory: process.env.RHYTHM_SANDBOX_DIR ?? '/private/tmp' });

  async setup(): Promise<void> {
    await guard();
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
        this.bodies.push(body);
        let call = this.nextCall;
        this.nextCall = undefined;
        const offeredToolNames = Array.isArray(body.tools)
          ? body.tools.map((tool: Json) => typeof tool?.name === 'string' ? tool.name : 'unknown')
          : [];
        const requested = call ? { name: call.name, family: call.family } : null;
        let selectedPath = call ? 'direct' : 'text';
        if (call && !offeredToolNames.includes(call.name) && offeredToolNames.includes('mcp_dispatch')) {
          selectedPath = 'deferred-dispatch';
          call = {
            name: 'mcp_dispatch',
            input: { family: requested!.family, action: 'execute', name: requested!.name, arguments: call.input },
            family: requested!.family,
          };
        } else if (call && !offeredToolNames.includes(call.name)) {
          selectedPath = 'requested-tool-not-offered';
        }
        this.dispatchSelections.push({
          offeredToolNames,
          requestedToolName: requested?.name ?? null,
          requestedFamily: requested?.family ?? null,
          selectedPath,
          selectedOuterToolName: call?.name ?? null,
          selectedFamily: selectedPath === 'deferred-dispatch' ? requested?.family ?? null : null,
          selectedInnerToolName: selectedPath === 'deferred-dispatch' ? requested?.name ?? null : null,
          recordedBeforeEngineExecution: true,
        });
        const text = this.nextText;
        this.nextText = undefined;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(sse(this.modelId, call, text));
      });
    });
    await new Promise<void>((done, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', done);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('fixture provider did not bind');
    const fixtureProvider = {
      npm: '@ai-sdk/anthropic', name: 'Org Reviewer deterministic transport fixture',
      options: { apiKey: 'sanitized-fixture-only', baseURL: `http://127.0.0.1:${address.port}/v1` },
      models: { [this.modelId]: { name: this.modelId, limit: { context: 200_000, output: 4_000 } } },
    };
    // PATCH deep-merges. Send only the unique fixture namespace, never a
    // snapshot of provider/model settings that another actor may have updated.
    const response = await fetch(`${ENGINE}/global/config`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: { [this.providerId]: fixtureProvider } }) });
    expect(response.status, await response.text()).toBe(200);
    this.providerConfigured = true;
    await json('/system/refresh', { method: 'POST' });
    this.reviewerSession = await this.session(REVIEWER, `${this.marker} signed boundary`);
  }
  async cleanup(): Promise<void> {
    for (const id of this.schedules.reverse()) await api(`/agent-schedules/${id}`, { method: 'DELETE' }).catch(() => undefined);
    const ownedSessionCleanupErrors: string[] = [];
    for (const session of this.sessions.reverse()) {
      const token = this.sessionOwnerTokens.get(String(session.id));
      if (!token) {
        await api(`/agent-sessions/${session.id}/hard`, { method: 'DELETE' }).catch(() => undefined);
        continue;
      }
      try {
        const removed = await api(`/agent-sessions/${session.id}/hard`, {
          method: 'DELETE', headers: { authorization: `Bearer ${token}` },
        });
        if (removed.status !== 204) {
          await removed.arrayBuffer();
          ownedSessionCleanupErrors.push(`owned session delete returned HTTP ${removed.status}`);
          continue;
        }
        const readback = await api(`/agent-sessions/${session.id}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (readback.status !== 404) {
          await readback.arrayBuffer();
          ownedSessionCleanupErrors.push(`owned session remained readable after delete (HTTP ${readback.status})`);
        }
      } catch {
        ownedSessionCleanupErrors.push('owned session cleanup request failed');
      }
    }
    this.sessionOwnerTokens.clear();
    for (const id of this.profiles.reverse()) await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
    if (this.providerConfigured) {
      // Public config PATCH cannot delete a provider (it deep-merges maps).
      // Disable this unique test namespace using the CURRENT disabled list.
      // Its sanitized inert metadata is removed with the sandbox itself.
      const current = await (await fetch(`${ENGINE}/global/config`)).json() as Json;
      const disabled = Array.isArray(current.disabled_providers) ? current.disabled_providers as string[] : [];
      await fetch(`${ENGINE}/global/config`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled_providers: [...new Set([...disabled, this.providerId])] }) });
      await api('/system/refresh', { method: 'POST' });
    }
    if (this.server) await new Promise<void>((done) => this.server!.close(() => done()));
    if (ownedSessionCleanupErrors.length) {
      throw new Error(`UNVERIFIED: ${ownedSessionCleanupErrors.join('; ')}`);
    }
  }
  async profile(label: string, prompt = 'Prepare a weekly plain-text summary. Use no external tools.'): Promise<Json> {
    const id = `org-review-fixture-${randomUUID().slice(0, 12)}`;
    const profile = await json('/agent-configs', { method: 'POST', body: JSON.stringify({
      id, label: `${this.marker} ${label}`, enabled: true, isAgent: true, isManager: false, sessionSelectable: true, schedulable: true,
      command: '', icon: '', systemPrompt: prompt, modelProvider: 'openai', modelId: 'gpt-5.6-sol',
      allowedMcpsJson: '{}', allowedSkillsJson: '[]', allowedDelegatesJson: '[]', corePermissionsJson: JSON.stringify({ '*': 'deny', task: 'deny' }),
    }) });
    this.profiles.push(profile.id);
    return profile;
  }
  async session(
    profileId: string,
    name: string,
    ownerToken?: string,
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' = 'default',
  ): Promise<Json> {
    const body: Json = { profileId, cwd: process.env.RHYTHM_SANDBOX_DIR, name, permissionMode };
    // The existing role is applied only to the exact seeded reviewer; other
    // evidence profiles retain their ordinary no-role sessions.
    if (profileId === REVIEWER) body.mcpRole = REVIEWER;
    const session = await json('/agent-sessions', { method: 'POST', headers: ownerToken ? { authorization: `Bearer ${ownerToken}` } : undefined, body: JSON.stringify(body) });
    this.sessions.push(session);
    if (ownerToken) this.sessionOwnerTokens.set(String(session.id), ownerToken);
    return session;
  }
  async scheduledReviewer(): Promise<Json> {
    const task = await json('/agent-schedules', { method: 'POST', body: JSON.stringify({
      // Match the real seed: omitting agentKind makes this API default it to
      // agentConfigId, which is a different persisted identity contract.
      name: `${this.marker} scheduled boundary`, agentKind: 'opencode', agentConfigId: REVIEWER,
      scheduleType: 'weekly', scheduledTime: '23:59', scheduledDay: 2,
      timezone: 'America/Los_Angeles', modelProvider: this.providerId, modelId: this.modelId,
      prompt: 'Report readiness for a synthetic acceptance boundary test.',
    }) });
    this.schedules.push(task.id);
    expect(task).toMatchObject({ agentKind: 'opencode', agentConfigId: REVIEWER });
    await json(`/agent-schedules/${task.id}/trigger-now`, { method: 'POST' });
    const session = await poll(async () => {
      const current = await json(`/agent-schedules/${task.id}`);
      // Live recon: this deliberately non-mutating readiness turn completes
      // as completed_no_op. Mutation outcomes are asserted by the callers.
      const terminal = ['error', 'cancelled', 'blocked_on_approval'];
      if (terminal.includes(current.lastRunStatus)) {
        throw new Error(`UNVERIFIED: scheduled boundary fixture lastRunStatus=${current.lastRunStatus}`);
      }
      if (!['success', 'completed_no_op'].includes(current.lastRunStatus)) return null;
      const result = await json(`/agent-sessions?scheduledTaskId=${task.id}`);
      return (Array.isArray(result) ? result : result.sessions)[0] ?? null;
    }, 120_000);
    this.sessions.push(session);
    await json(`/agent-schedules/${task.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    expect(session.profileId).toBe(REVIEWER);
    expect(session.scheduledTaskId).toBe(task.id);
    return session;
  }
  async syntheticOwner(): Promise<{ token: string; userId: number }> {
    const tokenPath = await realpath(process.env.RHYTHM_ORG_REVIEWER_OWNER_TOKEN_PATH ?? '/private/tmp/org-reviewer-sandbox-token');
    if (!tokenPath.startsWith('/private/tmp/')) throw new Error('UNVERIFIED: owner token must come from the sanitized temporary fixture');
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const identity = await json('/auth/me', { headers: { authorization: `Bearer ${token}` } });
    const expectedIdText = process.env.RHYTHM_ORG_REVIEWER_OWNER_USER_ID;
    const expectedEmail = process.env.RHYTHM_ORG_REVIEWER_OWNER_EMAIL;
    const fixtureActorPinned = expectedIdText !== undefined || expectedEmail !== undefined;
    const expectedId = Number(expectedIdText);
    const matchesPinnedFixture = fixtureActorPinned && Number.isInteger(expectedId) && expectedId > 0 &&
      typeof expectedEmail === 'string' && expectedEmail.endsWith('.invalid') &&
      identity.user?.id === expectedId && identity.user?.email === expectedEmail;
    const matchesLegacySyntheticActor = !fixtureActorPinned && Number.isInteger(identity.user?.id) &&
      identity.user?.email === 'org-reviewer-sandbox@example.invalid';
    if (!matchesPinnedFixture && !matchesLegacySyntheticActor) {
      throw new Error('UNVERIFIED: owner credential must authenticate the explicitly approved synthetic fixture actor');
    }
    return { token, userId: identity.user.id };
  }
  async transcript(profile: Json, text: string, ownerToken?: string, existing?: Json): Promise<Evidence> {
    const session = existing ?? await this.session(profile.id, `${this.marker} failure evidence`, ownerToken);
    this.nextText = text;
    await this.prompt(session, 'Report the observed outcome of this sanitized fixture execution.');
    return poll(async () => {
      const response = await json(`/agent-sessions/${session.id}/messages`);
      const messages: Json[] = Array.isArray(response) ? response : response.messages;
      const message = messages.find((entry) => JSON.stringify(entry).includes(text));
      return message ? { sessionId: session.id, messageId: String(message.sdkMessageId ?? message.id), quote: text } : null;
    });
  }
  async prompt(session: Json, text: string): Promise<void> {
    const response = await this.client.session.prompt({ path: { id: session.sdkSessionId }, body: {
      agent: session.opencodeAgentId ?? session.agentKind,
      model: { providerID: this.providerId, modelID: this.modelId }, parts: [{ type: 'text', text }],
    } });
    if (response.error) throw new Error(`engine prompt rejected: ${JSON.stringify(response.error)}`);
  }
  private async promptThroughApi(session: Json, text: string): Promise<void> {
    const token = this.sessionOwnerTokens.get(String(session.id));
    if (!token) throw new Error('UNVERIFIED: API prompt requires the owner token for this fixture session');
    const response = await api(`/agent-sessions/${session.id}/prompt`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: text,
        modelOverride: { providerId: this.providerId, modelId: this.modelId },
      }),
    });
    if (response.status !== 202) throw new Error(`UNVERIFIED: normal session prompt route returned HTTP ${response.status}`);
  }
  async reviewerMcpReadiness(): Promise<Json> {
    const directory = process.env.RHYTHM_SANDBOX_DIR;
    if (!directory || !directory.startsWith('/private/tmp/')) throw new Error('UNVERIFIED: reviewer MCP readiness requires the owned private cwd');
    const queryUrl = (route: string) => {
      const url = new URL(route, ENGINE);
      url.searchParams.set('directory', directory);
      return url;
    };
    const configResponse = await fetch(queryUrl('/config'));
    if (!configResponse.ok) throw new Error(`UNVERIFIED: owned instance config returned HTTP ${configResponse.status}`);
    const config = await configResponse.json() as Json;
    assertReviewerMcpIsolation(config);
    const rhythm = config.mcp?.rhythm as Json | undefined;
    const environment = rhythm?.environment as Json | undefined;
    const configGuard = {
      existingLocalCommandMatches: Array.isArray(rhythm?.command) && rhythm!.command.length === 2 &&
        rhythm!.command[0] === 'node' && rhythm!.command[1] === LOCAL_REVIEWER_MCP_ENTRYPOINT,
      syntheticApiTokenConfigured: typeof environment?.RHYTHM_API_TOKEN === 'string' && environment.RHYTHM_API_TOKEN.length > 0,
      apiAndAgentUrlsPassOwnedLoopbackGuard: true,
    };
    if (!configGuard.existingLocalCommandMatches || !configGuard.syntheticApiTokenConfigured) {
      throw new Error('UNVERIFIED: existing sandbox MCP command/token configuration did not satisfy its guard');
    }
    const connectResponse = await fetch(queryUrl('/mcp/rhythm/connect'), { method: 'POST' });
    let connectResult: unknown = null;
    if (connectResponse.ok) {
      try { connectResult = await connectResponse.json(); } catch { connectResult = null; }
    }
    const connect = { httpStatus: connectResponse.status, ok: connectResponse.ok, resultTrue: connectResult === true };
    const statusUrl = queryUrl('/mcp');
    const toolsUrl = queryUrl('/mcp/tools');
    const deadline = Date.now() + 10_000;
    const started = Date.now();
    let last: Json = {
      configGuard, connect, statusHttpStatus: null, toolsHttpStatus: null,
      rhythmStatus: null, statusServerCount: 0, toolCount: 0,
      createTaskVisible: false, waitMs: 0,
    };
    while (Date.now() < deadline) {
      const statusResponse = await fetch(statusUrl);
      if (!statusResponse.ok) throw new Error(`UNVERIFIED: owned MCP status returned HTTP ${statusResponse.status}`);
      const status = await statusResponse.json() as Json;
      const toolsResponse = await fetch(toolsUrl);
      if (!toolsResponse.ok) throw new Error(`UNVERIFIED: owned MCP tool catalog returned HTTP ${toolsResponse.status}`);
      const tools = await toolsResponse.json() as unknown;
      if (!Array.isArray(tools) || !tools.every((item) => typeof item === 'string')) throw new Error('UNVERIFIED: MCP tool catalog DTO was not a string array');
      const rhythmStatus = typeof status.rhythm?.status === 'string' ? status.rhythm.status : 'absent';
      last = {
        configGuard, connect,
        statusHttpStatus: statusResponse.status, toolsHttpStatus: toolsResponse.status,
        rhythmStatus, statusServerCount: Object.keys(status).length,
        toolCount: tools.length, createTaskVisible: tools.includes('rhythm_rhythm_create_task'),
        waitMs: Date.now() - started,
      };
      if (rhythmStatus === 'connected' && last.createTaskVisible) return last;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return last;
  }
  async call(name: string, input: Json, session = this.reviewerSession): Promise<{ value: any; raw: string; error: boolean; dispatchSelection: Json | null; assistantAgentNames: string[] }> {
    const tools = await (await fetch(`${ENGINE}/mcp/tools`)).json() as string[];
    const callable = tools.find((id) => id.endsWith(`_${name}`));
    if (!callable) throw new Error(`UNVERIFIED: required real MCP tool ${name} absent from engine`);
    return this.execute(callable, input, session, 'mcp');
  }
  async builtin(name: string, input: Json, session = this.reviewerSession): Promise<{ value: any; raw: string; error: boolean; dispatchSelection: Json | null; assistantAgentNames: string[] }> {
    return this.execute(name, input, session, 'builtin');
  }
  private async execute(name: string, input: Json, session: Json, family: 'mcp' | 'builtin'): Promise<{ value: any; raw: string; error: boolean; dispatchSelection: Json | null; assistantAgentNames: string[] }> {
    const selectionIndex = this.dispatchSelections.length;
    this.nextCall = { name, input, family };
    const before = await this.client.session.messages({ path: { id: session.sdkSessionId } });
    const beforeIds = new Set((before.data ?? []).map((message) => message.info.id));
    const promptText = `Execute fixture call ${randomUUID()}.`;
    if (this.sessionOwnerTokens.has(String(session.id))) await this.promptThroughApi(session, promptText);
    else await this.prompt(session, promptText);
    const observed = await poll(async () => {
      const messages = await this.client.session.messages({ path: { id: session.sdkSessionId } });
      const fresh = (messages.data ?? []).filter((message) => !beforeIds.has(message.info.id));
      const parts = fresh.flatMap((message) => message.parts) as Json[];
      const part = parts.find((entry) => entry.type === 'tool');
      const userMessage = fresh.find((message) => message.info.role === 'user' &&
        message.parts.some((item) => item.type === 'text' && item.text === promptText));
      const assistantMessages = fresh.filter((message) => message.info.role === 'assistant');
      const assistantAgentNames = assistantMessages.flatMap((message) => {
        if (message.info.role !== 'assistant') return [];
        // The live v1 DTO carries agent at runtime although its generated TS
        // type omits it. Validate the observed extension before using it.
        const agent = (message.info as typeof message.info & { agent?: unknown }).agent;
        return typeof agent === 'string' ? [agent] : [];
      });
      const assistantStopped = Boolean(userMessage) && assistantMessages.length > 0 && assistantMessages.every((message) =>
        message.info.role === 'assistant' && Boolean(message.info.time.completed) &&
        message.info.parentID === userMessage!.info.id && message.info.sessionID === session.sdkSessionId,
      );
      const toolBoundToTurn = Boolean(part && assistantMessages.some((message) =>
        message.info.role === 'assistant' && message.info.id === part.messageID &&
        message.info.parentID === userMessage?.info.id,
      ));
      const status = await this.client.session.status({
        query: { directory: String(session.cwd ?? process.env.RHYTHM_SANDBOX_DIR) },
        throwOnError: true,
      });
      // SessionStatus.set removes idle sessions from its map; an absent entry
      // is therefore the normal idle representation in this status-list DTO.
      const reportedStatus = status.data?.[String(session.sdkSessionId)]?.type;
      const sessionIdle = reportedStatus === undefined || reportedStatus === 'idle';
      const terminalTool = part && ['completed', 'error'].includes(String(part.state?.status));
      if (!terminalTool || !assistantStopped || !toolBoundToTurn || !assistantAgentNames.length || !sessionIdle) return null;
      return {
        part,
        raw: String(part.state?.output ?? part.state?.error ?? ''),
        assistantAgentNames,
      };
    }, 60_000);
    const { part, raw, assistantAgentNames } = observed;
    const value = unwrap(part.state?.mcpResult?.structuredContent ?? raw);
    return {
      value,
      raw,
      error: part.state?.status === 'error' || part.state?.mcpResult?.isError === true || value?.isError === true || value?.success === false || value?.ok === false,
      dispatchSelection: this.dispatchSelections[selectionIndex] ?? null,
      assistantAgentNames,
    };
  }
  async context(targetRef: string): Promise<Json> {
    const result = await this.call(READ, { windowDays: 7, sessionLimit: 100, targetRef });
    expect(result.error, result.raw).toBe(false);
    expect(result.value.targetStateHash).toEqual(expect.any(String));
    return result.value;
  }
  async payload(profile: Json, evidence: Evidence[]): Promise<Json> {
    const targetRef = `agent_config:${profile.id}`;
    const context = await this.context(targetRef);
    return {
      kind: 'refine-config', title: 'Use the required weekly summary heading',
      rationale: 'Two independent fixture sessions produced an ambiguous heading because the current prompt requests Summary rather than the required Weekly summary.',
      evidence, targetRef, change: { configPatch: { agentConfigId: profile.id, field: 'system_prompt', value: 'Prepare a weekly plain-text summary headed exactly Weekly summary. Use no external tools.' } },
      currentState: { targetRevision: context.targetRevision, targetStateHash: context.targetStateHash, checks: [{ source: 'profile', ref: targetRef, observed: profile.systemPrompt }] },
      confidence: 0.8, dedupKey: 'weekly-summary-heading',
      verificationPlan: { steps: ['Run the profile on a fixture weekly report and inspect its first heading.'], expectedOutcome: 'The first heading is exactly Weekly summary.', rollback: 'Restore the prior system prompt from the human apply snapshot.', risk: 'Low: a text-only instruction change may alter report headings.' },
    };
  }
  async queue(): Promise<Json[]> { return json('/agent-org-proposals?status=proposed'); }
}
