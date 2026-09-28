import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

export type AnthropicAccountStatus = 'ok' | 'needs_relogin';
export type OAuthAccountStatus = AnthropicAccountStatus;

/** Provider-agnostic multi-account OAuth record (Anthropic + OpenAI share this store). */
export interface OAuthAccount {
  id: string;
  label: string;
  access: string;
  refresh: string;
  expires: number; // ms epoch
  status: OAuthAccountStatus;
}

export interface AnthropicAccount extends OAuthAccount {
  subscriptionType?: string;
}

export interface OAuthAccountsFile<A extends OAuthAccount = AnthropicAccount> {
  version: 1;
  accounts: A[];
  defaultAccountId: string | null;
  /** sdkSessionId -> accountId. Written by api_server only; read by the engine plugin. */
  routing: Record<string, string>;
}
export type AnthropicAccountsFile = OAuthAccountsFile<AnthropicAccount>;

const EMPTY: OAuthAccountsFile<OAuthAccount> = { version: 1, accounts: [], defaultAccountId: null, routing: {} };

export function defaultAccountsFilePath(): string {
  return (
    process.env.RHYTHM_ACCOUNTS_FILE ??
    join(homedir(), 'Library', 'Application Support', 'Rhythm', 'anthropic-accounts.json')
  );
}

export class OAuthAccountsStore<A extends OAuthAccount = AnthropicAccount> {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  get path(): string {
    return this.filePath;
  }

  read(): OAuthAccountsFile<A> {
    if (!existsSync(this.filePath)) return structuredClone(EMPTY) as OAuthAccountsFile<A>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return structuredClone(EMPTY) as OAuthAccountsFile<A>;
      const f = parsed as OAuthAccountsFile<A>;
      return {
        version: 1,
        accounts: Array.isArray(f.accounts) ? f.accounts : [],
        defaultAccountId: typeof f.defaultAccountId === 'string' ? f.defaultAccountId : null,
        routing: f.routing && typeof f.routing === 'object' ? f.routing : {},
      };
    } catch (err) {
      logger.error(`[OAuthAccountsStore] read failed (${this.filePath}):`, err);
      return structuredClone(EMPTY) as OAuthAccountsFile<A>;
    }
  }

  private write(f: OAuthAccountsFile<A>): void {
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

  upsertAccount(account: A): void {
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

  setStatus(id: string, status: OAuthAccountStatus): void {
    const f = this.read();
    const acct = f.accounts.find((a) => a.id === id);
    if (!acct) return;
    acct.status = status;
    this.write(f);
  }

  rename(id: string, label: string): boolean {
    const f = this.read();
    const acct = f.accounts.find((a) => a.id === id);
    if (!acct) return false;
    acct.label = label;
    this.write(f);
    return true;
  }
}

export class AnthropicAccountsStore extends OAuthAccountsStore<AnthropicAccount> {
  constructor(filePath?: string) {
    super(filePath ?? defaultAccountsFilePath());
  }
}
