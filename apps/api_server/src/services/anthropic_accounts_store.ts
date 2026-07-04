import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

export type AnthropicAccountStatus = 'ok' | 'needs_relogin';

export interface AnthropicAccount {
  id: string;
  label: string;
  access: string;
  refresh: string;
  expires: number; // ms epoch
  status: AnthropicAccountStatus;
  subscriptionType?: string;
}

export interface AnthropicAccountsFile {
  version: 1;
  accounts: AnthropicAccount[];
  defaultAccountId: string | null;
  /** sdkSessionId -> accountId. Written by api_server only; read by the engine plugin. */
  routing: Record<string, string>;
}

const EMPTY: AnthropicAccountsFile = { version: 1, accounts: [], defaultAccountId: null, routing: {} };

export function defaultAccountsFilePath(): string {
  return (
    process.env.RHYTHM_ACCOUNTS_FILE ??
    join(homedir(), 'Library', 'Application Support', 'Rhythm', 'anthropic-accounts.json')
  );
}

export class AnthropicAccountsStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultAccountsFilePath();
  }

  get path(): string {
    return this.filePath;
  }

  read(): AnthropicAccountsFile {
    if (!existsSync(this.filePath)) return structuredClone(EMPTY);
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return structuredClone(EMPTY);
      const f = parsed as AnthropicAccountsFile;
      return {
        version: 1,
        accounts: Array.isArray(f.accounts) ? f.accounts : [],
        defaultAccountId: typeof f.defaultAccountId === 'string' ? f.defaultAccountId : null,
        routing: f.routing && typeof f.routing === 'object' ? f.routing : {},
      };
    } catch (err) {
      logger.error('[AnthropicAccountsStore] read failed:', err);
      return structuredClone(EMPTY);
    }
  }

  private write(f: AnthropicAccountsFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(f, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      /* best-effort on non-posix */
    }
  }

  upsertAccount(account: AnthropicAccount): void {
    const f = this.read();
    const idx = f.accounts.findIndex((a) => a.id === account.id);
    if (idx >= 0) f.accounts[idx] = account;
    else f.accounts.push(account);
    if (f.defaultAccountId === null) f.defaultAccountId = account.id;
    this.write(f);
  }

  removeAccount(id: string): void {
    const f = this.read();
    f.accounts = f.accounts.filter((a) => a.id !== id);
    if (f.defaultAccountId === id) f.defaultAccountId = f.accounts[0]?.id ?? null;
    for (const [ses, acct] of Object.entries(f.routing)) {
      if (acct === id) delete f.routing[ses];
    }
    this.write(f);
  }

  setDefault(id: string): void {
    const f = this.read();
    if (!f.accounts.some((a) => a.id === id)) return;
    f.defaultAccountId = id;
    this.write(f);
  }

  setRouting(sdkSessionId: string, accountId: string): void {
    const f = this.read();
    f.routing[sdkSessionId] = accountId;
    this.write(f);
  }

  setStatus(id: string, status: AnthropicAccountStatus): void {
    const f = this.read();
    const acct = f.accounts.find((a) => a.id === id);
    if (!acct) return;
    acct.status = status;
    this.write(f);
  }
}
