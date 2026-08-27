import { describe, expect, it, vi } from 'vitest';

import { OpencodeClientService } from '../services/opencode_client_service';

function serviceWithCreate(create: ReturnType<typeof vi.fn>): OpencodeClientService {
  const service = new OpencodeClientService();
  (service as unknown as { client: unknown }).client = { session: { create } };
  (service as unknown as { status: string }).status = 'ready';
  return service;
}

describe('issue #1458 bypass permission engine contract', () => {
  it('issue-1458-c1: bypass config keeps bash on SSE while other tools bypass asks', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'ses-bypass' } });
    const service = serviceWithCreate(create);

    await service.createSession(
      'bypass', '/tmp', undefined, undefined, undefined, undefined,
      'bypassPermissions',
    );

    expect(create.mock.calls[0][0].body.permission).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'bash', pattern: '*', action: 'ask' },
    ]);
  });
});
