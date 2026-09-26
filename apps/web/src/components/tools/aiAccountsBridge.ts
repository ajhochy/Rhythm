import type { AiAccountProvider, AiAccountsShell, AiAccountsStatus } from '../../ai-accounts';

export const accountProviders: readonly AiAccountProvider[] = ['openai', 'anthropic', 'google', 'openrouter'];
export function aiAccountsBridge() {
  return (window as Window & { rhythmShell?: AiAccountsShell }).rhythmShell?.aiAccounts;
}

/** Only recognized metadata reaches UI state; never render bridge errors or arbitrary fields. */
export function accountStatus(value: unknown): AiAccountsStatus {
  const unavailable: AiAccountsStatus = { version: 1, availability: 'unavailable', childMayRetainCredential: false, memory: { state: 'unavailable' } };
  if (!value || typeof value !== 'object') return unavailable;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || input.availability !== 'available') return { ...unavailable, childMayRetainCredential: input.childMayRetainCredential === true };
  const memory = input.memory as Record<string, unknown> | null;
  if (!memory || typeof memory !== 'object' ||
      !['disabled', 'enabled', 'pending-next-start', 'unavailable'].includes(String(memory.state))) return unavailable;
  const providers = {} as NonNullable<AiAccountsStatus['providers']>;
  if (!input.providers || typeof input.providers !== 'object') return unavailable;
  for (const name of accountProviders) {
    const provider = (input.providers as Record<string, unknown>)[name];
    if (!provider || typeof provider !== 'object') return unavailable;
    const entry = provider as Record<string, unknown>;
    if (typeof entry.grantEnabled !== 'boolean' ||
        ['applicationState', 'rhythmSourceState', 'hermesSourceState', 'sharingEligibility'].some(field => typeof entry[field] !== 'string') ||
        !['absent', 'configured', 'applied', 'pending-next-start'].includes(String(entry.applicationState)) ||
        !['static-api-key', 'oauth', 'absent', 'unknown'].includes(String(entry.rhythmSourceState)) ||
        !['present', 'absent', 'unknown'].includes(String(entry.hermesSourceState)) ||
        !['eligible', 'hermes-owned', 'oauth-not-shareable', 'source-missing', 'source-unavailable'].includes(String(entry.sharingEligibility))) return unavailable;
    providers[name] = {
      sourceState: 'unknown', grantEnabled: entry.grantEnabled,
      applicationState: entry.applicationState as NonNullable<AiAccountsStatus['providers']>[AiAccountProvider]['applicationState'],
      rhythmSourceState: entry.rhythmSourceState as NonNullable<AiAccountsStatus['providers']>[AiAccountProvider]['rhythmSourceState'],
      hermesSourceState: entry.hermesSourceState as NonNullable<AiAccountsStatus['providers']>[AiAccountProvider]['hermesSourceState'],
      sharingEligibility: entry.sharingEligibility as NonNullable<AiAccountsStatus['providers']>[AiAccountProvider]['sharingEligibility'],
    };
  }
  return { version: 1, availability: 'available', childMayRetainCredential: input.childMayRetainCredential === true,
    providers, memory: { state: memory.state as AiAccountsStatus['memory']['state'] } };
}
