import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCreativePlatformTools } from '../creativePlatform.js';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe : describe.skip;
const base = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const sandbox = process.env.RHYTHM_SANDBOX_DIR ?? join(tmpdir(), 'rhythm-dev-sandbox');
const studio = join(sandbox, 'home', 'Downloads', 'Rhythm Studio');
const artifact = join(studio, 'live-mcp-comfyui.png');
let designId: string | undefined;

afterEach(async () => {
  if (designId) await fetch(`${base}/agent-designs/${designId}`, { method: 'DELETE' });
  rmSync(artifact, { force: true });
  designId = undefined;
});

describeLive('live E2E — MCP Creative Media artifacts', () => {
  it('records, lists, gets, and serves a ComfyUI local PNG without Canva', async () => {
    mkdirSync(studio, { recursive: true });
    writeFileSync(artifact, 'live-mcp-comfyui-png');
    const tools = new Map<string, { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }>();
    registerCreativePlatformTools({ tool: (name: string, _description: string, _shape: unknown, handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>) => tools.set(name, { handler }) } as never, base);
    const response = await tools.get('rhythm_record_design')!.handler({ title: 'MCP ComfyUI PNG', provider: 'comfyui', localPath: artifact });
    const design = JSON.parse(response.content[0].text) as { id: string; provider: string; artifactType: string };
    designId = design.id;
    expect(design).toMatchObject({ provider: 'comfyui', artifactType: 'png' });
    expect((await (await fetch(`${base}/agent-designs`)).json() as Array<{ id: string }>).some((item) => item.id === design.id)).toBe(true);
    expect((await (await fetch(`${base}/agent-designs/${design.id}`)).json() as { id: string }).id).toBe(design.id);
    expect(await (await fetch(`${base}/agent-designs/${design.id}/artifact`)).text()).toBe('live-mcp-comfyui-png');
  });
});
