/** Metadata-only Electron Accounts bridge. Identity, paths and credentials stay in main. */
export type AiAccountProvider = 'openrouter' | 'anthropic' | 'openai' | 'google';
export type AiAccountGrantMutation = {
  action: 'enable' | 'disable';
  provider: AiAccountProvider;
  source: 'opencode-auth-json';
};
export type AiAccountsStatus = {
  version: 1;
  availability: 'available' | 'unavailable';
  childMayRetainCredential: boolean;
  memory: { state: 'disabled' };
  providers?: Record<AiAccountProvider, {
    sourceState: string;
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
  };
};
