#!/usr/bin/env node

/**
 * Live backend smoke for PR #942 / codex/mega-open-prs-2026-07-07.
 *
 * Targets a running local Rhythm desktop backend. It intentionally avoids
 * prompt/model execution, but it does create one disposable local agent session
 * so it can verify the real opencode fork session PATCH route and the Rhythm
 * API spillover persistence path. The session is hard-deleted in cleanup.
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const apiBase = (process.env.RHYTHM_API_URL ?? 'http://localhost:4001').replace(/\/$/, '');
const opencodeBase = (process.env.RHYTHM_OPENCODE_URL ?? 'http://127.0.0.1:4096').replace(/\/$/, '');
const testCwd = process.env.RHYTHM_SMOKE_CWD ?? process.cwd();
const expectedForkPathFragment =
  process.env.RHYTHM_EXPECT_FORK_PATH_FRAGMENT ?? 'Contents/Resources/opencode_bin/opencode';

const checks = [];
let localSessionId = null;
let sdkSessionId = null;

function record(name, status, detail) {
  checks.push({ name, status, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status.padEnd(7)} ${name}${suffix}`);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function safeBodyForError(body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-REDACTED')
    .replace(/"key"\s*:\s*"[^"]+"/g, '"key":"REDACTED"')
    .slice(0, 1200);
}

async function requestJson(url, options = {}, expectedStatuses = [200]) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!expectedStatuses.includes(response.status)) {
    fail(`HTTP ${response.status} from ${url}: ${safeBodyForError(body ?? text)}`);
  }
  return body;
}

function assertUnset(obj, key) {
  if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) {
    fail(`${key} should be cleared/absent, got ${JSON.stringify(obj[key])}`);
  }
}

function discoverOpencodePid() {
  const out = execFileSync('lsof', ['-nP', '-iTCP:4096', '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  const line = out
    .split('\n')
    .find((candidate) => /^\S+\s+\d+\s+/.test(candidate) && candidate.includes('TCP'));
  if (!line) fail('No process is listening on TCP :4096');
  const pid = line.trim().split(/\s+/)[1];
  if (!/^\d+$/.test(pid)) fail(`Could not parse opencode PID from lsof output: ${line}`);
  return pid;
}

function executablePathForPid(pid) {
  const out = execFileSync('lsof', ['-p', pid], { encoding: 'utf8' });
  const textLine = out
    .split('\n')
    .find((line) => line.includes('/opencode') && line.includes(' txt '));
  if (!textLine) fail(`Could not find opencode executable path for PID ${pid}`);
  const match = textLine.match(/\/.*\/opencode$/);
  if (!match) fail(`Could not parse opencode executable from lsof line: ${textLine}`);
  return match[0];
}

async function patchEngineSession(payload) {
  return requestJson(`${opencodeBase}/session/${sdkSessionId}`, {
    method: 'PATCH',
    headers: { 'x-opencode-directory': testCwd },
    body: JSON.stringify(payload),
  });
}

async function cleanup() {
  if (sdkSessionId) {
    try {
      await fetch(`${opencodeBase}/session/${sdkSessionId}`, {
        method: 'DELETE',
        headers: { 'x-opencode-directory': testCwd },
      });
    } catch (err) {
      record('cleanup opencode session', 'WARN', String(err));
    }
  }
  if (localSessionId) {
    try {
      const response = await fetch(`${apiBase}/agent-sessions/${localSessionId}/hard`, {
        method: 'DELETE',
      });
      if (response.status !== 204 && response.status !== 404) {
        record('cleanup local session', 'WARN', `HTTP ${response.status}`);
      }
    } catch (err) {
      record('cleanup local session', 'WARN', String(err));
    }
  }
}

async function main() {
  try {
    const health = await requestJson(`${apiBase}/health`);
    assert(health?.status === 'ok', `Unexpected /health body: ${JSON.stringify(health)}`);
    record('Rhythm API health', 'PASS', `${health.service ?? 'unknown'} ok`);

    const opencodeHealth = await requestJson(`${apiBase}/opencode/health`);
    assert(opencodeHealth?.status === 'ready', `Unexpected /opencode/health body: ${JSON.stringify(opencodeHealth)}`);
    record('opencode SDK health', 'PASS', opencodeHealth.message ?? 'ready');

    const auth = await requestJson(`${apiBase}/opencode/auth`);
    const providers = Array.isArray(auth?.providers) ? auth.providers : [];
    assert(auth?.ready === true, `Auth route reports not ready: ${JSON.stringify(auth)}`);
    assert(providers.includes('anthropic'), `Expected authenticated anthropic provider, got ${providers.join(',')}`);
    assert(providers.includes('openai'), `Expected authenticated openai provider, got ${providers.join(',')}`);
    record('authenticated fallback providers', 'PASS', providers.join(','));

    const opencodePid = discoverOpencodePid();
    const opencodePath = executablePathForPid(opencodePid);
    assert(
      opencodePath.includes(expectedForkPathFragment),
      `Expected opencode path to include "${expectedForkPathFragment}", got ${opencodePath}`,
    );
    record('running opencode fork binary', 'PASS', `${opencodePath} (pid ${opencodePid})`);

    const created = await requestJson(
      `${apiBase}/agent-sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          agentId: null,
          cwd: testCwd,
          name: `mega-pr-live-smoke-${Date.now()}`,
          projectId: null,
        }),
      },
      [201],
    );
    localSessionId = created?.id;
    sdkSessionId = created?.sdkSessionId;
    assert(localSessionId, `Created session missing id: ${JSON.stringify(created)}`);
    if (!sdkSessionId) {
      const afterCreate = await requestJson(`${apiBase}/agent-sessions/${localSessionId}`);
      sdkSessionId = afterCreate?.session?.sdkSessionId;
    }
    assert(sdkSessionId, `Created session missing sdkSessionId: ${JSON.stringify(created)}`);
    record('disposable agent session created', 'PASS', `${localSessionId} / ${sdkSessionId}`);

    let patched = await patchEngineSession({ skillAllowlist: { skills: ['smoke-test-skill'] } });
    assert(
      Array.isArray(patched?.skillAllowlist?.skills) &&
        patched.skillAllowlist.skills.includes('smoke-test-skill'),
      `skillAllowlist set did not round-trip: ${JSON.stringify(patched?.skillAllowlist)}`,
    );
    patched = await patchEngineSession({ skillAllowlist: null });
    assertUnset(patched, 'skillAllowlist');
    patched = await patchEngineSession({ skillAllowlist: { skills: [] } });
    assert(
      Array.isArray(patched?.skillAllowlist?.skills) && patched.skillAllowlist.skills.length === 0,
      `skillAllowlist [] deny-all did not round-trip: ${JSON.stringify(patched?.skillAllowlist)}`,
    );
    patched = await patchEngineSession({ skillAllowlist: null });
    assertUnset(patched, 'skillAllowlist');
    record('fork PATCH skillAllowlist null clear', 'PASS', 'non-null -> null -> [] -> null');

    patched = await patchEngineSession({ mcpAllowlist: { servers: ['rhythm'], tools: [] } });
    assert(
      Array.isArray(patched?.mcpAllowlist?.servers) &&
        patched.mcpAllowlist.servers.includes('rhythm'),
      `mcpAllowlist set did not round-trip: ${JSON.stringify(patched?.mcpAllowlist)}`,
    );
    patched = await patchEngineSession({ mcpAllowlist: null });
    assertUnset(patched, 'mcpAllowlist');
    record('fork PATCH mcpAllowlist null clear', 'PASS', 'non-null -> null');

    const spillover = await requestJson(`${apiBase}/opencode/spillover`, {
      method: 'POST',
      body: JSON.stringify({
        sdkSessionId,
        fromAccountId: 'smoke-team',
        exhausted: true,
        reason: 'rate_limited',
      }),
    });
    assert(spillover?.ok === true, `Spillover did not return ok: ${JSON.stringify(spillover)}`);
    assert(spillover?.handoff === true, `Expected cross-provider handoff: ${JSON.stringify(spillover)}`);
    assert(spillover?.providerID === 'openai', `Expected openai fallback, got ${spillover?.providerID}`);
    assert(spillover?.modelID === 'gpt-5.3-codex', `Expected gpt-5.3-codex fallback, got ${spillover?.modelID}`);
    record('cross-provider spillover handoff', 'PASS', `${spillover.providerID}/${spillover.modelID}`);

    const fetched = await requestJson(`${apiBase}/agent-sessions/${localSessionId}`);
    assert(
      fetched?.session?.providerId === 'openai' && fetched?.session?.modelId === 'gpt-5.3-codex',
      `Persisted session model mismatch: ${JSON.stringify({
        providerId: fetched?.session?.providerId,
        modelId: fetched?.session?.modelId,
      })}`,
    );
    record('spillover persisted on local session', 'PASS', `${fetched.session.providerId}/${fetched.session.modelId}`);

    const optimizer = await requestJson(`${apiBase}/agent-org-optimizer/run`, {
      method: 'POST',
      body: JSON.stringify({ maxProposalsPerRun: 0, maxLlmCallsPerRun: 0 }),
    });
    assert(typeof optimizer?.auditRunId === 'string', `Optimizer missing auditRunId: ${JSON.stringify(optimizer)}`);
    assert(typeof optimizer?.byKind === 'object' && optimizer.byKind !== null, 'Optimizer missing byKind summary');
    record(
      'org optimizer route with workflow-signal wiring',
      'PASS',
      optimizer.skipped ? `skipped: ${optimizer.skippedReason}` : `created=${optimizer.proposalsCreated}`,
    );

    const skills = await requestJson(`${apiBase}/opencode/skills?withMetadata=true`);
    assert(Array.isArray(skills), 'Expected /opencode/skills?withMetadata=true to return an array');
    for (const entry of skills.slice(0, 10)) {
      assert(entry?.metadata && typeof entry.metadata === 'object', `Skill entry missing metadata: ${JSON.stringify(entry)}`);
      assert(entry.metadata.env && Array.isArray(entry.metadata.env.missing), `Skill metadata missing env shape: ${JSON.stringify(entry.metadata)}`);
      assert(
        Object.prototype.hasOwnProperty.call(entry.metadata, 'status'),
        `Skill metadata missing status key: ${JSON.stringify(entry.metadata)}`,
      );
    }
    record('opencode skills metadata endpoint', 'PASS', `${skills.length} skills; metadata status/env shape present`);
  } finally {
    await cleanup();
  }

  const failures = checks.filter((check) => check.status !== 'PASS');
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  record('live backend smoke', 'FAIL', err instanceof Error ? err.message : String(err));
  await cleanup();
  process.exitCode = 1;
});
