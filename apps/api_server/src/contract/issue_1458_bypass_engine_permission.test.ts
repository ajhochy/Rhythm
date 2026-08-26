import { describe, expect, it, vi } from 'vitest';

import { OpencodeClientService } from '../services/opencode_client_service';

function serviceWithCreate(create: ReturnType<typeof vi.fn>): OpencodeClientService {
  const service = new OpencodeClientService();
  (service as unknown as { client: unknown }).client = { session: { create } };
  (service as unknown as { status: string }).status = 'ready';
  return service;
}

describe('issue #1458 bypass permission engine contract', () => {
  it('issue-1458-c1: bypass config allows every permission before SSE handling', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'ses-bypass' } });
    const service = serviceWithCreate(create);

    await service.createSession(
      'bypass', '/tmp', undefined, undefined, undefined, undefined,
      'bypassPermissions',
    );

    expect(create.mock.calls[0][0].body.permission).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
    ]);
  });

  it('issue-1458-c2: bypass session creation does not configure engine asks', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'ses-bypass' } });
    const service = serviceWithCreate(create);

    await service.createSession(
      'bypass', '/tmp', undefined, undefined, undefined, undefined,
      'bypassPermissions',
    );

    expect(create.mock.calls[0][0].body.permission).not.toContainEqual(
      expect.objectContaining({ action: 'ask' }),
    );
  });

  it('issue-1458-c3: wildcard bypass explicitly covers external_directory', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'ses-bypass' } });
    const service = serviceWithCreate(create);

    await service.createSession(
      'bypass', '/tmp', undefined, undefined, undefined, undefined,
      'bypassPermissions',
    );

    const rules = create.mock.calls[0][0].body.permission as Array<{
      permission: string; pattern: string; action: string;
    }>;
    expect(rules).toContainEqual({ permission: '*', pattern: '*', action: 'allow' });
    expect(['bash', 'external_directory', 'edit'].every((permission) =>
      rules.some((rule) =>
        (rule.permission === '*' || rule.permission === permission) &&
        rule.pattern === '*' && rule.action === 'allow'),
    )).toBe(true);
  });

  it('issue-1458-c4: bypass behavior is established at create without the bridge', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'ses-bypass' } });
    const service = serviceWithCreate(create);

    const result = await service.createSession(
      'bypass', '/tmp', undefined, undefined, undefined, undefined,
      'bypassPermissions',
    );

    expect(result).toEqual({ id: 'ses-bypass' });
    expect(create.mock.calls[0][0].body.permission[0].action).toBe('allow');
  });
});
