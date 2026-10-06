/** Real API + built fork + MCP + native Task at depth three. Only model decisions
 * and the two explicitly recorded fixture-human grants are synthetic. This does
 * not qualify real-model decisions or promise an unsolicited result at the root.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const token = 'nested-fixture-token-not-a-secret';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const cleanEnv = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' });

async function command(executable: string, args: string[], env: Record<string, string> = cleanEnv(), timeout = 120_000) {
  const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
  const hardTimer = setTimeout(() => child.kill('SIGKILL'), timeout + 5_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
    });
    return { code, output };
  } finally { clearTimeout(timer); clearTimeout(hardTimer); }
}
async function until<T>(fn: () => Promise<T | null | false>, seconds: number, reason: string): Promise<T> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await wait(200); }
  throw new Error(reason);
}
async function listeners(ports: number[]) {
  return Object.fromEntries(await Promise.all(ports.map(async port => {
    const result = await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
    if (result.code !== 0 && result.code !== 1) throw new Error(`Listener inventory failed for ${port}: ${result.output}`);
    if (result.code === 1 && result.output.trim()) throw new Error(`Listener absence not proven for ${port}: ${result.output}`);
    return [port, result.output.trim().split('\n').filter(Boolean)];
  }))) as Record<string, string[]>;
}
async function request(route: string, body?: unknown, engine = false, directory?: string, method?: string) {
  const url = new URL(route, `http://127.0.0.1:${engine ? 4197 : 4198}`);
  if (directory) url.searchParams.set('directory', directory);
  const response = await fetch(url, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      ...(directory ? { 'X-OpenCode-Directory': directory } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
// A tracked symlink is source in its own right; never dereference its target.
// Missing regular files and unexpected kinds still fail closed.
async function sourceEntry(file: string) {
  const absolute = path.join(root, file);
  const before = await lstat(absolute);
  const kind = before.isSymbolicLink() ? 'symlink' : before.isFile() ? 'regular' : null;
  if (!kind) throw new Error(`Unsupported tracked source kind: ${file}`);
  const bytes = kind === 'symlink' ? await readlink(absolute, { encoding: 'buffer' }) : await readFile(absolute);
  const after = await lstat(absolute);
  if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      before.isSymbolicLink() !== after.isSymbolicLink() || before.isFile() !== after.isFile()) {
    throw new Error(`Tracked source changed during inventory: ${file}`);
  }
  return { kind, bytes: bytes.length, sha256: hash(bytes) };
}
const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value)
  ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];

describe.skipIf(!enabled)('Coordinator native → async → native permission ceilings', () => {
  for (const granted of [true, false]) {
    it(`${granted ? 'reads the exact fixture-human directory grant' : 'denies the ungranted directory'} at native depth three and exposes the real chain`, async () => {
      const sha = process.env.RHYTHM_LIVE_SOURCE_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect((await command('git', ['rev-parse', 'HEAD'])).output.trim()).toBe(sha);
      expect((await command('git', ['status', '--porcelain', '--untracked-files=no'])).output.trim()).toBe('');
      const nonce = randomUUID();
      const out = path.join(process.env.RHYTHM_COORDINATOR_LIVE_TEST_OUT ?? '/private/tmp', `rhythm-nested-${granted ? 'grant' : 'deny'}-${nonce}`);
      const sb = `/private/tmp/rhythm-nested-${nonce}`;
      const fixtures = path.join(out, 'fixtures');
      await mkdir(fixtures, { recursive: true, mode: 0o700 });
      const cwd = path.join(sb, 'fixture-project');
      const approvedDir = path.join(sb, 'fixture-reference');
      const note = path.join(approvedDir, 'note.md');
      const outside = path.join(sb, 'unapproved-reference', 'note.md');
      const editFile = path.join(cwd, 'do-not-edit.txt');
      const bashFile = path.join(cwd, 'do-not-create.txt');
      const marker = `INVENTED_REFERENCE_${nonce}`;
      const forbiddenMarker = `UNAPPROVED_REFERENCE_${nonce}`;
      const checks: Record<string, boolean> = {};
      const receipt: Record<string, any> = { sourceSha: sha, out, sandbox: sb, granted,
        modelDecisionsSynthetic: true, realModelBehaviorQualified: false, apiEngineMcpMocked: false,
        privateDataCopied: false, normalRuntimeMutated: false, grants: [], checks };
      const save = () => writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
      const protectedBefore = await listeners([4001, 4002, 4096, 49333]);
      receipt.protectedListenersBefore = protectedBefore;
      const bin = path.join(root, 'apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode');
      const binaryHash = hash(await readFile(bin));
      receipt.engineBinarySha256 = binaryHash;
      const tracked = (await command('git', ['ls-files', 'apps/api_server/src', 'apps/mcp_server/src', 'apps/opencode_fork/packages/opencode/src', 'tools/dev/sandbox.sh'])).output.trim().split('\n');
      const sourceInventory = Object.fromEntries(await Promise.all(tracked.map(async file => [file, await sourceEntry(file)])));
      const localRequire = createRequire(path.join(root, 'apps/api_server/package.json'));
      const Database = localRequire('better-sqlite3');
      const query = (sql: string, values: unknown[] = []) => {
        const db = new Database(path.join(sb, 'rhythm.db'), { readonly: true });
        try { return db.prepare(sql).all(...values) as any[]; } finally { db.close(); }
      };
      let releasePlanning!: () => void;
      const planningReleased = new Promise<void>(resolve => { releasePlanning = resolve; });
      const roleSteps = new Map<string, number>();
      const providerObservations: any[] = [];
      const replies: any[] = [];
      const asked: any[] = [];
      let providerError: Error | undefined;
      let providerStarted = false;
      let sandboxAttempted = false;
      let eventTask: Promise<void> | undefined;
      const abortEvents = new AbortController();
      let env: Record<string, string> = cleanEnv();
      const server = createServer(async (req, res) => {
        try {
          if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) throw new Error('Unexpected model request');
          let raw = ''; for await (const chunk of req) raw += chunk.toString();
          const input = JSON.parse(raw);
          const messages = input.messages ?? [];
          const user = strings(messages.filter((m: any) => m.role === 'user').at(-1)).join('\n');
          const role = user.includes('NESTED_VISIBILITY') ? 'visibility' : user.includes('NESTED_EXPLORER') ? 'explorer'
            : user.includes('NESTED_PLANNER') ? 'planner' : user.includes('NESTED_MANAGER') ? 'manager'
              : user.includes('NESTED_ROOT') ? 'root' : 'callback';
          const step = roleSteps.get(role) ?? 0; roleSteps.set(role, step + 1);
          if ([...roleSteps.values()].reduce((a, b) => a + b, 0) > 35) throw new Error('Bounded model request ceiling exceeded');
          const result = strings(messages.filter((m: any) => m.role === 'tool').at(-1)).join('\n');
          // These are invented fixture conversations only; no operator prompts are loaded.
          providerObservations.push({ role, step, toolResult: result, model: input.model });
          const names = (input.tools ?? []).map((tool: any) => tool.function?.name);
          const useTool = (name: string, args: unknown, builtin = false) => names.includes(name)
            ? { name, args } : { name: 'mcp_dispatch', args: { family: builtin ? 'builtin' : 'mcp', action: 'execute', name, arguments: args } };
          let tool: ReturnType<typeof useTool> | undefined;
          let text = 'Fixture callback acknowledged; no new work.';
          if (role === 'root' && step === 0) tool = useTool('task', { description: 'Fixture workflow delegation', subagent_type: 'workflow-orchestrator', prompt: 'NESTED_MANAGER Drive one actual asynchronous Planning child; report dispatch separately from its eventual result.' }, true);
          if (role === 'manager' && step === 0) tool = useTool('rhythm_rhythm_delegate_async', { targetAgentConfigId: 'planning-agent', prompt: 'NESTED_PLANNER Run one actual native Explore Task for the fixture read and denied actions, then return its actual task result.' });
          if (role === 'planner' && step === 0) {
            await planningReleased;
            tool = useTool('task', { description: 'Fixture third depth read', subagent_type: 'explore', prompt: 'NESTED_EXPLORER Read the fixture reference and attempt the separately denied fixture actions.' }, true);
          }
          if (role === 'explorer') {
            if (step === 0) tool = useTool('read', { filePath: note }, true);
            if (step === 1) {
              checks.actualFixtureReadOutcome = granted ? result.includes(marker) : /denied|reject|permission|not allowed/i.test(result) && !result.includes(marker);
              tool = useTool('edit', { filePath: editFile, oldString: 'UNCHANGED', newString: 'CHANGED' }, true);
            }
            if (step === 2) {
              checks.editProhibited = /denied|reject|permission|not allowed|not found|not available|unknown|authorized/i.test(result);
              tool = useTool('bash', { command: `touch '${bashFile}'`, description: 'Denied fixture write' }, true);
            }
            if (step === 3) {
              checks.bashProhibited = /denied|reject|permission|not allowed|not found|not available|unknown|authorized/i.test(result);
              tool = useTool('read', { filePath: outside }, true);
            }
            if (step === 4) {
              checks.outsideReadDenied = /denied|reject|permission|not allowed/i.test(result) && !result.includes(forbiddenMarker);
              if (!checks.actualFixtureReadOutcome || !checks.editProhibited || !checks.bashProhibited || !checks.outsideReadDenied) throw new Error('Actual native tool results failed the permission outcomes');
              text = `EXPLORER_ACTUAL_RESULT_${nonce}: ${granted ? 'approved fixture read confirmed' : 'ungranted read denied'}; edit, bash and unapproved read prohibited.`;
            }
          }
          if (role === 'planner' && step === 1) {
            checks.taskResultReturnedToImmediateParent = result.includes(`EXPLORER_ACTUAL_RESULT_${nonce}`);
            if (!checks.taskResultReturnedToImmediateParent) throw new Error('Actual Task did not return its child result to Planning');
            text = `PLANNING_ACTUAL_RESULT_${nonce}: ${result}`;
          }
          if (role === 'visibility' && step === 0) tool = useTool('rhythm_rhythm_list_sessions', {});
          if (role === 'visibility' && step === 1) {
            receipt.actualMcpVisibilityText = result;
            text = 'Actual session metadata received; this is not a fabricated top-level completion callback.';
          }
          if (role === 'manager' && step > 0) text = 'Planning was dispatched asynchronously. Its eventual result is separate from this native Task dispatch acknowledgement.';
          if (tool && !names.includes(tool.name)) throw new Error(`Actual model tool surface did not include ${tool.name}`);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          const chunk = (delta: unknown, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
          chunk({ role: 'assistant' });
          if (tool) { chunk({ tool_calls: [{ index: 0, id: `fixture-${randomUUID()}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }); chunk({}, 'tool_calls'); }
          else { chunk({ content: text }); chunk({}, 'stop'); }
          res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 } })}\n\n`);
          res.end('data: [DONE]\n\n');
        } catch (error) { providerError = error as Error; res.writeHead(500); res.end(String(error)); }
      });
      try {
        expect(Object.values(await listeners([4197, 4198, 4199])).every(value => value.length === 0)).toBe(true);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); providerStarted = true;
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('Synthetic model listener missing');
        receipt.syntheticProviderPort = address.port;
        const fixtureScript = path.join(out, 'prepare-fixture.cjs');
        await writeFile(fixtureScript, `const {createRequire}=require('node:module');const r=createRequire(process.argv[2]+'/apps/api_server/package.json');const Database=r('better-sqlite3');const db=new Database(process.argv[3]);require(process.argv[2]+'/apps/api_server/dist/database/migrations.js').runMigrations(db);db.prepare('INSERT INTO users(id,name,email) VALUES(1,?,?)').run('Synthetic nested owner','nested@example.invalid');db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,1)').run(process.argv[4]);db.prepare('UPDATE agent_configs SET enabled=0').run();db.prepare('UPDATE agent_scheduled_tasks SET enabled=0').run();for(const [id,manager,delegates] of [['secretary',1,['workflow-orchestrator']],['workflow-orchestrator',1,['planning-agent']],['planning-agent',0,[]]])db.prepare("INSERT INTO agent_configs(id,label,icon,command,is_agent,enabled,is_manager,system_prompt,model_provider,model_id,oc_agent,allowed_mcps_json,allowed_delegates_json,core_permissions_json) VALUES(?,?,?,'opencode',1,1,?,?,'test','test-model',?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,is_agent=1,is_manager=excluded.is_manager,system_prompt=excluded.system_prompt,model_provider='test',model_id='test-model',oc_agent=excluded.oc_agent,allowed_mcps_json=excluded.allowed_mcps_json,allowed_delegates_json=excluded.allowed_delegates_json,core_permissions_json=excluded.core_permissions_json,locked=0").run(id,'Fixture '+id,'check',manager,'SYNTHETIC_NESTED_'+id,id,JSON.stringify({rhythm:['rhythm_delegate_async','rhythm_list_sessions']}),JSON.stringify(delegates),JSON.stringify({read:'allow',glob:'allow',grep:'allow',edit:'deny',write:'deny',bash:'deny',external_directory:'ask'}));db.close();`);
        const dbPath = path.join(fixtures, 'rhythm.db');
        const fixture = await command(process.execPath, [fixtureScript, root, dbPath, token]);
        await writeFile(path.join(out, 'fixture.log'), fixture.output); expect(fixture.code).toBe(0);
        const configDir = path.join(fixtures, 'opencode-config'); await mkdir(configDir);
        const configPath = path.join(configDir, 'opencode.json');
        await writeFile(configPath, JSON.stringify({ model: 'test/test-model', small_model: 'test/test-model',
          provider: { test: { name: 'Synthetic fixture', env: [], npm: '@ai-sdk/openai-compatible', options: { apiKey: 'invented-fixture-key', baseURL: `http://127.0.0.1:${address.port}/v1` },
            models: { 'test-model': { id: 'test-model', name: 'Fixture model', attachment: false, reasoning: false, tool_call: true, temperature: false, limit: { context: 100000, output: 10000 }, cost: { input: 0, output: 0 }, options: {} } } } },
          mcp: { rhythm: { type: 'local', timeout: 600000, command: [process.execPath, path.join(root, 'apps/mcp_server/dist/index.js')], environment: { RHYTHM_API_URL: 'http://127.0.0.1:4198', RHYTHM_AGENT_URL: 'http://127.0.0.1:4198', RHYTHM_API_TOKEN: token } } },
        }, null, 2));
        const authPath = path.join(configDir, 'auth.json'); await writeFile(authPath, JSON.stringify({ test: { type: 'api', key: 'invented-fixture-key' } }));
        for (const file of [dbPath, configPath, authPath]) await chmod(file, 0o400); await chmod(configDir, 0o500);
        const immutableHashes = Object.fromEntries(await Promise.all([dbPath, configPath, authPath].map(async file => [file, hash(await readFile(file))])));
        env = { ...cleanEnv(), HOME: fixtures, RHYTHM_APPROVED_FIXTURE_ROOT: fixtures, RHYTHM_LIVE_DB_PATH: dbPath,
          RHYTHM_SANDBOX_OPENCODE_CONFIG: configDir, RHYTHM_SANDBOX_DIR: sb, RHYTHM_SANDBOX_API_PORT: '4198', RHYTHM_SANDBOX_ENGINE_PORT: '4197', RHYTHM_SANDBOX_GATEWAY_PORT: '4199',
          RHYTHM_SANDBOX_NODE_BIN: process.execPath, RHYTHM_SANDBOX_SKIP_ENGINE_BUILD: '1', DB_CLIENT: 'sqlite', RHYTHM_OPTIMIZER_MODE: 'shadow', OPENCODE_PURE: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', RHYTHM_NUMBAT_MONITORING_DISABLED: '1' };
        sandboxAttempted = true;
        const up = await command(path.join(root, 'tools/dev/sandbox.sh'), ['up'], env, 240_000);
        await writeFile(path.join(out, 'sandbox-up.log'), up.output); expect(up.code).toBe(0);
        // Raw fixture DB rows do not trigger ordinary profile projection. Drive
        // the same real API boundary used to reconcile a missing profile file.
        receipt.fixtureProfileProjection = [];
        for (const id of ['secretary', 'workflow-orchestrator', 'planning-agent']) {
          const projected = await request(`/agent-configs/${id}/resync-agent-file`, {});
          expect(projected.status).toBe(200);
          expect(projected.body).toMatchObject({ id, enabled: true, isAgent: true, locked: false,
            ocAgent: id, sessionSelectable: true, modelProvider: 'test', modelId: 'test-model' });
          expect(JSON.parse(projected.body.allowedMcpsJson)).toEqual({ rhythm: ['rhythm_delegate_async', 'rhythm_list_sessions'] });
          const generated = await readFile(path.join(sb, 'home/.config/opencode/agents', `${id}.md`), 'utf8');
          expect(generated).toContain('mode: all');
          expect(generated).toMatch(/^model: ["']?test\/test-model["']?$/m);
          receipt.fixtureProfileProjection.push({ id, revision: projected.body.revision, fileSha256: hash(generated) });
        }
        const projectedSecretary = await readFile(path.join(sb, 'home/.config/opencode/agents/secretary.md'), 'utf8');
        const codingSection = projectedSecretary.match(/For any coding[\s\S]*?Do this regardless of how the request is phrased\./)?.[0];
        expect(codingSection).toBeTruthy();
        expect(codingSection).toContain('In an interactive chat with AJ, call `rhythm_delegate_async` with `targetAgentConfigId="workflow-orchestrator"`');
        expect(codingSection).toContain('scheduled, headless, or system run, call the `task` tool with `subagent_type="workflow-orchestrator"`');
        expect(projectedSecretary).not.toContain('you MUST hand off to the workflow-orchestrator by calling the `task` tool');
        receipt.generatedSecretaryCodingSection = codingSection;
        checks.generatedSecretaryRoutingConsistent = true;
        const health = await request('/global/health', undefined, true); receipt.engineHealth = health;
        expect(health.body.version).toBe(`0.0.0-rhythm-${sha}`); checks.engineExactSource = true;
        for (const dir of [cwd, approvedDir, path.dirname(outside)]) await mkdir(dir, { recursive: true });
        const actualRoster = await request('/agent', undefined, true, cwd);
        expect(actualRoster.status).toBe(200); expect(Array.isArray(actualRoster.body)).toBe(true);
        const names = ['secretary', 'workflow-orchestrator', 'planning-agent', 'explore'];
        receipt.actualNamedAgentRoster = names.map(name => {
          const agent = actualRoster.body.find((item: any) => item.name === name);
          expect(agent, `Actual fork registry must resolve ${name}`).toBeTruthy();
          if (name !== 'explore') {
            expect(agent.mode).toBe('all');
            expect(agent.options.mcpAllowlist).toEqual({ servers: [], tools: ['rhythm_rhythm_delegate_async', 'rhythm_rhythm_list_sessions'] });
          }
          return { name: agent.name, mode: agent.mode, model: agent.model,
            permissionRuleCount: agent.permission?.length ?? 0, mcpAllowlist: agent.options?.mcpAllowlist };
        });
        checks.actualNamedAgentsRegistered = true;
        await writeFile(note, marker); await chmod(note, 0o400);
        await writeFile(outside, forbiddenMarker); await chmod(outside, 0o400);
        await writeFile(editFile, 'UNCHANGED');
        // Read-only global event subscription records actual native permission decisions.
        eventTask = (async () => {
          const response = await fetch('http://127.0.0.1:4197/global/event', { signal: abortEvents.signal });
          if (!response.body) throw new Error('Actual engine event stream missing');
          const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = '';
          while (!abortEvents.signal.aborted) {
            const next = await reader.read(); if (next.done) break; buffered += decoder.decode(next.value, { stream: true });
            let boundary: number;
            while ((boundary = buffered.indexOf('\n\n')) >= 0) {
              const frame = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 2);
              for (const line of frame.split('\n').filter(line => line.startsWith('data: '))) {
                const parsed = JSON.parse(line.slice(6)); const event = parsed.payload ?? parsed;
                if (event.type === 'permission.replied') replies.push(event.properties);
                if (event.type === 'permission.asked') asked.push(event.properties);
              }
            }
          }
        })().catch(error => { if (!abortEvents.signal.aborted) providerError = error; });
        const created = await request('/agent-sessions', { profileId: 'secretary', cwd, name: `Fixture nested ${nonce}`, permissionMode: 'plan', modelMode: 'fixed' });
        expect(created.status).toBe(201); const session = created.body;
        expect(session.sdkSessionId).toBeTruthy();
        const rootGrant = [{ permission: 'task', pattern: 'workflow-orchestrator', action: 'allow' }];
        const rootBefore = await request(`/session/${session.sdkSessionId}`, undefined, true, cwd);
        expect(rootBefore.status).toBe(200); expect(Array.isArray(rootBefore.body.permission)).toBe(true);
        expect((await request(`/session/${session.sdkSessionId}`, { permission: [...rootBefore.body.permission, ...rootGrant] }, true, cwd, 'PATCH')).status).toBe(200);
        receipt.grants.push({ origin: 'synthetic fixture-human setup', sdkSessionId: session.sdkSessionId, rules: rootGrant, runtimeOnly: true });
        expect((await request(`/agent-sessions/${session.id}/prompt`, { prompt: 'NESTED_ROOT Execute the exact fixture Task → asynchronous Planning → native Explore chain. Treat dispatch acknowledgement separately from completion.' })).status).toBe(202);
        const planning = await until(async () => {
          if (providerError) throw providerError;
          const rows = query('SELECT s.id,s.parent_session_id,s.sdk_session_id,s.cwd,s.permission_mode,s.approval_bypass_explicit,s.delegation_depth AS depth,d.id AS delegation_id FROM agent_sessions s JOIN agent_async_delegations d ON d.child_session_id=s.id WHERE s.agent_kind=?', ['planning-agent']);
          return rows.length === 1 && rows[0].sdk_session_id ? rows[0] : null;
        }, 80, 'No actual MCP asynchronous Planning child');
        expect(planning.permission_mode).toBe('plan'); expect(planning.approval_bypass_explicit).toBe(0);
        const grant = [{ permission: 'external_directory', pattern: `${approvedDir}/*`, action: 'allow' }];
        if (granted) {
          const planningBefore = await request(`/session/${planning.sdk_session_id}`, undefined, true, planning.cwd);
          expect(planningBefore.status).toBe(200); expect(Array.isArray(planningBefore.body.permission)).toBe(true);
          expect((await request(`/session/${planning.sdk_session_id}`, { permission: [...planningBefore.body.permission, ...grant] }, true, planning.cwd, 'PATCH')).status).toBe(200);
          receipt.grants.push({ origin: 'synthetic fixture-human setup', sdkSessionId: planning.sdk_session_id, rules: grant, runtimeOnly: true, doesNotClaimAsyncCustomRuleInheritance: true });
        }
        releasePlanning();
        const completed = await until(async () => {
          if (providerError) throw providerError;
          const rows = query('SELECT id,parent_session_id,child_session_id,status,completion_text FROM agent_async_delegations WHERE id=?', [planning.delegation_id]);
          return rows[0]?.completion_text?.includes(`PLANNING_ACTUAL_RESULT_${nonce}`) ? rows[0] : null;
        }, 100, 'No actual native Task result at immediate Planning parent / durable async completion');
        receipt.asyncCompletion = { ...completed, completion_text: completed.completion_text?.slice(0, 1500) };
        const chain = query('SELECT id,parent_session_id,sdk_session_id,agent_kind,permission_mode,approval_bypass_explicit,delegation_depth AS depth FROM agent_sessions WHERE id=? OR parent_session_id IS NOT NULL ORDER BY delegation_depth', [session.id]);
        receipt.chain = chain; expect(chain).toHaveLength(4); expect(chain.map(row => row.depth)).toEqual([0, 1, 2, 3]);
        expect(chain.every(row => row.permission_mode === 'plan' && row.approval_bypass_explicit === 0)).toBe(true);
        for (let index = 1; index < chain.length; index++) expect(chain[index].parent_session_id).toBe(chain[index - 1].id);
        checks.canonicalPlanModeAtAllDepths = true;
        expect((await request(`/agent-sessions/${session.id}/prompt`, { prompt: 'NESTED_VISIBILITY Call the real session-list tool with no arguments and report only current hierarchy metadata.' })).status).toBe(202);
        await until(async () => receipt.actualMcpVisibilityText ? true : null, 45, 'No actual signed MCP hierarchy response');
        // Parse the actual MCP text projection, rather than treating a model's
        // mention of IDs or the recent page as proof of the current subtree.
        const open = '<<<UNTRUSTED_EXTERNAL_CONTENT>>>';
        const close = '<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>';
        const visibilityText = receipt.actualMcpVisibilityText as string;
        expect(visibilityText.split(open)).toHaveLength(2); expect(visibilityText.split(close)).toHaveLength(2);
        const visibility = JSON.parse(visibilityText.slice(visibilityText.indexOf(open) + open.length, visibilityText.indexOf(close)).trim());
        expect(visibility.currentWork.state).toBe('available');
        expect(visibility.currentWork.truncated).toBe(false);
        expect(visibility.currentWork.maxDepth).toBe(6);
        expect(visibility.currentWork.maxSessions).toBe(100);
        for (const row of chain) {
          const projected = visibility.currentWork.sessions.find((item: any) => item.id === row.id);
          expect(projected).toMatchObject({ id: row.id, parentSessionId: row.parent_session_id, sdkSessionId: row.sdk_session_id });
          expect(typeof projected.status).toBe('string');
        }
        checks.actualMcpHierarchyVisible = true;
        expect(await readFile(editFile, 'utf8')).toBe('UNCHANGED');
        expect((await command('/usr/bin/test', ['-e', bashFile])).code).toBe(1);
        expect(await readFile(note, 'utf8')).toBe(marker); expect(await readFile(outside, 'utf8')).toBe(forbiddenMarker);
        checks.fixtureActionsDidNotWrite = true;
        expect(replies.filter(reply => reply.reply === 'once' || reply.reply === 'always')).toHaveLength(0);
        if (!granted) expect(asked.some(event => event.sessionID === chain[3].sdk_session_id && event.permission === 'external_directory')).toBe(true);
        expect(replies.some(reply => reply.sessionID === chain[3].sdk_session_id && reply.reply === 'reject')).toBe(true);
        checks.noPermissionAutoApproval = true;
        checks.readonlyFixtureInputsUnchanged = (await Promise.all(Object.entries(immutableHashes).map(async ([file, before]) => hash(await readFile(file)) === before))).every(Boolean);
        expect(checks.readonlyFixtureInputsUnchanged).toBe(true);
      } catch (error) { receipt.error = String(error); throw error; }
      finally {
        releasePlanning(); abortEvents.abort(); await eventTask;
        if (sandboxAttempted) {
          const down = await command(path.join(root, 'tools/dev/sandbox.sh'), ['down'], env, 90_000);
          receipt.stockTeardownExit = down.code; await writeFile(path.join(out, 'sandbox-down.log'), down.output);
        }
        if (providerStarted) await new Promise<void>(resolve => server.close(() => resolve()));
        receipt.nativePermissionAsked = asked; receipt.nativePermissionReplies = replies;
        await writeFile(path.join(out, 'synthetic-provider-observations.json'), JSON.stringify(providerObservations, null, 2));
        receipt.protectedListenersAfter = await listeners([4001, 4002, 4096, 49333]);
        checks.normalListenersPreserved = JSON.stringify(receipt.protectedListenersAfter) === JSON.stringify(protectedBefore);
        checks.ownedListenersAbsent = Object.values(await listeners([4197, 4198, 4199])).every(value => value.length === 0);
        checks.engineBinaryUnchanged = hash(await readFile(bin)) === binaryHash;
        checks.productSourceUnchanged = (await Promise.all(Object.entries(sourceInventory).map(async ([file, before]) => JSON.stringify(await sourceEntry(file)) === JSON.stringify(before)))).every(Boolean);
        checks.sourceCleanExactAfter = (await command('git', ['rev-parse', 'HEAD'])).output.trim() === sha && (await command('git', ['status', '--porcelain', '--untracked-files=no'])).output.trim() === '';
        receipt.qualification = !receipt.error && Object.values(checks).every(Boolean) && receipt.stockTeardownExit === 0 ? 'SCRIPTED_EXACT_SOURCE_PLUMBING' : 'UNVERIFIED';
        await save();
      }
      expect(receipt.qualification, `Receipt ${out}/receipt.json`).toBe('SCRIPTED_EXACT_SOURCE_PLUMBING');
    }, 600_000);
  }
});
