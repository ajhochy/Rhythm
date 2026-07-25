/**
 * Real sandbox contract: run with RHYTHM_LIVE_E2E=1 and point the variables at
 * the isolated sandbox only; never run this against the desktop/live ports.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const baseUrl = process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098';
const vaultPath = process.env.RHYTHM_LIVE_VAULT_PATH;
type ResearchResult = { status: string; report: string | null; error: string | null };

function vaultContainsJob(dir: string, jobId: string): boolean {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory() && vaultContainsJob(child, jobId)) return true;
    if (entry.isFile() && entry.name.endsWith('.md') && readFileSync(child, 'utf8').includes(`job_id: ${jobId}`)) return true;
  }
  return false;
}

it.runIf(enabled)('runs an actual research profile to a non-empty report and vault note', async () => {
  expect(vaultPath, 'RHYTHM_LIVE_VAULT_PATH must point at the sandbox vault').toBeTruthy();
  const created = await fetch(`${baseUrl}/agent-research`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Summarize two authoritative sources on local-first software, with citations.' }),
  });
  expect(created.status).toBe(201);
  const job = await created.json() as { id: string };
  let finalJob: ResearchResult | null = null;
  for (let i = 0; i < 120; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const polled = await (await fetch(`${baseUrl}/agent-research/${job.id}`)).json() as ResearchResult;
    finalJob = polled;
    if (polled?.status === 'done' || polled?.status === 'error') break;
  }
  expect(finalJob?.status, finalJob?.error ?? 'research job did not reach a terminal state').toBe('done');
  expect(finalJob?.report?.trim().length).toBeGreaterThan(0);
  expect(vaultContainsJob(vaultPath!, job.id)).toBe(true);
}, 660_000);
