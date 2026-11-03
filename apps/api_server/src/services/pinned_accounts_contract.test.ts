import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => ({ files: new Map<string, string>(), mtime: 1 }));
vi.mock('node:fs', () => ({
  existsSync: (path: string) => memory.files.has(path),
  readFileSync: (path: string) => memory.files.get(path) ?? memory.files.get('plugin'),
  statSync: () => ({ mtimeMs: memory.mtime }),
  writeFileSync: (path: string, data: string) => memory.files.set(path, data),
  mkdirSync: () => {}, chmodSync: () => {},
  renameSync: (from: string, to: string) => memory.files.set(to, memory.files.get(from)!),
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn() } }));
import { OAuthAccountsStore } from './anthropic_accounts_store';
import { OAuthAccountsService } from './anthropic_accounts_service';
// Vendored plain ESM is the shipped source, not a mock of selection.
// @ts-expect-error vendored JS has no declaration file
import { resolveForSession, markSpillover } from '../../opencode_plugins/rhythm-anthropic-accounts/dist/accounts.js';

const accounts = [
  { id: 'A', access: 'synthetic-a', refresh: 'synthetic', label: 'A', expires: 1, status: 'ok' as const },
  { id: 'B', access: 'synthetic-b', refresh: 'synthetic', label: 'B', expires: 1, status: 'ok' as const },
];
beforeEach(() => { memory.files.clear(); memory.mtime++; vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 }))); });

describe('shared persisted pin contract (in-memory filesystem boundary)', () => {
  const store = new OAuthAccountsStore('memory');
  it('c5: legacy/missing files normalize pinned to empty without losing fields', () => {
    expect(store.read()).toMatchObject({ pinned: {} });
    memory.files.set('memory', JSON.stringify({ version: 1, accounts, defaultAccountId: 'B', routing: { session: 'B' } }));
    expect(store.read()).toEqual({ version: 1, accounts, defaultAccountId: 'B', routing: { session: 'B' }, pinned: {} });
  });
  it('c6: true pins, omitted preserves, false clears, next read consumes the result', () => {
    memory.files.set('memory', JSON.stringify({ version: 1, accounts, defaultAccountId: 'A', routing: {} }));
    store.setRouting('session', 'B', { pinned: true });
    expect(store.read()).toMatchObject({ routing: { session: 'B' }, pinned: { session: true } });
    store.setRouting('session', 'B');
    expect(store.read()).toMatchObject({ pinned: { session: true } });
    store.setRouting('session', 'A', { pinned: false });
    expect(store.read()).toMatchObject({ routing: { session: 'A' }, pinned: {} });
  });
  it('c7: removing an account drops only its routing and pins', () => {
    memory.files.set('memory', JSON.stringify({ version: 1, accounts, defaultAccountId: 'A', routing: { a: 'A', b: 'B' }, pinned: { a: true, b: true } }));
    store.removeAccount('A');
    expect(store.read()).toMatchObject({ accounts: [accounts[1]], defaultAccountId: 'B', routing: { b: 'B' }, pinned: { b: true } });
  });
  it('c15: service forwards pin options into the next real store read', () => {
    const service = new OAuthAccountsService(store, globalThis.fetch, {
      tokenEndpoint: 'unused', clientId: 'synthetic', tag: 'test', defaultExpiresInSec: 1,
    });
    service.setRouting('session', 'B', { pinned: true });
    expect(store.read()).toMatchObject({ routing: { session: 'B' }, pinned: { session: true } });
  });
});

describe('Anthropic shipped resolver', () => {
  function fixture(pinned: boolean) {
    memory.files.set('plugin', JSON.stringify({ accounts, defaultAccountId: 'A', routing: { session: 'B' }, ...(pinned ? { pinned: { session: true } } : {}) }));
  }
  it('c8: pinned B has no fallback and ignores a same-mtime override', () => {
    fixture(true);
    markSpillover('session', 'B', 'A');
    expect(resolveForSession('session')).toEqual({ account: accounts[1], fallback: undefined });
  });
  it('c9: unpinned session keeps fallback and override', () => {
    fixture(false);
    expect(resolveForSession('session')).toEqual({ account: accounts[1], fallback: accounts[0] });
    markSpillover('session', 'B', 'A');
    expect(resolveForSession('session')).toEqual({ account: accounts[0], fallback: accounts[1] });
  });
  it('c10: no session retains default and fallback', () => {
    fixture(true);
    expect(resolveForSession(undefined)).toEqual({ account: accounts[0], fallback: accounts[1] });
  });
  it('c14: an unusable pin never silently selects another account', () => {
    memory.files.set('plugin', JSON.stringify({ accounts: [accounts[0], { ...accounts[1], status: 'needs_relogin' }],
      routing: { session: 'B' }, defaultAccountId: 'A', pinned: { session: true } }));
    expect(resolveForSession('session')).toEqual({ account: undefined, fallback: undefined });
  });
});
