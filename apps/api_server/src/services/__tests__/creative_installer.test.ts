import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { CREATIVE_INSTALL_RECIPES, installCreativeDependency } from '../creative_installer';

const approval = (id: keyof typeof CREATIVE_INSTALL_RECIPES, sessionId: string | null = 'session-1') => ({ id: 'approval', sessionId, agentConfigId: null, action: `install_creative_dependency:${id}`, preview: null, consequence: null, status: 'approved' as const, actor: null, decidedAt: null, createdAt: '' });
function fakeFs(existing = false) {
  const files = new Map<string, Uint8Array | string>();
  return { files, exists: vi.fn(async (p: string) => existing || files.has(p)), mkdir: vi.fn(async () => {}), writeFile: vi.fn(async (p: string, d: Uint8Array | string) => { files.set(p, d); }), readFile: vi.fn(async (p: string) => new Uint8Array(files.get(p) as Uint8Array)), rename: vi.fn(async () => {}), rm: vi.fn(async () => {}) };
}
describe('installCreativeDependency', () => {
  it('only exposes seven fixed reviewed recipes and excludes banned model packages', () => {
    expect(Object.keys(CREATIVE_INSTALL_RECIPES)).toHaveLength(7);
    expect(JSON.stringify(CREATIVE_INSTALL_RECIPES)).not.toMatch(/rembg|real-esrgan/i);
    for (const recipe of Object.values(CREATIVE_INSTALL_RECIPES)) { expect(recipe.url).toMatch(/^https:\/\//); expect(recipe.sha256).toMatch(/^[a-f0-9]{64}$/); expect(recipe.argv.length).toBeGreaterThan(0); }
  });
  it('requires a matching approved action and session before downloading', async () => {
    const downloader = vi.fn(); const fs = fakeFs();
    await expect(installCreativeDependency({ id: 'media-tools', sessionId: 'other' }, { approvals: { list: () => [approval('media-tools')] }, fs, downloader, root: '/fixed' })).resolves.toMatchObject({ status: 'denied' });
    expect(downloader).not.toHaveBeenCalled();
  });
  it('keeps model license acceptance separate from approval', async () => {
    const downloader = vi.fn(); const fs = fakeFs();
    await expect(installCreativeDependency({ id: 'comfyui-model-pack', sessionId: 'session-1' }, { approvals: { list: () => [approval('comfyui-model-pack')] }, fs, downloader, root: '/fixed' })).resolves.toMatchObject({ status: 'awaiting-user' });
    expect(downloader).not.toHaveBeenCalled();
  });
  it('checks a downloaded artifact before argv-only runner and atomically promotes its sentinel', async () => {
    const recipe = CREATIVE_INSTALL_RECIPES['media-tools']; const bytes = new TextEncoder().encode('artifact');
    const original = recipe.sha256;
    Object.assign(recipe, { sha256: createHash('sha256').update(bytes).digest('hex') });
    const fs = fakeFs(); const runner = vi.fn(async () => {});
    const result = await installCreativeDependency({ id: 'media-tools', sessionId: 'session-1' }, { approvals: { list: () => [approval('media-tools')] }, fs, downloader: async () => bytes, runner, root: '/fixed' });
    recipe.sha256 = original;
    expect(result.status).toBe('installed'); expect(runner).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ cwd: expect.stringContaining('.install-media-tools-') })); expect(fs.rename).toHaveBeenCalledTimes(1);
  });
  it('rolls back only its staging path on checksum failure and honors aborts', async () => {
    const fs = fakeFs();
    await expect(installCreativeDependency({ id: 'media-tools', sessionId: 'session-1' }, { approvals: { list: () => [approval('media-tools')] }, fs, downloader: async () => new Uint8Array(), root: '/fixed' })).resolves.toMatchObject({ status: 'failed' });
    expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining('.install-media-tools-'));
    const controller = new AbortController(); controller.abort();
    await expect(installCreativeDependency({ id: 'media-tools', sessionId: 'session-1', signal: controller.signal }, { approvals: { list: () => [approval('media-tools')] }, fs: fakeFs(), downloader: async () => new Uint8Array(), root: '/fixed' })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
