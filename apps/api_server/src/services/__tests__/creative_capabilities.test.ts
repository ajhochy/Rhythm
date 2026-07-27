import { describe, expect, it, vi } from 'vitest';
import { listCreativeCapabilities } from '../creative_capabilities';

const IDS = [
  'blender',
  'comfyui',
  'comfyui-model-pack',
  'openmontage',
  'obsidian',
  'document-tools',
  'media-tools',
];

describe('listCreativeCapabilities', () => {
  it('lists every capability with user-facing setup metadata', async () => {
    const capabilities = await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: '/test-home',
      tcpProbe: async () => false,
    });

    expect(capabilities.map((capability) => capability.id)).toEqual(IDS);
    for (const capability of capabilities) {
      expect(capability.description).not.toBe('');
      expect(capability.enables).not.toBe('');
      expect(capability.download).not.toBe('');
      expect(capability.disk).not.toBe('');
      expect(typeof capability.advanced).toBe('boolean');
      expect(capability.dependencies).toBeInstanceOf(Array);
      expect(capability.approval.required).toBe(true);
      expect(capability.approval.summary).not.toBe('');
      expect(capability.status).toBe('missing');
    }
  });

  it('reports fixed managed paths as installed and probes only fixed localhost services', async () => {
    const checkedPaths: string[] = [];
    const tcpProbe = vi.fn(async () => true);
    const capabilities = await listCreativeCapabilities({
      existsSync: (path) => {
        checkedPaths.push(path);
        return true;
      },
      homeDir: '/test-home',
      tcpProbe,
    });

    expect(capabilities.every((capability) => capability.status === 'installed')).toBe(true);
    expect(checkedPaths.length).toBeGreaterThan(IDS.length);
    expect(checkedPaths.every((path) => path.startsWith('/test-home/Library/Application Support/Rhythm/creative-tools/'))).toBe(true);
    expect(tcpProbe.mock.calls).toEqual([
      ['127.0.0.1', 9876],
      ['127.0.0.1', 8188],
      ['127.0.0.1', 27123],
    ]);
  });

  it('distinguishes an installed but unhealthy local service from missing software', async () => {
    const capabilities = await listCreativeCapabilities({
      existsSync: (path) => path.includes('/blender/'),
      homeDir: '/test-home',
      tcpProbe: async () => false,
    });

    expect(capabilities.find(({ id }) => id === 'blender')?.status).toBe('unhealthy');
    expect(capabilities.find(({ id }) => id === 'comfyui')?.status).toBe('missing');
  });

  it('keeps the model pack separate, optional, and advanced', async () => {
    const capabilities = await listCreativeCapabilities({
      existsSync: (path) =>
        path.endsWith('/comfyui/main.py') ||
        path.endsWith('/comfyui/.venv/bin/python') ||
        path.endsWith('/comfyui/mcp/node_modules/@peleke.s/comfyui-mcp/dist/index.js'),
      homeDir: '/test-home',
      tcpProbe: async () => true,
    });
    const comfyui = capabilities.find(({ id }) => id === 'comfyui');
    const modelPack = capabilities.find(({ id }) => id === 'comfyui-model-pack');

    expect(comfyui).toMatchObject({ status: 'installed', advanced: false, dependencies: [] });
    expect(modelPack).toMatchObject({
      status: 'missing',
      advanced: true,
      dependencies: ['comfyui'],
    });
  });

  it('never returns personal filesystem paths', async () => {
    const capabilities = await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: '/Users/private-person',
      tcpProbe: async () => false,
    });

    expect(JSON.stringify(capabilities)).not.toContain('/Users/private-person');
    expect(JSON.stringify(capabilities)).not.toContain('creative-tools');
  });

  it('does not report a stale installer sentinel as installed', async () => {
    const capabilities = await listCreativeCapabilities({
      existsSync: (path) => path.endsWith('/.rhythm-installed.json'),
      homeDir: '/test-home',
      tcpProbe: async () => true,
    });

    expect(capabilities.every(({ status }) => status === 'missing')).toBe(true);
  });
});
