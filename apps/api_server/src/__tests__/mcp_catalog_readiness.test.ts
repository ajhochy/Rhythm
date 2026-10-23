import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMcp = vi.fn();
const listMcpToolIds = vi.fn();
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: (...args: unknown[]) => listMcp(...args),
    listMcpToolIds: (...args: unknown[]) => listMcpToolIds(...args),
  },
}));

import { assertMcpToolGrantsKnown, loadLiveMcpToolCatalog } from '../services/mcp_tool_catalog_validation';

const grants = JSON.stringify({ rhythm: ['rhythm_list_agents'] });

describe('MCP catalog readiness for granted scheduled tools', () => {
  beforeEach(() => { listMcp.mockReset(); listMcpToolIds.mockReset(); });

  it('reads status before catalog IDs so an in-flight MCP reload cannot form a mixed snapshot', async () => {
    let settle!: (value: unknown) => void;
    listMcp.mockReturnValue(new Promise(resolve => { settle = resolve; }));
    listMcpToolIds.mockResolvedValue(['rhythm_rhythm_list_agents']);
    const pending = loadLiveMcpToolCatalog();
    expect(listMcp).toHaveBeenCalledTimes(1);
    expect(listMcpToolIds).not.toHaveBeenCalled();
    settle({ rhythm: { status: 'connected' } });
    await pending;
    expect(listMcpToolIds).toHaveBeenCalledTimes(1);
  });

  it('rechecks a connected granted server with a transient empty catalog, then accepts exact live IDs', async () => {
    listMcp.mockResolvedValue({ rhythm: { status: 'connected' } });
    listMcpToolIds.mockResolvedValueOnce([]).mockResolvedValueOnce(['rhythm_rhythm_list_agents']);
    await expect(assertMcpToolGrantsKnown(grants, 'org-reviewer')).resolves.toBeUndefined();
    expect(listMcpToolIds).toHaveBeenCalledTimes(2);
  });

  it('rejects a genuine unknown grant and never fetches for a zero-MCP scope', async () => {
    listMcp.mockResolvedValue({ rhythm: { status: 'connected' } });
    listMcpToolIds.mockResolvedValue(['rhythm_rhythm_list_agents']);
    await expect(assertMcpToolGrantsKnown(JSON.stringify({ rhythm: ['rhythm_invented'] }), 'org-reviewer'))
      .rejects.toThrow('unknown MCP tool grant(s): rhythm.rhythm_invented');
    expect(listMcpToolIds).toHaveBeenCalledTimes(1);
    listMcp.mockClear(); listMcpToolIds.mockClear();
    await expect(assertMcpToolGrantsKnown('{}', 'org-reviewer')).resolves.toBeUndefined();
    expect(listMcp).not.toHaveBeenCalled();
    expect(listMcpToolIds).not.toHaveBeenCalled();
  });

  it('rejects a connected granted server whose catalog stays empty beyond the bounded retry window', async () => {
    vi.useFakeTimers();
    try {
      listMcp.mockResolvedValue({ rhythm: { status: 'connected' } });
      listMcpToolIds.mockResolvedValue([]);
      const outcome = expect(assertMcpToolGrantsKnown(grants, 'org-reviewer'))
        .rejects.toThrow('unknown MCP tool grant(s): rhythm.rhythm_list_agents');
      await vi.advanceTimersByTimeAsync(2_500);
      await outcome;
      expect(listMcpToolIds.mock.calls.length).toBeGreaterThan(1);
    } finally { vi.useRealTimers(); }
  });

  it('retains an observed unknown grant when the catalog reload fails', async () => {
    vi.useFakeTimers();
    try {
      listMcp.mockResolvedValue({ rhythm: { status: 'connected' } });
      listMcpToolIds.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('engine disconnected'));
      const outcome = expect(assertMcpToolGrantsKnown(grants, 'org-reviewer'))
        .rejects.toThrow('unknown MCP tool grant(s): rhythm.rhythm_list_agents');
      await vi.advanceTimersByTimeAsync(150);
      await outcome;
      expect(listMcpToolIds).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
