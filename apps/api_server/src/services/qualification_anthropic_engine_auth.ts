import { createHash } from 'node:crypto';
import { AnthropicAccountsStore } from './anthropic_accounts_store';
import { assertQualificationModelLoan, type QualificationFixtureAuthority } from './qualification_fixture_authority';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Seed only the selected, validated private Anthropic account before the
 * engine publishes readiness. The normal account refresh/Keychain path stays
 * disabled for qualification, and the SDK writes only to fixture XDG data. */
export async function seedQualificationAnthropicBeforeReady(input: {
  authority: Pick<QualificationFixtureAuthority, 'fixtureRoot' | 'syntheticActor'>;
  accountPath: string;
  engine: { setOAuthCredentials(providerId: string, creds: {
    access: string; refresh: string; expires: number;
  }): Promise<boolean> };
}): Promise<'absent' | 'seeded'> {
  const loan = input.authority.syntheticActor?.modelLoan;
  if (!loan || loan.provider !== 'anthropic') return 'absent';
  if (input.accountPath !== loan.accountPath) throw new Error('Qualification Anthropic account source is outside its private loan');
  assertQualificationModelLoan(input.authority);
  const file = new AnthropicAccountsStore(input.accountPath).read();
  const account = file.accounts[0];
  if (file.accounts.length !== 1 || file.defaultAccountId !== 'qualification-model'
    || account?.id !== 'qualification-model' || account.status !== 'ok'
    || account.refresh !== '' || account.expires !== loan.expires
    || digest(canonical(account)) !== loan.accountProjectionSha256) {
    throw new Error('Qualification Anthropic account differs from the frozen private loan');
  }
  assertQualificationModelLoan(input.authority);
  const seeded = await input.engine.setOAuthCredentials('anthropic', {
    access: account.access, refresh: '', expires: account.expires,
  });
  if (!seeded) throw new Error('Qualification Anthropic credential was not accepted by the private engine');
  return 'seeded';
}
