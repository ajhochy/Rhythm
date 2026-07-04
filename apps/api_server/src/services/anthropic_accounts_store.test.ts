import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AnthropicAccountsStore } from './anthropic_accounts_store';

describe('AnthropicAccountsStore', () => {
  let store: AnthropicAccountsStore;
  beforeEach(() => {
    store = new AnthropicAccountsStore(join(mkdtempSync(join(tmpdir(), 'acct-')), 'accounts.json'));
  });

  it('returns empty file shape when file missing', () => {
    expect(store.read()).toEqual({ version: 1, accounts: [], defaultAccountId: null, routing: {} });
  });

  it('upserts an account and makes the first one default', () => {
    store.upsertAccount({ id: 'team', label: 'Team', access: 'a', refresh: 'r', expires: 123, status: 'ok' });
    const f = store.read();
    expect(f.accounts).toHaveLength(1);
    expect(f.defaultAccountId).toBe('team');
  });

  it('upsert with existing id replaces tokens but keeps default', () => {
    store.upsertAccount({ id: 'team', label: 'Team', access: 'a', refresh: 'r', expires: 1, status: 'ok' });
    store.upsertAccount({ id: 'personal', label: 'Me', access: 'b', refresh: 's', expires: 2, status: 'ok' });
    store.upsertAccount({ id: 'team', label: 'Team', access: 'a2', refresh: 'r2', expires: 3, status: 'ok' });
    const f = store.read();
    expect(f.accounts.find((a) => a.id === 'team')!.access).toBe('a2');
    expect(f.defaultAccountId).toBe('team');
  });

  it('removeAccount clears default and its routing entries', () => {
    store.upsertAccount({ id: 'team', label: 'T', access: 'a', refresh: 'r', expires: 1, status: 'ok' });
    store.setRouting('ses_1', 'team');
    store.removeAccount('team');
    const f = store.read();
    expect(f.accounts).toHaveLength(0);
    expect(f.defaultAccountId).toBeNull();
    expect(f.routing).toEqual({});
  });

  it('setDefault + setRouting persist', () => {
    store.upsertAccount({ id: 'a', label: 'A', access: 'x', refresh: 'y', expires: 1, status: 'ok' });
    store.upsertAccount({ id: 'b', label: 'B', access: 'x', refresh: 'y', expires: 1, status: 'ok' });
    store.setDefault('b');
    store.setRouting('ses_9', 'a');
    expect(store.read().defaultAccountId).toBe('b');
    expect(store.read().routing['ses_9']).toBe('a');
  });
});
