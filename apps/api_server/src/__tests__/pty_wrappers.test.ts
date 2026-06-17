import { describe, expect, it, vi } from 'vitest';
import { OpencodeClientService } from '../services/opencode_client_service';

function svcWithClient(client: any): OpencodeClientService {
  const s = new OpencodeClientService();
  (s as unknown as { client: unknown }).client = client;
  return s;
}

describe('PTY wrappers', () => {
  it('createPty posts cwd and returns the Pty', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'pty_1', pid: 9, status: 'running' } });
    const s = svcWithClient({ pty: { create } });
    const r = await s.createPty({ cwd: '/work' });
    expect(r).toEqual({ id: 'pty_1', pid: 9, status: 'running' });
    expect(create).toHaveBeenCalledWith({ body: { cwd: '/work' } });
  });

  it('createPty includes command when provided', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'p', pid: 1, status: 'running' } });
    const s = svcWithClient({ pty: { create } });
    await s.createPty({ cwd: '/w', command: 'bash' });
    expect(create).toHaveBeenCalledWith({ body: { cwd: '/w', command: 'bash' } });
  });

  it('createPty throws AppError on error envelope', async () => {
    const s = svcWithClient({ pty: { create: vi.fn().mockResolvedValue({ error: { msg: 'boom' } }) } });
    await expect(s.createPty({ cwd: '/x' })).rejects.toThrow(/createPty/);
  });

  it('resizePty patches size {rows,cols}', async () => {
    const update = vi.fn().mockResolvedValue({ data: {} });
    const s = svcWithClient({ pty: { update } });
    await s.resizePty('pty_1', 80, 24);
    expect(update).toHaveBeenCalledWith({ path: { id: 'pty_1' }, body: { size: { rows: 24, cols: 80 } } });
  });

  it('removePty deletes; swallows errors', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('gone'));
    const s = svcWithClient({ pty: { remove } });
    await expect(s.removePty('pty_1')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({ path: { id: 'pty_1' } });
  });
});
