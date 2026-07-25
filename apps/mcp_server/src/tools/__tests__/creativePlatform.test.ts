import { describe, expect, it, vi } from 'vitest';
import { registerCreativePlatformTools } from '../creativePlatform.js';

describe('registerCreativePlatformTools', () => {
  it('uses only the local creative-platform API surface', async () => {
    const tools = new Map<string, { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }>();
    const server = { tool: (name: string, _description: string, _shape: unknown, handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>) => tools.set(name, { handler }) };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'openmontage' }] }); vi.stubGlobal('fetch', fetchMock);
    registerCreativePlatformTools(server as never, 'http://localhost:4098');
    await tools.get('rhythm_install_creative_capability')!.handler({ id: 'openmontage', sessionId: 's1' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4098/creative-platform/openmontage/request-or-start', expect.objectContaining({ method: 'POST' }));
    expect([...tools]).toHaveLength(4);
    vi.unstubAllGlobals();
  });
});
