/**
 * Real HTTP API + fork engine + first-party DayflowSqliteSource. Synthetic only.
 * Prerequisites/commands: fixtures/original_dayflow_context_live.md.
 * No API/engine/sandbox lifecycle, DELETE, cleanup, blanket tool approval or mocks.
 * Captured messages live only in this process; assertions/logs never print them.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { chmodSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_ORIGINAL_DAYFLOW === '1';
const BASE = 'http://127.0.0.1:4398';
// Desktop Coordinator surface (what the shipping Electron client calls). The mobile gateway
// (4399) exposes these routes only under /mobile-gateway and 404s this path.
const GATEWAY = BASE;
// Exact fixed sandbox roots only (same set as the grid transport guard); anything else fails beforeAll.
const SANDBOX = ['/private/tmp/sdmr-grid-sandbox', '/private/tmp/sdmr-grid-sandbox-r6u', '/private/tmp/sdmr-grid-sandbox-r14c']
  .find((root) => root === process.env.RHYTHM_SANDBOX_DIR) ?? '/private/tmp/sdmr-grid-sandbox';
const OBSERVATION = 'OD_SYNTHETIC_OBSERVATION';
const DAYFLOW_RAW_TOOL = 'rhythm_recent_dayflow_summaries';
const headers = { Authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
type Fixture = {
  schemaVersion: 1; syntheticOnly: true; sessionId: string; projectId: string;
  profileId: string; coordinatorSessionId?: string; foreignProjectId?: string; journalPath: string; configPath: string;
};
type Session = { id: string; ownerUserId: number | null; projectId: string | null; status: string; statusMessage: string | null; cwd: string };
type Message = { role: string; content?: unknown };
type Capture = { messages: Message[]; lastUser: string; tools: string[] };
const received: Capture[] = [];
const discoveredReads = new Map<string, string>();
let provider: Server | undefined;
let dbPath = '';
let fixture: Fixture;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(value: boolean, label: string): void { expect(value, label).toBe(true); }
function confined(path: string, root: string): string {
  const actual = realpathSync(path), parent = realpathSync(root);
  check(actual.startsWith(`${parent}/`), 'fixture path confined');
  return actual;
}
function readDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { return fn(db); } finally { db.close(); }
}
function text(message: Message | undefined): string {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content.map((part: { text?: string; output?: { value?: string } | string }) =>
    part.text ?? (typeof part.output === 'string' ? part.output : part.output?.value) ?? '').join('');
}
async function http(path: string, body?: unknown, gateway = false): Promise<Response> {
  return fetch(`${gateway ? GATEWAY : BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000), redirect: 'error',
  });
}
async function json<T>(path: string, body?: unknown, gateway = false): Promise<T> {
  const response = await http(path, body, gateway);
  if (!response.ok) throw new Error(`Synthetic route HTTP ${response.status}`);
  return await response.json() as T;
}
async function poll(fn: () => Promise<boolean>, label: string, timeout = 90_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await pause(200); }
  throw new Error(`FAIL: ${label} — no context/transcript emitted`);
}
async function session(id = fixture.sessionId): Promise<Session> {
  return (await json<{ session: Session }>(`/agent-sessions/${id}`)).session;
}
function retained(id = fixture.sessionId): { marker: string | null; manifests: string[] } {
  return readDb(db => ({
    marker: (db.prepare('SELECT dayflow_context_nonreuse_code AS marker FROM agent_sessions WHERE id=?').get(id) as { marker: string | null }).marker,
    manifests: (db.prepare('SELECT dayflow_context_manifest_json AS manifest FROM agent_turn_dispatches WHERE session_id=? AND dayflow_context_manifest_json IS NOT NULL ORDER BY rowid').all(id) as { manifest: string }[]).map(row => row.manifest),
  }));
}
function coordinatorId(): string {
  if (!fixture.coordinatorSessionId) blocked('Coordinator automatic-overlay case requires coordinatorSessionId returned by authenticated resolve/setup, distinct from ordinary interactive sessionId');
  check(fixture.coordinatorSessionId !== fixture.sessionId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(fixture.coordinatorSessionId!), 'separate bounded Coordinator root identifier');
  return fixture.coordinatorSessionId!;
}
function primaryRoot(id: string): void {
  const roots = readDb(db => (db.prepare('SELECT id,project_id,coordinator_conversation_json FROM agent_sessions WHERE owner_user_id=1 AND coordinator_conversation_json IS NOT NULL AND archived_at IS NULL').all() as {
    id: string; project_id: string; coordinator_conversation_json: string;
  }[]).filter(row => JSON.parse(row.coordinator_conversation_json).primaryOwnerRoot === true));
  check(roots.length === 1 && roots[0].id === id && roots[0].project_id === fixture.projectId, 'one genuinely designated primary Coordinator root');
  const conversation = JSON.parse(roots[0].coordinator_conversation_json) as { sessionId: string; ownerUserId: number; projectId: string };
  check(conversation.sessionId === id && conversation.ownerUserId === 1 && conversation.projectId === fixture.projectId, 'persisted primary-root scope matches actual receiver');
}
function dispatchIds(id: string): Set<string> {
  return readDb(db => new Set((db.prepare('SELECT id FROM agent_turn_dispatches WHERE session_id=?').all(id) as { id: string }[]).map(row => row.id)));
}
function foregroundProvenance(id: string, before: Set<string>): void {
  primaryRoot(id);
  const rows = readDb(db => (db.prepare('SELECT id,sdk_session_id,sdk_user_message_id,origin,requested_source,route_authed,reason_code,outcome FROM agent_turn_dispatches WHERE session_id=?').all(id) as {
    id: string; sdk_session_id: string; sdk_user_message_id: string; origin: string;
    requested_source: string; route_authed: number; reason_code: string; outcome: string;
  }[]).filter(row => !before.has(row.id)));
  check(rows.length === 1, 'exactly one real dispatch for the isolated foreground command');
  const row = rows[0];
  const sdk = readDb(db => (db.prepare('SELECT sdk_session_id FROM agent_sessions WHERE id=?').get(id) as { sdk_session_id: string }).sdk_session_id);
  check(row.sdk_session_id === sdk && Boolean(row.sdk_user_message_id), 'native user-message binding persisted');
  check(row.origin === 'prompt_api' && row.requested_source === 'session' && row.route_authed === 1 && row.reason_code === 'c2_foreground' && row.outcome === 'accepted', 'genuine authenticated c2_foreground/source=session provenance');
}
async function resolveCoordinator(): Promise<void> {
  const id = coordinatorId();
  const resolved = await json<{ kind: string; sessionId: string; projectId: string }>('/coordinator-conversations/resolve', { projectId: fixture.projectId }, true);
  check(resolved.kind === 'resolved' && resolved.sessionId === id && resolved.projectId === fixture.projectId, 'authenticated resolver returns the separate approved primary root; legacy chat is not adopted');
  primaryRoot(id);
  check((await session(id)).ownerUserId === 1 && (await session(id)).projectId === fixture.projectId, 'Coordinator root genuinely API-owned in consented project');
  check(readDb(db => (db.prepare('SELECT profile_id FROM agent_sessions WHERE id=?').get(id) as { profile_id: string }).profile_id === fixture.profileId), 'Coordinator uses only the approved loopback profile');
  confined((await session(id)).cwd, SANDBOX);
}
async function approveReadOnce(tag: string, id: string): Promise<void> {
  let permissionId = '';
  await poll(async () => {
    const name = discoveredReads.get(tag);
    if (!name) return false;
    const pending = await json<{ permissionID: string; tool: string; patterns: string[] }[]>(`/agent-sessions/${id}/pending-permissions`);
    if (pending.length === 0) return false;
    check(pending.length === 1 && pending[0].tool === name && pending[0].patterns.length === 1 && pending[0].patterns[0] === '*', 'only exact discovered read asks permission; no bash/write approval');
    permissionId = pending[0].permissionID;
    return true;
  }, 'actual recent-summaries read asks one-time permission', 30_000);
  check((await http(`/agent-sessions/${id}/permissions/${encodeURIComponent(permissionId)}/reply`, { reply: 'once', message: 'One synthetic recent-summaries read only.' })).status === 204, 'approve exact pending synthetic read once, never always');
}
async function dispatch(action: 'PWD' | 'WRITE' | 'RECENT_PWD', coordinator = false, id = coordinator ? coordinatorId() : fixture.sessionId): Promise<string> {
  const tag = randomUUID().replaceAll('-', '');
  const cwd = confined((await session(id)).cwd, SANDBOX);
  const prompt = `OD:${action}:${tag}${action === 'WRITE' ? `:${join(cwd, `od-unapproved-${tag}`)}` : ''}`;
  const before = dispatchIds(id);
  if (coordinator) {
    primaryRoot(id);
    const state = await json<{ conversation: { controlRevision: number } }>('/coordinator-conversations/open', { sessionId: id, projectId: fixture.projectId }, true);
    const response = await http('/coordinator-conversations/message', {
      sessionId: id, projectId: fixture.projectId, expectedControlRevision: state.conversation.controlRevision,
      commandKey: `od-${tag}`, message: prompt,
    }, true);
    check(response.ok, 'Coordinator foreground accepted');
    foregroundProvenance(id, before); // Assert durable authority before inspecting provider capture.
  } else {
    const response = await http(`/agent-sessions/${id}/prompt`, { prompt });
    check(response.status === 202, 'real prompt accepted (a hold is not authorized-task success)');
    const readRows = () => readDb(db => (db.prepare('SELECT id,origin,route_authed,reason_code,sdk_user_message_id FROM agent_turn_dispatches WHERE session_id=?').all(id) as {
      id: string; origin: string; route_authed: number; reason_code: string | null; sdk_user_message_id: string;
    }[]).filter(row => !before.has(row.id)));
    await poll(async () => {
      const rows = readRows();
      return rows.length > 0 && rows.every(row => Boolean(row.sdk_user_message_id));
    }, 'ordinary interactive dispatch native binding settles', 30_000);
    const rows = readRows();
    check(rows.length === 1 && rows[0].origin === 'prompt_api' && rows[0].route_authed === 1 && rows[0].reason_code === null && Boolean(rows[0].sdk_user_message_id), 'ordinary interactive dispatch has real native/authenticated binding without forged c2_foreground');
  }
  return tag;
}
function captures(tag: string): Capture[] { return received.filter(item => item.lastUser.includes(tag)); }
async function executed(tag: string, id = fixture.sessionId): Promise<void> {
  const cwd = confined((await session(id)).cwd, SANDBOX);
  await poll(async () => captures(tag).some(item => item.messages.some(message =>
    message.role === 'tool' && text(message).includes(cwd) && !/unavailable tool|invalid/i.test(text(message)))) &&
    (await session(id)).status === 'idle', 'authorized pwd really executed');
  const transcript = await json<{ messages: { role: string; rawText?: string; strippedText?: string }[] }>(`/agent-sessions/${id}/messages?limit=100`);
  check(transcript.messages.some(message => message.role === 'output' && (message.rawText ?? message.strippedText ?? '').includes(`OD_DONE ${tag}`)), 'real assistant completion');
}
async function historical(coordinator = false, signedTool = false): Promise<void> {
  const id = coordinator ? coordinatorId() : fixture.sessionId;
  const tag = await dispatch(signedTool ? 'RECENT_PWD' : 'PWD', coordinator, id);
  if (signedTool) await approveReadOnce(tag, id);
  await executed(tag, id);
  const context = captures(tag).map(item => item.messages.map(text).join('\n'));
  check(context.some(value => value.includes(OBSERVATION)), 'permitted source reached actual provider');
  check(context.some(value => /Dayflow observation evidence only/.test(value) && /Observation \(\d{4}-\d{2}-\d{2}T/.test(value)), 'timestamp and observation provenance');
  check(context.some(value => /does not establish task completion/.test(value) && /qualified Dayflow activity observations/.test(value)), 'historical evidence-only fence preserved');
  check(retained(id).manifests.length > 0, 'real exposure persisted before provider release');
  if (signedTool) {
    check(captures(tag).some(item => item.messages.some(message => message.role === 'tool' && text(message).includes(OBSERVATION) && /Dayflow observation evidence only/.test(text(message)) && /Observation \(\d{4}-\d{2}-\d{2}T/.test(text(message)))), 'actual signed recent-summaries result is fenced and timestamped at provider, not only automatic overlay');
    check(retained(id).manifests.some(value => (JSON.parse(value).candidates ?? []).length > 0), 'V1 signed-tool dependencies persisted by real receiving authority');
  }
  check(readDb(db => (db.prepare("SELECT COUNT(*) AS n FROM agent_memory WHERE owner_user_id=1 AND instr(content,?)>0").get(OBSERVATION) as { n: number }).n > 0), 'canonical observation genuinely user1-owned');
}
async function approvalStillRequired(coordinator = false): Promise<void> {
  const id = coordinator ? coordinatorId() : fixture.sessionId;
  const tag = await dispatch('WRITE', coordinator, id);
  const file = join((await session(id)).cwd, `od-unapproved-${tag}`);
  let permissionId = '';
  await poll(async () => {
    check(!existsSync(file), 'observation cannot grant write permission');
    const pending = await json<{ permissionID: string; tool: string; patterns: string[] }[]>(`/agent-sessions/${id}/pending-permissions`);
    permissionId = pending.find(item => item.tool === 'bash' && item.patterns.some(pattern => pattern.includes(file)))?.permissionID ?? '';
    return permissionId !== '';
  }, 'write asks approval');
  check(captures(tag).length > 0, 'write attempt reached real provider');
  check(!captures(tag).some(item => item.messages.some(message => message.role === 'tool' && text(message).includes(file))), 'write not executed');
  check((await http(`/agent-sessions/${id}/permissions/${encodeURIComponent(permissionId)}/reply`, { reply: 'reject', message: 'Synthetic write remains unauthorized.' })).status === 204, 'reject write only, never approve');
  await http(`/agent-sessions/${id}/cancel`, {});
  check(!existsSync(file), 'write remains absent after rejection');
}
async function heldWithoutClearing(): Promise<void> {
  const before = retained();
  check(before.manifests.length > 0, 'hold requires genuine prior exposure, not a fabricated empty manifest');
  const tag = randomUUID().replaceAll('-', '');
  const response = await http(`/agent-sessions/${fixture.sessionId}/prompt`, { prompt: `OD:PWD:${tag}` });
  if (response.ok) {
    await poll(async () => /Dayflow provider guard held this request/.test((await session()).statusMessage ?? ''), 'specific Dayflow hold diagnostic', 30_000);
  } else {
    const body = await response.json() as { error?: { message?: string }; message?: string };
    check(response.status === 502 && (body.error?.message ?? body.message) === 'Could not enqueue prompt in Opencode engine.', 'specific retained-history dispatch refusal');
  }
  await pause(2000);
  check(captures(tag).length === 0, 'foreign/revoked provider blocked');
  const after = retained();
  check(JSON.stringify(after.manifests) === JSON.stringify(before.manifests), 'retained exposure never erased');
  if (before.marker) check(after.marker === before.marker, 'existing sticky marker never cleared');
}
function blocked(reason: string): never { throw new Error(`UNVERIFIED: ${reason}`); }
/** Real dated read failure on a newly owned synthetic copy: no fake reader, config or consent change. */
async function readerUnavailable<T>(fn: () => Promise<T>): Promise<T> {
  const journal = realpathSync(fixture.journalPath);
  check(!journal.startsWith('/private/tmp/original-dayflow-approved-r1/'), 'only a newly owned synthetic journal copy is made unreadable');
  chmodSync(journal, 0o000);
  try { return await fn(); } finally { chmodSync(journal, 0o400); }
}
function consentStillCurrent(): void {
  const config = JSON.parse(readFileSync(fixture.configPath, 'utf8')) as {
    enabled: boolean; automaticImport: boolean; sourceConsent: { ownerUserId: number; projectId: string; revokedAt?: string } | null;
  };
  check(config.enabled && config.automaticImport && config.sourceConsent?.ownerUserId === 1 &&
    config.sourceConsent.projectId === fixture.projectId && !config.sourceConsent.revokedAt, 'config and consent stay current; only the reader failed');
}
const withoutObservation = (tag: string) => captures(tag).every(item => !item.messages.map(text).join('\n').includes(OBSERVATION));

