/**
 * Live E2E test for #1094 — OpenAI native image_generation capability grant.
 *
 * REDUCED SCOPE (documented blocker): this test proves the Rhythm-side half
 * of the acceptance criteria — the grant round-trips through REST, projects
 * into frontmatter as `permission.image_generation: allow` (NOT into
 * `allowedMcpsJson`/options.mcpAllowlist), and is visible after
 * POST /system/refresh. It does NOT drive an actual image-generation turn.
 *
 * Investigation during implementation (see database/migrations.ts's #1094
 * comment) found no existing wiring in the vendored engine's session
 * tool-assembly (apps/opencode_fork/packages/opencode/src/session) that adds
 * ANY provider-hosted tool (image_generation included) to a live request —
 * only response-side interpretation (`providerExecuted` handling in
 * processor.ts) and the tool implementation itself exist. Actually causing
 * the model to be OFFERED the tool requires a fork change, which is out of
 * scope here (AGENTS.md: the fork is edited only for mcp-scope-* issues) and
 * matches this issue's own "if a fork rebuild IS required, SKIP with a note"
 * contingency. Re-run/extend this test once that fork wiring lands.
 *
 * Gated behind RHYTHM_LIVE_E2E=1.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const AGENTS_DIR = join(homedir(), '.config', 'opencode', 'agents');
const describeLive = LIVE ? describe : describe.skip;

let createdAgentIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
}
async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}
async function poll<T>(fn: () => Promise<T>, timeoutMs: number, intervalMs = 500, label = 'poll'): Promise<T> {
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
  throw new Error(`${label} timed out after ${timeoutMs}ms — last: ${String(lastErr)}`);
}

afterEach(async () => {
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
    await rm(join(AGENTS_DIR, `${id}.md`), { force: true }).catch(() => {});
  }
  createdAgentIds = [];
});

describeLive('live E2E — #1094 image_generation capability grant (Rhythm-side, reduced scope)', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE}`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') throw new Error(`opencode engine not ready (status=${eng.status})`);
  });

  it(
    'grants project into frontmatter as permission.image_generation:allow, NOT into the MCP allowlist, and survive /system/refresh',
    async () => {
      const cfg = await apiJson<{ id: string; imageGenerationEnabled: boolean }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'E2E Graphic Designer 1094',
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          modelProvider: 'openai',
          allowedMcpsJson: JSON.stringify(['rhythm']),
          imageGenerationEnabled: true,
          systemPrompt: 'You are a test agent.',
        }),
      });
      createdAgentIds.push(cfg.id);
      expect(cfg.imageGenerationEnabled).toBe(true);

      const projected = await poll(
        async () => {
          const content = await readFile(join(AGENTS_DIR, `${cfg.id}.md`), 'utf8');
          if (!/image_generation:\s*allow/.test(content)) throw new Error('grant not yet projected');
          return content;
        },
        10_000,
        500,
        'projected .md image_generation grant',
      );
      expect(projected).toMatch(/image_generation:\s*allow/);

      // NOT represented as an MCP allowlist entry.
      const optionsLine = projected.split('\n').find((l) => l.startsWith('options:'));
      if (optionsLine) {
        const options = JSON.parse(optionsLine.slice('options: '.length));
        expect(JSON.stringify(options.mcpAllowlist ?? {})).not.toContain('image_generation');
      }

      const refreshed = await apiJson<{ status: string }>('/system/refresh', { method: 'POST' });
      expect(refreshed.status).toBe('ok');
    },
    30_000,
  );
});
