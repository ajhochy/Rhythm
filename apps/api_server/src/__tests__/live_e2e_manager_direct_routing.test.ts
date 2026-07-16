/**
 * Live behavioral gate for manager-profile routing projection.
 *
 * Drives the real resync HTTP endpoint against the isolated api_server + fork
 * engine, then inspects the generated agent files inside the sandbox HOME.
 * Skipped from the normal suite unless RHYTHM_LIVE_E2E=1.
 */
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const describeLive = LIVE ? describe : describe.skip;

interface AgentConfigResponse {
  id: string;
  allowedDelegatesJson: string | null;
}

async function resync(id: string): Promise<{ config: AgentConfigResponse; projected: string }> {
  const response = await fetch(`${BASE}/agent-configs/${id}/resync-agent-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${id} resync failed: ${response.status} ${text}`);
  const config = JSON.parse(text) as AgentConfigResponse;
  const projected = await readFile(
    join(homedir(), '.config', 'opencode', 'agents', `${id}.md`),
    'utf8',
  );
  return { config, projected };
}

function projectedTaskRules(markdown: string): string[] {
  const frontmatter = markdown.split('\n---\n', 1)[0];
  const lines = frontmatter.split('\n');
  const taskIndex = lines.findIndex((line) => line === '  task:');
  if (taskIndex === -1) return [];
  const remaining = lines.slice(taskIndex + 1);
  const blockEnd = remaining.findIndex((line) => !line.startsWith('    '));
  const taskLines = blockEnd === -1 ? remaining : remaining.slice(0, blockEnd);
  return taskLines.map((line) => line.trim());
}

describeLive('live E2E — manager profiles prefer direct in-scope work', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await fetch(`${BASE}/health`);
    expect(health.ok).toBe(true);
    const engine = await fetch(`${BASE}/opencode/health`);
    expect(engine.ok).toBe(true);
    expect((await engine.json()) as { status: string }).toMatchObject({ status: 'ready' });
  });

  it('resyncs Secretary, Theologian, and Coding Workflow with direct-first routing', async () => {
    for (const id of ['secretary', 'theologian', 'workflow-orchestrator']) {
      const { config, projected } = await resync(id);
      const roster = config.allowedDelegatesJson
        ? (JSON.parse(config.allowedDelegatesJson) as string[])
        : [];

      expect(projected).toContain(
        'Handle the request directly when it fits your own role, system prompt, granted ' +
          'skills, tools, and permissions.',
      );
      expect(projected).not.toContain('Do not attempt domain or coding work yourself');
      expect(projected).not.toContain('Only handle trivial admin yourself');
      expect(projectedTaskRules(projected)).toEqual([
        '"*": deny',
        ...roster.map((delegate) => `${JSON.stringify(delegate)}: allow`),
      ]);
    }
  });
});