(LIVE ? describe : describe.skip)('original Dayflow context live proof', () => {
  beforeAll(async () => {
    check(process.env.RHYTHM_LIVE_E2E_ISOLATED === '1', 'explicit sandbox acknowledgement');
    check(process.env.RHYTHM_LIVE_URL === BASE && process.env.RHYTHM_LIVE_ENGINE_URL === 'http://127.0.0.1:4397', 'only manager-owned ports 4398/4397');
    check(realpathSync(process.env.RHYTHM_SANDBOX_DIR ?? '') === realpathSync(SANDBOX), 'only manager sandbox');
    confined(process.env.HOME ?? '', SANDBOX); confined(process.env.TMPDIR ?? '', SANDBOX);
    dbPath = confined(process.env.DB_PATH ?? '', SANDBOX);
    check(dbPath === realpathSync(process.env.RHYTHM_LIVE_DB_PATH ?? ''), 'DB is sandbox copy, never approved read-only source');
    const manifest = process.env.RHYTHM_ORIGINAL_DAYFLOW_FIXTURE;
    if (!manifest) blocked('missing synthetic receiving-root/journal manifest; see fixtures/original_dayflow_context_live.md');
    fixture = JSON.parse(readFileSync(confined(manifest!, SANDBOX), 'utf8')) as Fixture;
    check(fixture.schemaVersion === 1 && fixture.syntheticOnly === true, 'operator synthetic fixture acknowledgement');
    check([fixture.sessionId, fixture.projectId, fixture.profileId].every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)), 'bounded fixture identifiers');
    const journal = confined(fixture.journalPath, process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '');
    check(!journal.startsWith(`${realpathSync(SANDBOX)}/`) && (statSync(journal).mode & 0o222) === 0, 'read-only approved synthetic Dayflow source outside sandbox');
    const source = new Database(journal, { readonly: true, fileMustExist: true });
    try {
      const row = source.prepare('SELECT summary FROM timeline_cards WHERE is_deleted=0').all() as { summary: string }[];
      check(row.length === 1 && row[0].summary === OBSERVATION, 'one exclusively synthetic source card');
    } finally { source.close(); }
    check(confined(fixture.configPath, SANDBOX) === realpathSync(join(dirname(dbPath), 'dayflow-integration/config.json')), 'config is the real server state beside sandbox DB');
    const config = JSON.parse(readFileSync(fixture.configPath, 'utf8')) as {
      journalPath: string; enabled: boolean; automaticImport: boolean;
      sourceConsent: { ownerUserId: number; projectId: string; revokedAt?: string } | null;
    };
    check(config.journalPath === journal && config.enabled && config.automaticImport, 'real implementation loaded selected enabled source (not disabled fallback)');
    check(config.sourceConsent?.ownerUserId === 1 && config.sourceConsent.projectId === fixture.projectId && !config.sourceConsent.revokedAt, 'durable authenticated source consent');
    const root = await session();
    check(root.ownerUserId === 1 && root.projectId === fixture.projectId, 'API confirms receiving root genuinely user1-owned');
    const ordinaryConversation = readDb(db => (db.prepare('SELECT coordinator_conversation_json FROM agent_sessions WHERE id=?').get(fixture.sessionId) as { coordinator_conversation_json: string | null }).coordinator_conversation_json);
    check(ordinaryConversation === null || JSON.parse(ordinaryConversation).primaryOwnerRoot !== true, 'ordinary interactive fixture is not replaced by primary Coordinator coverage');
    check(readDb(db => (db.prepare('SELECT profile_id FROM agent_sessions WHERE id=?').get(fixture.sessionId) as { profile_id: string }).profile_id === fixture.profileId), 'profile belongs to the actual receiving root');
    const status = await json<{ enabled: boolean; automaticImport: boolean; readiness: { state: string } }>('/dayflow-integration/status');
    check(status.enabled && status.automaticImport && status.readiness.state === 'ready', 'running real Dayflow implementation selected source');
    const profile = readDb(db => db.prepare('SELECT model_provider, model_id, core_permissions_json FROM agent_configs WHERE id=?').get(fixture.profileId) as { model_provider: string; model_id: string; core_permissions_json: string });
    check(profile.model_provider === 'original-dayflow' && profile.model_id === 'scripted', 'dedicated loopback provider, no account routing');
    check(profile.core_permissions_json === JSON.stringify({ '*': 'ask', bash: { '*': 'ask', pwd: 'allow' } }), 'only pwd allowed; MCP read asks once; generic/write fence intact');
    provider = createServer(async (request, response) => {
      if (request.socket.remoteAddress !== '127.0.0.1' || request.url !== '/v1/chat/completions' || request.method !== 'POST' || request.headers.authorization !== 'Bearer od-synthetic-only') { response.writeHead(403).end(); return; }
      try {
        const parts: Buffer[] = []; let bytes = 0;
        for await (const part of request) { bytes += part.length; if (bytes > 2_000_000) throw new Error('bounded capture'); parts.push(part); }
        const body = JSON.parse(Buffer.concat(parts).toString()) as { messages: Message[]; tools?: { function?: { name?: string } }[] };
        if (!Array.isArray(body.messages)) throw new Error('messages');
        let userIndex = -1;
        for (let i = body.messages.length - 1; i >= 0; i--) {
          if (body.messages[i].role === 'user') { userIndex = i; break; }
        }
        const lastUser = text(body.messages[userIndex]);
        const tools = (body.tools ?? []).map(item => item.function?.name ?? '');
        received.push({ messages: body.messages, lastUser, tools }); // Never headers, keys, or logs.
        const match = lastUser.match(/OD:(PWD|WRITE|RECENT_PWD):([a-f0-9]+)(?::([^\s]+))?/);
        if (!match) throw new Error('synthetic protocol');
        const [, action, tag, file] = match;
        if (action === 'WRITE' && (!file || !file.startsWith(`${realpathSync(SANDBOX)}/`) || !/^[A-Za-z0-9_./-]+$/.test(file) || file.split('/').includes('..'))) throw new Error('unsafe fixture command');
        const results = body.messages.slice(userIndex + 1).filter(item => item.role === 'tool');
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-od', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
        if (action === 'RECENT_PWD' && results.length < 3) {
          if (!tools.includes('mcp_dispatch')) throw new Error('real discovery dispatcher missing');
          let args: object;
          if (results.length === 0) {
            args = { family: 'mcp', action: 'search', query: DAYFLOW_RAW_TOOL };
          } else if (results.length === 1) {
            const discovered = JSON.parse(text(results[0])) as { tools: { name: string; server: string; rawName?: string }[] };
            const selected = discovered.tools.filter(item => item.server === 'rhythm' && (item.rawName === DAYFLOW_RAW_TOOL || item.name === `rhythm_${DAYFLOW_RAW_TOOL}`));
            if (selected.length !== 1) throw new Error('one genuine recent-summaries discovery required');
            discoveredReads.set(tag, selected[0].name);
            args = { family: 'mcp', action: 'describe', name: selected[0].name };
          } else {
            const description = JSON.parse(text(results[1])) as { name: string; inputSchema: { properties?: { limit?: unknown } } };
            const name = discoveredReads.get(tag);
            if (!name || description.name !== name || !description.inputSchema?.properties?.limit) throw new Error('real discovered schema required');
            args = { family: 'mcp', action: 'execute', name, arguments: { limit: 1 } };
          }
          send({ role: 'assistant', tool_calls: [{ index: 0, id: `call-od-read-${results.length}-${tag}`, type: 'function', function: { name: 'mcp_dispatch', arguments: JSON.stringify(args) } }] });
          send({}, 'tool_calls');
        } else if (results.length === 0 || (action === 'RECENT_PWD' && results.length === 3)) {
          const command = action === 'WRITE' ? `touch ${file}` : 'pwd';
          const direct = tools.includes('bash');
          const args = { command, description: 'Synthetic original Dayflow permission check' };
          send({ role: 'assistant', tool_calls: [{ index: 0, id: `call-od-${tag}`, type: 'function', function: { name: direct ? 'bash' : 'mcp_dispatch', arguments: JSON.stringify(direct ? args : { family: 'builtin', action: 'execute', name: 'bash', arguments: args }) } }] });
          send({}, 'tool_calls');
        } else { send({ role: 'assistant', content: `OD_DONE ${tag}` }); send({}, 'stop'); }
        response.end('data: [DONE]\n\n');
      } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
    });
    await new Promise<void>((resolve, reject) => { provider!.once('error', reject); provider!.listen(7483, '127.0.0.1', resolve); });
  }, 60_000);
  afterAll(async () => { if (provider?.listening) await new Promise<void>(resolve => provider!.close(() => resolve())); });

  it('PERMITTED interactive signed Dayflow context, continuation and unchanged task permissions', async () => {
    await historical(false, true); // Ordinary prompt → discover → describe → one approved signed read.
    await historical(); // Ordinary continuation retains genuine prior signed-tool evidence.
    await approvalStillRequired();
    console.info(JSON.stringify({ caseId: 'OD-permitted-interactive', historical: true, signedTool: true, executedPwd: true, writeUnexecuted: true }));
  }, 240_000);
  it('PERMITTED Coordinator foreground historical context', async () => {
    await resolveCoordinator();
    await historical(true);
    await historical(true); // Automatic overlay is separate from ordinary signed-tool reading.
    await approvalStillRequired(true);
    console.info(JSON.stringify({ caseId: 'OD-coordinator', historical: true, executedPwd: true, writeUnexecuted: true }));
  }, 180_000);
  it('Coordinator plan-mode foreground context with unchanged authority (supplementary; not the pwd gate above)', async () => {
    // Genuine primary roots run in permission_mode plan (bash denied). This does not relabel the
    // original pwd/pending-write Coordinator gate; it proves context + unchanged authority only.
    await resolveCoordinator();
    const id = coordinatorId();
    const cwd = confined((await session(id)).cwd, SANDBOX);
    const refused = (tag: string) => captures(tag).some(item => item.messages.some(message =>
      message.role === 'tool' && /is not permitted or not available for this session/.test(text(message))));
    const finished = (tag: string) => poll(async () => {
      if ((await session(id)).status !== 'idle') return false;
      const transcript = await json<{ messages: { role: string; rawText?: string; strippedText?: string }[] }>(`/agent-sessions/${id}/messages?limit=100`);
      return transcript.messages.some(message => message.role === 'output' && (message.rawText ?? message.strippedText ?? '').includes(`OD_DONE ${tag}`));
    }, 'real Coordinator assistant completion');
    const before = retained(id).manifests.length;
    const tag = await dispatch('PWD', true, id);
    await finished(tag);
    const context = captures(tag).map(item => item.messages.map(text).join('\n'));
    check(context.some(value => value.includes(OBSERVATION)), 'permitted source reached actual provider through the C2 foreground overlay');
    check(context.some(value => /Dayflow observation evidence only/.test(value) && /Observation \(\d{4}-\d{2}-\d{2}T/.test(value)), 'timestamp and observation provenance');
    check(retained(id).manifests.length > before, 'real V2 exposure persisted before provider release');
    check(refused(tag), 'plan-mode bash refusal reached the provider: authority unchanged by context');
    check(!captures(tag).some(item => item.messages.some(message => message.role === 'tool' && text(message).includes(cwd))), 'pwd did not execute under plan mode');
    const write = await dispatch('WRITE', true, id);
    const file = join(cwd, `od-unapproved-${write}`);
    await finished(write);
    check(refused(write) && !existsSync(file), 'write refused by plan mode and file absent');
    check((await json<unknown[]>(`/agent-sessions/${id}/pending-permissions`)).length === 0, 'no pending approval was created or granted');
    console.info(JSON.stringify({ caseId: 'OD-coordinator-plan-context', historical: true, pwdRefused: true, writeRefused: true }));
  }, 240_000);
  it('generic interactive actual Dayflow tool cannot acquire primary-root authority', async () => {
    const fresh = await json<{ id: string }>('/agent-sessions', { agentId: fixture.profileId, cwd: (await session()).cwd, name: 'OD generic signed-tool boundary', permissionMode: 'default', modelMode: 'fixed' }); // approved loopback model; no account routing
    check((await session(fresh.id)).ownerUserId === 1 && (await session(fresh.id)).projectId === null, 'generic chat is genuinely API-owned and projectless');
    const tag = await dispatch('RECENT_PWD', false, fresh.id); await approveReadOnce(tag, fresh.id); await executed(tag, fresh.id);
    check(captures(tag).some(item => item.messages.some(message => message.role === 'tool' && text(message).includes('Dayflow activity is unavailable.'))), 'actual Dayflow tool returns bounded unavailable result outside receiving scope');
    check(captures(tag).every(item => item.messages.filter(message => message.role === 'tool').every(message => !text(message).includes(OBSERVATION))), 'generic tool results omit observation rather than echoing query as evidence');
    check(captures(tag).every(item => !item.messages.map(text).join('\n').includes('Dayflow activity observation (unverified)')), 'generic chat cannot receive canonical observation body');
    check(retained(fresh.id).manifests.length === 0, 'generic tool call cannot fabricate receiving dependencies');
    console.info(JSON.stringify({ caseId: 'OD-generic-interactive', toolWithheld: true, executedPwd: true, receivingAuthorityAbsent: true }));
  }, 180_000);
  it('REVOKED retained continuation holds; new owned projectless chat recovers safely', async () => {
    await historical(false, true);
    check((await http('/dayflow-agent/source-consent', { schemaVersion: 1, action: 'revoke', sessionId: fixture.sessionId, projectId: fixture.projectId })).status === 202, 'real authenticated revoke accepted');
    await heldWithoutClearing();
    const fresh = await json<{ id: string }>('/agent-sessions', { agentId: fixture.profileId, cwd: (await session()).cwd, name: 'OD synthetic recovery', permissionMode: 'default', modelMode: 'fixed' }); // approved loopback model; no account routing
    check((await session(fresh.id)).ownerUserId === 1 && (await session(fresh.id)).projectId === null, 'fresh recovery has authentic owner, zero retained source');
    const tag = await dispatch('PWD', false, fresh.id); await executed(tag, fresh.id);
    check(captures(tag).every(item => !item.messages.map(text).join('\n').includes(OBSERVATION)), 'recovery omits revoked context');
    console.info(JSON.stringify({ caseId: 'OD-revoked', providerBlocked: true, exposureRetained: true, freshRecoveryExecuted: true }));
  }, 240_000);
  it('FOREIGN retained receiving context blocks provider and preserves existing marker', async () => {
    await historical(false, true);
    if (!fixture.foreignProjectId) blocked('FOREIGN requires an acknowledged synthetic other project in the sandbox DB');
    const db = new Database(dbPath, { fileMustExist: true });
    try {
      check(Boolean(db.prepare('SELECT id FROM projects WHERE id=?').get(fixture.foreignProjectId)), 'synthetic foreign project exists');
      // Acknowledged synthetic receiving-context change, not source authority fabrication.
      check(db.prepare('UPDATE agent_sessions SET project_id=?, dayflow_context_nonreuse_code=?, dayflow_context_nonreuse_at=? WHERE id=? AND owner_user_id=1 AND project_id=?').run(fixture.foreignProjectId!, 'dayflow_receiving_context_changed', new Date().toISOString(), fixture.sessionId, fixture.projectId).changes === 1, 'only synthetic receiving root changed');
    } finally { db.close(); }
    await heldWithoutClearing();
    check(retained().marker === 'dayflow_receiving_context_changed', 'foreign sticky marker retained');
    console.info(JSON.stringify({ caseId: 'OD-foreign', providerBlocked: true, markerRetained: true }));
  }, 180_000);
  it('UNAVAILABLE optional evidence is omitted and harmless authorized work executes', async () => {
    // Real dated read through the selected source (04:00 UTC activity-day rollover), never a stand-in.
    const activityDate = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
    const datedRead = async () => (await http('/dayflow-integration/preview', { date: activityDate })).status;
    check(await datedRead() === 200, 'selected source serves a real dated read before the failure');
    const before = retained().manifests;
    let failedRead = 200;
    const tag = await readerUnavailable(async () => {
      const id = await dispatch('RECENT_PWD'); await approveReadOnce(id, fixture.sessionId); await executed(id);
      failedRead = await datedRead();
      return id;
    });
    check(failedRead !== 200, 'selected source genuinely failed a dated read (not disabled/not_configured/revoked)');
    consentStillCurrent();
    check(captures(tag).some(item => item.messages.some(message => message.role === 'tool' && text(message).includes('Dayflow activity is unavailable.'))), 'actual Dayflow tool returns bounded unavailable result');
    check(withoutObservation(tag), 'unavailable optional evidence omitted');
    check(JSON.stringify(retained().manifests) === JSON.stringify(before), 'no exposure recorded from an unreadable source');
    console.info(JSON.stringify({ caseId: 'OD-unavailable', readerFailed: true, evidenceOmitted: true, executedPwd: true }));
  }, 240_000);
  it('EXPIRED seed: one genuine signed read only (no cancelled turn in retained history)', async () => {
    await historical(false, true);
    console.info(JSON.stringify({ caseId: 'OD-expired-seed', signedTool: true, seededAt: new Date().toISOString() }));
  }, 180_000);
  it('EXPIRED optional evidence is omitted or isolated and harmless authorized work executes', async () => {
    // Precondition is real time only: PERMITTED seeded this root; its retained receipt
    // reference must be past expiresAt by wall clock. No clock hook, no renewal suppression.
    const before = retained();
    check(before.manifests.length > 0 && before.marker === null, 'genuine prior signed-tool exposure retained, no marker');
    const expiries = before.manifests.flatMap(value => (JSON.parse(value).candidates ?? []) as { reference?: { expiresAt?: string } }[])
      .map(candidate => Date.parse(candidate.reference?.expiresAt ?? ''));
    check(expiries.length > 0 && expiries.every(Number.isFinite), 'retained qualified references carry receipt expiry');
    if (Math.max(...expiries) > Date.now()) blocked(`retained receipt not yet expired; rerun after ${new Date(Math.max(...expiries)).toISOString()}`);
    const tag = await dispatch('PWD');
    await executed(tag);
    check(withoutObservation(tag), 'expired optional evidence isolated from provider history');
    const after = retained();
    check(JSON.stringify(after.manifests) === JSON.stringify(before.manifests), 'retained expired exposure never rewritten or silently renewed');
    check(after.marker === null, 'expiry isolates evidence without a sticky hold');
    console.info(JSON.stringify({ caseId: 'OD-expired', retainedExpired: true, evidenceIsolated: true, executedPwd: true }));
  }, 180_000);
  it('AgentRunner scheduled work continues with unavailable optional evidence', async () => {
    const tag = randomUUID().replaceAll('-', '');
    const run = await readerUnavailable(async () => {
      // No Authorization: a system schedule has no owner, exactly like AgentRunner's own schedules.
      const created = await fetch(`${BASE}/agent-schedules`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ name: `OD scheduled unavailable ${tag.slice(0, 8)}`, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', agentConfigId: fixture.profileId, prompt: `OD:PWD:${tag}` }),
      });
      check(created.ok, 'system schedule created through the real API');
      const schedule = await created.json() as { id: string; createdByUserId: number | null };
      check(schedule.createdByUserId === null, 'system schedule is ownerless');
      check((await http(`/agent-schedules/${schedule.id}/trigger-now`, {})).ok, 'real trigger-now accepted');
      let terminal = '';
      await poll(async () => {
        terminal = (await json<{ lastRunStatus: string | null }>(`/agent-schedules/${schedule.id}`)).lastRunStatus ?? '';
        return ['success', 'completed_no_op', 'error', 'blocked_on_approval'].includes(terminal);
      }, 'schedule terminal status', 180_000);
      const rows = readDb(db => db.prepare('SELECT id,cwd,owner_user_id,category,dayflow_context_nonreuse_code AS marker FROM agent_sessions WHERE scheduled_task_id=?').all(schedule.id) as {
        id: string; cwd: string; owner_user_id: number | null; category: string; marker: string | null;
      }[]);
      check(rows.length === 1 && rows[0].owner_user_id === null && rows[0].category === 'scheduled' && rows[0].marker === null, 'one ownerless scheduled AgentRunner session, no Dayflow marker');
      check(terminal === 'success' || terminal === 'completed_no_op', 'scheduled run completed; not held or errored');
      const cwd = realpathSync(rows[0].cwd);
      await poll(async () => captures(tag).some(item => item.messages.some(message =>
        message.role === 'tool' && text(message).includes(cwd) && !/unavailable tool|invalid/i.test(text(message)))), 'scheduled pwd really executed', 60_000);
      return { id: rows[0].id };
    });
    const transcript = await json<{ messages: { role: string; rawText?: string; strippedText?: string }[] }>(`/agent-sessions/${run.id}/messages?limit=100`);
    check(transcript.messages.some(message => message.role === 'output' && (message.rawText ?? message.strippedText ?? '').includes(`OD_DONE ${tag}`)), 'real scheduled assistant completion');
    check(withoutObservation(tag), 'unavailable optional evidence absent from scheduled provider context');
    console.info(JSON.stringify({ caseId: 'OD-scheduled-unavailable', ownerless: true, executedPwd: true, evidenceOmitted: true }));
  }, 240_000);
});
