import { describe, expect, it } from 'vitest';

import { loadConfiguredMcpServers } from './load_mcp_servers';

describe('loadConfiguredMcpServers', () => {
  it('returns an empty array when the config file does not exist', () => {
    const servers = loadConfiguredMcpServers({
      existsSync: () => false,
      readFileSync: () => '',
      configPath: '/fake/opencode.json',
    });
    expect(servers).toEqual([]);
  });

  it('parses local and remote entries from the mcp block', () => {
    const servers = loadConfiguredMcpServers({
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({
          mcp: {
            notion: { type: 'remote', url: 'https://mcp.notion.com/mcp' },
            'pdf-tools': { type: 'local', command: ['npx', '-y', 'server-pdf'] },
          },
        }),
      configPath: '/fake/opencode.json',
    });

    expect(servers).toHaveLength(2);
    const notion = servers.find((s) => s.id === 'notion');
    expect(notion).toMatchObject({ type: 'remote', url: 'https://mcp.notion.com/mcp' });
  });

  it('skips entries explicitly disabled with enabled: false', () => {
    const servers = loadConfiguredMcpServers({
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({
          mcp: {
            memory: { type: 'local', command: ['npx', '-y', 'server-memory'], enabled: false },
          },
        }),
      configPath: '/fake/opencode.json',
    });
    expect(servers).toEqual([]);
  });

  it('returns an empty array (never throws) when the file is invalid JSON', () => {
    const servers = loadConfiguredMcpServers({
      existsSync: () => true,
      readFileSync: () => '{not json',
      configPath: '/fake/opencode.json',
    });
    expect(servers).toEqual([]);
  });
});
