import { describe, expect, it } from 'vitest';

import { detectExistingConfig } from './detect_existing_config';

describe('detectExistingConfig', () => {
  it('detects an env var already set in process.env', () => {
    const detected = detectExistingConfig({
      env: { ANTHROPIC_API_KEY: 'sk-already-set' },
      existsSync: () => false,
      readFileSync: () => '',
    });

    expect(detected.ANTHROPIC_API_KEY).toEqual({ source: 'env', configured: true });
  });

  it('detects a value already present in a .env file even when not in process.env', () => {
    const detected = detectExistingConfig({
      env: {},
      existsSync: (p) => p.endsWith('.env'),
      readFileSync: () => 'ANTHROPIC_API_KEY=sk-from-dotenv\n',
      dotenvPath: '/fake/.env',
    });

    expect(detected.ANTHROPIC_API_KEY).toEqual({ source: 'dotenv', configured: true });
  });

  it('reports not-configured when a key is absent from both env and .env', () => {
    const detected = detectExistingConfig({
      env: {},
      existsSync: () => false,
      readFileSync: () => '',
    });

    expect(detected.ANTHROPIC_API_KEY).toEqual({ source: null, configured: false });
  });

  it('prefers process.env over a .env file value when both are present', () => {
    const detected = detectExistingConfig({
      env: { ANTHROPIC_API_KEY: 'sk-env' },
      existsSync: () => true,
      readFileSync: () => 'ANTHROPIC_API_KEY=sk-dotenv\n',
      dotenvPath: '/fake/.env',
    });

    expect(detected.ANTHROPIC_API_KEY.source).toBe('env');
  });

  it('does not throw when the .env file cannot be read', () => {
    const detected = detectExistingConfig({
      env: {},
      existsSync: () => true,
      readFileSync: () => {
        throw new Error('EACCES');
      },
      dotenvPath: '/fake/.env',
    });

    expect(detected.ANTHROPIC_API_KEY.configured).toBe(false);
  });

  it('detects google client id/secret from opencode.json provider block when present', () => {
    const detected = detectExistingConfig({
      env: {},
      existsSync: (p) => p.endsWith('opencode.json'),
      readFileSync: (p) =>
        p.endsWith('opencode.json')
          ? JSON.stringify({ provider: { google: { options: { projectId: 'my-proj' } } } })
          : '',
      opencodeConfigPath: '/fake/opencode.json',
    });

    expect(detected.GOOGLE_PROJECT_ID).toEqual({ source: 'opencode.json', configured: true });
  });
});
