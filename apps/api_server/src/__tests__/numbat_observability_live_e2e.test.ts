/**
 * Live E2E test for #1452 — observe-only Numbat OpenCode monitoring.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Run it exactly as documented in the issue/testing-guide, against the
 * dev sandbox (never a hand-rolled api_server — see AGENTS.md):
 *
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/numbat_observability_live_e2e.test.ts --no-file-parallelism
 *   tools/dev/sandbox.sh down
 *
 * numbat is an OPTIONAL machine-installed binary (see
 * docs/ai/decisions/2026-08-18-numbat-observability-integration.md — Rhythm
 * never bundles/auto-downloads it). This suite checks binary presence via the
 * SAME resolution logic api_server uses before asserting anything, and skips
 * gracefully (not a failure) when the binary is absent on this machine — the
 * feature is "not yet installed", never "broken".
 *
 * What it proves when numbat IS present:
 *  - AC1: sandbox startup writes an EXTRA_ARGS-bearing plugin file with no
 *    --enforce / --output http / --content full.
 *  - AC2: a real prompt + tool call through the sandbox produces new bounded
 *    (<=200 code point) content_preview NDJSON records, no `record_type:
 *    "enforcement"`.
 *  - AC4: the hostile/tool-call turn completes normally (never blocked,
 *    delayed, or altered by the numbat hook) — only rhythm_request_approval
 *    gates actions.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { resolveNumbatBinary } from '../services/numbat_observability_service';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SANDBOX_DIR =
  process.env.RHYTHM_SANDBOX_DIR ?? join(process.env.TMPDIR ?? tmpdir(), 'rhythm-dev-sandbox');
const SANDBOX_HOME = join(SANDBOX_DIR, 'home');

const describeLive = LIVE ? describe : describe.skip;

let createdAgentIds: string[] = [];
let createdSessionIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

interface SessionRow {
  id: string;
  status: string;
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 500,
  label = 'poll',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms - last: ${String(lastErr)}`);
}

/** True when the machine running this test can actually resolve `numbat`. */
function numbatAvailableHere(): boolean {
  return resolveNumbatBinary() !== null;
}

function readNdjsonLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
}

afterEach(async () => {
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  createdSessionIds = [];
  createdAgentIds = [];
});

describeLive('live E2E - #1452 numbat observe-only OpenCode monitoring', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} - start it via tools/dev/sandbox.sh first`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${eng.status}) - wait for spawn and re-run`);
    }
  });

  it('AC1: the generated global plugin exists with observe-only EXTRA_ARGS', () => {
    if (!numbatAvailableHere()) {
      // ponytail: feature is inert (not broken) without the binary — see
      // decision record. Nothing to assert on this machine.
      console.log('[numbat live e2e] numbat binary not resolvable on this machine — skipping AC1 (documented gap, not a failure).');
      return;
    }

    const pluginPath = join(SANDBOX_HOME, '.config', 'opencode', 'plugins', 'numbat.ts');
    expect(existsSync(pluginPath), `expected ${pluginPath} to exist after sandbox startup`).toBe(true);
    const content = readFileSync(pluginPath, 'utf8');
    expect(content).toContain('EXTRA_ARGS');
    expect(content).toContain('opencode');
    expect(content).not.toContain('--enforce');
    expect(content).not.toMatch(/--output[^\n]*http/);
    expect(content).not.toContain('--content full');
  });

  it(
    'AC2/AC4: a real session tool call produces bounded-preview NDJSON records and completes unblocked',
    async () => {
      if (!numbatAvailableHere()) {
        console.log('[numbat live e2e] numbat binary not resolvable on this machine — skipping AC2/AC4 (documented gap, not a failure).');
        return;
      }

      const ndjsonPath = join(SANDBOX_HOME, '.numbat', 'records.ndjson');
      const baselineLines = readNdjsonLines(ndjsonPath).length;

      const agent = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'E2E 1452 numbat observability',
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          // ponytail: 'openrouter' matches the established live-e2e convention
          // (see _live_e2e_guard.ts callers, e.g. live_e2e_929.test.ts's
          // `MODEL = { provider: 'openrouter', id: '' }`) — 'anthropic' routes
          // through rhythm-anthropic-accounts' Claude Code Keychain OAuth
          // bridge, whose credential health is unrelated to numbat and can
          // fail independently (real failure observed: "Claude Code
          // credentials are unavailable or expired"), which would make this
          // test flaky for reasons having nothing to do with #1452.
          modelProvider: 'openrouter',
          systemPrompt: 'You are a terse test agent. Use tools when asked and answer in one short sentence.',
        }),
      });
      createdAgentIds.push(agent.id);

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({ agentId: agent.id, name: 'E2E 1452 numbat probe', cwd: homedir() }),
      });
      createdSessionIds.push(session.id);

      const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: session.id,
            data: 'Use your shell tool to run `pwd`, then reply with the single word: done.',
          }),
        );

        const settled = await poll(
          async () => {
            const s = await apiJson<{ session: SessionRow }>(`/agent-sessions/${session.id}`);
            if (s.session.status === 'working' || s.session.status === 'starting') {
              throw new Error(`still ${s.session.status}`);
            }
            return s.session;
          },
          120_000,
          800,
          'await turn settle',
        );

        // AC4: never blocked/altered by the observe-only hook — only a real
        // engine/provider error would land here, never an enforcement verdict.
        expect(settled.status).not.toBe('error');

        // AC2: new bounded, non-enforcement NDJSON records appeared.
        const newLines = await poll(
          async () => {
            const lines = readNdjsonLines(ndjsonPath);
            if (lines.length <= baselineLines) throw new Error('no new numbat records yet');
            return lines.slice(baselineLines);
          },
          15_000,
          500,
          'await new numbat NDJSON records',
        );
        expect(newLines.length).toBeGreaterThan(0);
        for (const line of newLines) {
          const record = JSON.parse(line) as {
            record_type?: string;
            content_preview?: string;
          };
          expect(record.record_type).not.toBe('enforcement');
          if (typeof record.content_preview === 'string') {
            expect([...record.content_preview].length).toBeLessThanOrEqual(200);
          }
        }
      } finally {
        ws.close();
      }
    },
    130_000,
  );
});
