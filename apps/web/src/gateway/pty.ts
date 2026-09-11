export function createLivePtyGateway(apiBase: string, fetcher: typeof fetch = fetch) {
  const request = async (path: string, method: string, body?: unknown) => {
    const response = await fetcher(`${apiBase}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
      throw new Error(`Terminal ${method} failed (HTTP ${response.status})`);
    }
    return response;
  };
  return {
    async create(sessionId: string): Promise<string> {
      const response = await request(`/agent-sessions/${encodeURIComponent(sessionId)}/pty`, 'POST', {});
      const result = await response.json();
      if (typeof result.ptyId !== 'string' || !result.ptyId.trim()) throw new Error('Terminal returned no PTY id');
      return result.ptyId;
    },
    connect(id: string) { return new WebSocket(`${apiBase.replace(/^http:/, 'ws:')}/ws/pty/${encodeURIComponent(id)}`); },
    async resize(id: string, cols: number, rows: number) {
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 200) throw new Error('Invalid terminal size');
      await request(`/pty/${encodeURIComponent(id)}`, 'PATCH', { cols, rows });
    },
    async remove(id: string) { await request(`/pty/${encodeURIComponent(id)}`, 'DELETE'); },
  };
}
export type PtyGateway = ReturnType<typeof createLivePtyGateway>;
