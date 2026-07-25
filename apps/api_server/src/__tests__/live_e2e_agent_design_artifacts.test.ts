/** Live sandbox proof for Gallery artifact record/list/serve behavior. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe : describe.skip;
const base = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const sandbox = process.env.RHYTHM_SANDBOX_DIR ?? join(tmpdir(), 'rhythm-dev-sandbox');
const studio = join(sandbox, 'home', 'Downloads', 'Rhythm Studio');
const artifact = join(studio, 'live-gallery-artifact.png');
let designId: string | undefined;

afterEach(async () => {
  if (designId) await fetch(`${base}/agent-designs/${designId}`, { method: 'DELETE' });
  rmSync(artifact, { force: true });
  designId = undefined;
});

describeLive('live E2E — Gallery artifacts', () => {
  it('records, lists, and safely serves a sandbox-owned local image', async () => {
    mkdirSync(studio, { recursive: true });
    writeFileSync(artifact, 'live-gallery-png');
    const created = await fetch(`${base}/agent-designs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Live Gallery Artifact', provider: 'built-in', localPath: artifact }),
    });
    expect(created.status).toBe(201);
    const design = (await created.json()) as { id: string; artifactType: string };
    designId = design.id;
    expect(design.artifactType).toBe('png');

    const listed = await fetch(`${base}/agent-designs`);
    expect((await listed.json() as Array<{ id: string }>).some((item) => item.id === design.id)).toBe(true);
    const served = await fetch(`${base}/agent-designs/${design.id}/artifact`);
    expect(served.status).toBe(200);
    expect(await served.text()).toBe('live-gallery-png');
  });
});
