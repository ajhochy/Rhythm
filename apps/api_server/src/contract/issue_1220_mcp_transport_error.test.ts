import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listMcp, getPersistedMcpConfigs } = vi.hoisted(() => ({
  listMcp: vi.fn(),
  getPersistedMcpConfigs: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp,
    getPersistedMcpConfigs,
    statusMessage: 'ready',
    listCommands: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map(),
}));

vi.mock('../config/env', () => ({
  env: {
    agentLocal: true,
    agentExecutionEnabled: true,
    role: 'local',
    corsAllowedOrigins: [],
    jwtSecret: 'test-secret',
  },
}));

import { opencodeMcpRouter } from '../routes/opencode_mcp_routes';

describe('issue #1220 MCP transport failure contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMcp.mockResolvedValue({
      obsidian: {
        status: 'failed',
        error: 'spawn /missing/mcp-obsidian ENOENT',
      },
    });
    getPersistedMcpConfigs.mockResolvedValue({
      obsidian: {
        type: 'local',
        command: ['/missing/mcp-obsidian'],
        environment: {
          OBSIDIAN_API_KEY: 'test-api-key',
          OBSIDIAN_HOST: '127.0.0.1',
          OBSIDIAN_PORT: '27123',
        },
      },
    });
  });

  it('issue-1220-c1: failed stdio transport preserves its error instead of requesting credentials', async () => {
    const getLayer = opencodeMcpRouter.stack.find((layer) => {
      const route = layer.route as unknown as {
        path?: string;
        methods?: { get?: boolean };
      };
      return route?.path === '/' && route?.methods?.get;
    });
    const handler = getLayer?.route?.stack[0]?.handle;
    expect(handler).toBeTypeOf('function');

    let responseBody: unknown;
    await handler?.(
      {} as never,
      {
        json(body: unknown) {
          responseBody = body;
        },
      } as never,
      (error?: unknown) => {
        if (error) throw error;
      },
    );

    const entries = responseBody as Array<{
      name: string;
      error?: string;
      needsCredentials: boolean;
    }>;
    const obsidian = entries.find((entry) => entry.name === 'obsidian');

    expect(obsidian).toMatchObject({
      error: 'spawn /missing/mcp-obsidian ENOENT',
      needsCredentials: false,
    });
  });
});
