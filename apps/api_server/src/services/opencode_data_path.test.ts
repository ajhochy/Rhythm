/**
 * Regression guard: the API must find the engine's data where the engine keeps it.
 *
 * The engine follows XDG_DATA_HOME; six API modules hard-coded
 * ~/.local/share/opencode. Live 0.18.70 qualification: the isolated engine had
 * no auth.json, but the API read the user's real one, saw an OpenAI entry and
 * skipped pushing the fixture account, so the router never saw OpenAI.
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { opencodeDataFile } from '../config/env';
import { OAuthAccountsStore } from './anthropic_accounts_store';
import { OpenAIAccountsService, type OpenAIAccount } from './openai_accounts_service';

afterEach(() => { vi.unstubAllEnvs(); });

describe('opencode data path', () => {
  it('follows XDG_DATA_HOME like the engine does', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xdg-'));
    vi.stubEnv('XDG_DATA_HOME', dir);
    expect(opencodeDataFile('auth.json')).toBe(join(dir, 'opencode', 'auth.json'));
  });

  it('reads the engine credential from the isolated data dir, not the home default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xdg-'));
    vi.stubEnv('XDG_DATA_HOME', dir);
    const service = new OpenAIAccountsService(new OAuthAccountsStore<OpenAIAccount>(join(dir, 'accounts.json')), vi.fn() as never);
    // Isolated engine has no auth.json yet: nothing to see, so the fixture account gets pushed.
    expect(service.readEngineCredential()).toBeNull();
    const { mkdirSync } = require('fs') as typeof import('fs');
    mkdirSync(join(dir, 'opencode'));
    writeFileSync(join(dir, 'opencode', 'auth.json'), JSON.stringify({ openai: { type: 'oauth', access: 'synthetic-a', refresh: 'synthetic-r', expires: 1 } }));
    expect(service.readEngineCredential()?.access).toBe('synthetic-a');
  });
});
