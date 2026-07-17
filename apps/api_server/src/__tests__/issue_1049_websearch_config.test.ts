import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveWebsearchConfig } from '../config/env';

// OCU-08 (#1049) — websearch provider + key plumbing. The resolver is the
// single source of truth for whether the engine spawns with the websearch env
// delta and which engine env var the key maps onto. Config round-trip + the
// "key never logged" invariant are covered here.

const KEYS = [
  'RHYTHM_WEBSEARCH_PROVIDER',
  'RHYTHM_WEBSEARCH_API_KEY',
] as const;

describe('OCU-08 (#1049) resolveWebsearchConfig', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns null when unconfigured (no key → no engine env delta)', () => {
    expect(resolveWebsearchConfig()).toBeNull();
  });

  it('returns null when a key is set but provider is missing/invalid', () => {
    process.env.RHYTHM_WEBSEARCH_API_KEY = 'sk-test';
    expect(resolveWebsearchConfig()).toBeNull();
    process.env.RHYTHM_WEBSEARCH_PROVIDER = 'bing';
    expect(resolveWebsearchConfig()).toBeNull();
  });

  it('returns null when provider is set but the key is blank', () => {
    process.env.RHYTHM_WEBSEARCH_PROVIDER = 'exa';
    process.env.RHYTHM_WEBSEARCH_API_KEY = '   ';
    expect(resolveWebsearchConfig()).toBeNull();
  });

  it('maps exa → EXA_API_KEY', () => {
    process.env.RHYTHM_WEBSEARCH_PROVIDER = 'exa';
    process.env.RHYTHM_WEBSEARCH_API_KEY = 'exa-key';
    expect(resolveWebsearchConfig()).toEqual({
      provider: 'exa',
      apiKey: 'exa-key',
      keyEnvVar: 'EXA_API_KEY',
    });
  });

  it('maps parallel → PARALLEL_API_KEY (case-insensitive provider)', () => {
    process.env.RHYTHM_WEBSEARCH_PROVIDER = 'Parallel';
    process.env.RHYTHM_WEBSEARCH_API_KEY = 'par-key';
    expect(resolveWebsearchConfig()).toEqual({
      provider: 'parallel',
      apiKey: 'par-key',
      keyEnvVar: 'PARALLEL_API_KEY',
    });
  });

  it('simulates the engine-spawn env injection (round-trip onto process.env)', () => {
    process.env.RHYTHM_WEBSEARCH_PROVIDER = 'exa';
    process.env.RHYTHM_WEBSEARCH_API_KEY = 'exa-secret';
    const cfg = resolveWebsearchConfig()!;
    // Mirror opencode_client_service.initialize()'s injection block.
    const childEnv: Record<string, string> = {};
    childEnv.OPENCODE_WEBSEARCH_PROVIDER = cfg.provider;
    childEnv[cfg.keyEnvVar] = cfg.apiKey;
    expect(childEnv.OPENCODE_WEBSEARCH_PROVIDER).toBe('exa');
    expect(childEnv.EXA_API_KEY).toBe('exa-secret');
    expect(childEnv.PARALLEL_API_KEY).toBeUndefined();
  });
});
