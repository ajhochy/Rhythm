import { expect, it } from 'vitest';
import { createHash } from 'crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { assertQualificationModelLoan } from './qualification_fixture_authority';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

it('API authority revalidates the private credential projection and deadline even when routing changes', () => {
  const root = mkdtempSync('/private/tmp/qualification-loan-authority-');
  const accountPath = join(root, 'openai-accounts.json'), decisionPath = join(root, 'decision-router.json'), gridPath = join(root, 'router-grid.json');
  const account = { id: 'qualification-model', label: '[smoke] selected model', access: 'synthetic-access', refresh: '',
    expires: Date.now() + 45 * 60_000, status: 'ok', chatgptAccountId: 'synthetic-workspace' };
  const accounts: { version: number; accounts: typeof account[]; defaultAccountId: string; routing: Record<string, string>; pinned: Record<string, true> } =
    { version: 1, accounts: [account], defaultAccountId: 'qualification-model', routing: {}, pinned: {} };
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  writeFileSync(decisionPath, '{"private":"synthetic-key"}', { mode: 0o600 });
  writeFileSync(gridPath, '{"mode":"synthetic"}', { mode: 0o600 });
  const now = Date.now(), stopAt = now + 10 * 60_000;
  const fixture = { fixtureRoot: root, syntheticActor: { tokenPath: join(root, 'actor-token'),
    expiresAt: new Date(now + 60_000).toISOString(), modelLoan: {
    accountPath, accountProjectionSha256: hash(canonical(account)), decisionPath, decisionSha256: hash(readFileSync(decisionPath)),
    gridPath, gridSha256: hash(readFileSync(gridPath)), selectorSha256: hash('selected-source-id'),
    issuedAt: now, expires: account.expires, stopAt,
  } } };
  expect(realpathSync(accountPath)).toBe(accountPath);
  expect(lstatSync(accountPath).mode & 0o777).toBe(0o600);
  expect(hash(canonical(account))).toBe(fixture.syntheticActor.modelLoan.accountProjectionSha256);
  expect(() => assertQualificationModelLoan(fixture, now)).not.toThrow();
  accounts.routing.session = 'qualification-model';
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  expect(() => assertQualificationModelLoan(fixture, now)).not.toThrow();
  account.access = 'changed';
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  expect(() => assertQualificationModelLoan(fixture, now)).toThrow(/unavailable/);
  account.access = 'synthetic-access';
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  expect(() => assertQualificationModelLoan(fixture, stopAt)).toThrow(/unavailable/);
  fixture.syntheticActor.modelLoan.issuedAt = now + 1000;
  expect(() => assertQualificationModelLoan(fixture, now)).toThrow(/unavailable/);
});
