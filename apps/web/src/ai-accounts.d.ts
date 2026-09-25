/** Metadata-only Electron Accounts bridge. Identity, paths and credentials stay in main. */
export type AiAccountProvider = 'openrouter' | 'anthropic' | 'openai' | 'google';
export type AiAccountGrantMutation = {
  action: 'enable' | 'disable';
  provider: AiAccountProvider;
  source: 'opencode-auth-json';
};
export type AiAccountMemoryConsentMutation = {
  action: 'enable' | 'disable';
  capability: 'memory.search';
};
export type AiAccountsStatus = {
  version: 1;
  availability: 'available' | 'unavailable';
  childMayRetainCredential: boolean;
  memory: { state: 'disabled' | 'enabled' | 'pending-next-start' | 'unavailable' };
  providers?: Record<AiAccountProvider, {
    sourceState: string;
    rhythmSourceState: 'static-api-key' | 'oauth' | 'absent' | 'unknown';
    hermesSourceState: 'present' | 'absent' | 'unknown';
    sharingEligibility: 'eligible' | 'hermes-owned' | 'oauth-not-shareable' | 'source-missing' | 'source-unavailable';
    grantEnabled: boolean;
    applicationState: 'absent' | 'configured' | 'applied' | 'pending-next-start';
  }>;
  sources?: Record<string, unknown>;
  claudeCode?: unknown;
};
export type AiAccountsShell = {
  aiAccounts?: {
    getStatus(): Promise<AiAccountsStatus>;
    setGrant(mutation: AiAccountGrantMutation): Promise<{ accepted: boolean }>;
    setMemorySearchConsent(mutation: AiAccountMemoryConsentMutation): Promise<{ accepted: boolean }>;
  };
};
