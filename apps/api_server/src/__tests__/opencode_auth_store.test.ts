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

  // opencode-gemini-auth stores Google creds in ~/.gemini/oauth_creds.json,
  // not opencode's auth.json — so a linked Google account must still be
  // reported as authed (fixes the sign-in dialog hang + gemini-cli capability).
  describe('gemini-cli plugin auth (~/.gemini/oauth_creds.json)', () => {
    const authPath = '/x/auth.json';
    const geminiPath = '/x/.gemini/oauth_creds.json';

    function mockPaths(files: Record<string, string | undefined>) {
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => files[p as string] !== undefined,
      );
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        const v = files[p as string];
        if (v === undefined) throw new Error('ENOENT');
        return v;
      });
    }

    it('reports google when the gemini creds file has a refresh_token, even if auth.json lacks google', () => {
      mockPaths({
        [authPath]: JSON.stringify({ anthropic: { type: 'oauth', access: 'a' } }),
        [geminiPath]: JSON.stringify({ access_token: 'at', refresh_token: 'rt' }),
      });
      const store = new OpencodeAuthStore(authPath, geminiPath);
      expect(store.listAuthedProviders()).toContain('google');
      expect(store.has('google')).toBe(true);
    });

    it('does not report google when the gemini creds file is absent', () => {
      mockPaths({
        [authPath]: JSON.stringify({ anthropic: { type: 'oauth', access: 'a' } }),
      });
      const store = new OpencodeAuthStore(authPath, geminiPath);
      expect(store.listAuthedProviders()).not.toContain('google');
    });

    it('does not report google when the gemini creds have empty tokens', () => {
      mockPaths({
        [authPath]: '{}',
        [geminiPath]: JSON.stringify({ access_token: '', refresh_token: '' }),
      });
      const store = new OpencodeAuthStore(authPath, geminiPath);
      expect(store.listAuthedProviders()).not.toContain('google');
    });

    it('does not duplicate google when auth.json already has it', () => {
      mockPaths({
        [authPath]: JSON.stringify({ google: { type: 'api', key: 'k' } }),
        [geminiPath]: JSON.stringify({ refresh_token: 'rt' }),
      });
      const store = new OpencodeAuthStore(authPath, geminiPath);
      expect(store.listAuthedProviders().filter((p) => p === 'google')).toHaveLength(1);
    });
  });
});
