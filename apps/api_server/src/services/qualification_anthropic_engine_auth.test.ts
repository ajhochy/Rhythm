import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { seedQualificationAnthropicBeforeReady } from './qualification_anthropic_engine_auth';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

it('seeds exactly one validated private Anthropic account through the SDK before readiness', async () => {
  const root = mkdtempSync('/private/tmp/rhythm-anthropic-engine-auth-');
  const accountPath = join(root, 'anthropic-accounts.json');
  const account = { id: 'qualification-model', label: '[smoke] selected model', access: 'synthetic-access',
    refresh: '', expires: Date.now() + 45 * 60_000, status: 'ok' };
  writeFileSync(accountPath, JSON.stringify({ version: 1, accounts: [account],
    defaultAccountId: account.id, routing: {}, pinned: {} }), { mode: 0o600 });
  const now = Date.now();
  const authority = { fixtureRoot: root, syntheticActor: { tokenPath: join(root, 'actor-token'),
    expiresAt: new Date(now + 60_000).toISOString(), modelLoan: {
      provider: 'anthropic' as const, accountPath, accountProjectionSha256: digest(canonical(account)),
      selectorSha256: digest('selected'), issuedAt: now, expires: account.expires,
      stopAt: now + 10 * 60_000,
    } } };
  const push = vi.fn().mockResolvedValue(true);
  const engine = { setOAuthCredentials: push };
  try {
    expect(await seedQualificationAnthropicBeforeReady({ authority, accountPath, engine })).toBe('seeded');
    expect(push).toHaveBeenCalledExactlyOnceWith('anthropic', {
      access: 'synthetic-access', refresh: '', expires: account.expires,
    });
    expect(readFileSync(accountPath, 'utf8')).not.toContain('source-refresh');
    push.mockClear();
    await expect(seedQualificationAnthropicBeforeReady({ authority, accountPath: join(root, 'other.json'), engine }))
      .rejects.toThrow(/outside its private loan/);
    expect(push).not.toHaveBeenCalled();
    account.access = 'tampered';
    writeFileSync(accountPath, JSON.stringify({ version: 1, accounts: [account],
      defaultAccountId: account.id, routing: {}, pinned: {} }), { mode: 0o600 });
    await expect(seedQualificationAnthropicBeforeReady({ authority, accountPath, engine }))
      .rejects.toThrow(/unavailable/);
    expect(push).not.toHaveBeenCalled();
    account.access = 'synthetic-access';
    writeFileSync(accountPath, JSON.stringify({ version: 1, accounts: [account],
      defaultAccountId: account.id, routing: {}, pinned: {} }), { mode: 0o600 });
    authority.syntheticActor.modelLoan.stopAt = now - 1;
    await expect(seedQualificationAnthropicBeforeReady({ authority, accountPath, engine }))
      .rejects.toThrow(/unavailable/);
    expect(push).not.toHaveBeenCalled();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('does not read any account or push credentials for an unloaned qualification fixture', async () => {
  const push = vi.fn();
  expect(await seedQualificationAnthropicBeforeReady({ authority: { fixtureRoot: '/private/tmp/absent' },
    accountPath: '/private/tmp/absent/anthropic-accounts.json', engine: { setOAuthCredentials: push } }))
    .toBe('absent');
  expect(push).not.toHaveBeenCalled();
});
