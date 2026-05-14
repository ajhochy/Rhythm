import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

import { OpencodeAuthStore } from '../services/opencode_auth_store';

describe('OpencodeAuthStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a Set of provider IDs from a well-formed auth.json', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        anthropic: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 },
        openrouter: { type: 'api', key: 'sk-or-…' },
      }),
    );
    const store = new OpencodeAuthStore();
    expect(store.listAuthedProviders()).toEqual(['anthropic', 'openrouter']);
    expect(store.has('anthropic')).toBe(true);
    expect(store.has('openai')).toBe(false);
  });

  it('returns [] when auth.json is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const store = new OpencodeAuthStore();
    expect(store.listAuthedProviders()).toEqual([]);
  });

  it('returns [] when auth.json is malformed JSON, without throwing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('this is not json');
    const store = new OpencodeAuthStore();
    expect(store.listAuthedProviders()).toEqual([]);
  });

  it('skips entries that are not objects', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ anthropic: 'string-not-object', google: { type: 'api', key: 'k' } }),
    );
    const store = new OpencodeAuthStore();
    expect(store.listAuthedProviders()).toEqual(['google']);
  });
});
