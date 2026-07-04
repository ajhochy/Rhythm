import { describe, expect, it, vi } from 'vitest';

import { checkMcpReachability } from './mcp_reachability';

describe('checkMcpReachability', () => {
  it('passes for a remote server that responds ok', async () => {
    const results = await checkMcpReachability({
      servers: [{ id: 'notion', name: 'Notion', type: 'remote', url: 'https://mcp.notion.com/mcp' }],
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    });
    expect(results[0].pass).toBe(true);
  });

  it('fails with remediation for a remote server that returns an error status', async () => {
    const results = await checkMcpReachability({
      servers: [{ id: 'notion', name: 'Notion', type: 'remote', url: 'https://mcp.notion.com/mcp' }],
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    });
    expect(results[0].pass).toBe(false);
    expect(results[0].remediation).toMatch(/Notion/);
  });

  it('never throws when the network call rejects (e.g. DNS failure) — returns a graceful failure', async () => {
    const results = await checkMcpReachability({
      servers: [{ id: 'notion', name: 'Notion', type: 'remote', url: 'https://mcp.notion.com/mcp' }],
      fetchImpl: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
    });
    expect(results[0].pass).toBe(false);
    expect(results[0].remediation).toBeDefined();
  });

  it('never throws and reports a timeout as a graceful failure', async () => {
    const results = await checkMcpReachability({
      servers: [{ id: 'slow', name: 'Slow Server', type: 'remote', url: 'https://slow.example.com/mcp' }],
      fetchImpl: () => new Promise(() => {}), // never resolves
      timeoutMs: 5,
    });
    expect(results[0].pass).toBe(false);
    expect(results[0].remediation).toMatch(/timed out|unreachable/i);
  });

  it('reports local (stdio) servers as informational-pass without a network call', async () => {
    const fetchImpl = vi.fn();
    const results = await checkMcpReachability({
      servers: [{ id: 'pdf-tools', name: 'PDF Tools', type: 'local', command: ['npx', '-y', 'server-pdf'] }],
      fetchImpl,
    });
    expect(results[0].pass).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an empty array when no servers are configured', async () => {
    const results = await checkMcpReachability({ servers: [], fetchImpl: vi.fn() });
    expect(results).toEqual([]);
  });
});
