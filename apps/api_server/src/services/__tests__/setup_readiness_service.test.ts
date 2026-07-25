import { afterEach, describe, expect, it } from 'vitest';
import { getSetupReadiness } from '../setup_readiness_service';

const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'RHYTHM_MCP_REGISTRY_SEARCH_URL', 'PCO_APPLICATION_ID', 'PCO_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_AUTH_CLIENT_ID'];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('getSetupReadiness', () => {
  it('reports only configuration readiness and never secrets', () => {
    for (const key of keys) delete process.env[key];
    process.env.ANTHROPIC_API_KEY = 'secret-not-returned';
    process.env.RHYTHM_MCP_REGISTRY_SEARCH_URL = 'https://registry.example/search';
    process.env.PCO_APPLICATION_ID = 'pco-id';
    process.env.PCO_SECRET = 'pco-secret';
    process.env.GOOGLE_CLIENT_ID = 'google-id';

    expect(getSetupReadiness()).toEqual({
      cloudLoginOrToken: true,
      usableModel: true,
      rhythmMcp: true,
      externalSearch: true,
      registryUrl: { configured: true, url: 'https://registry.example/search' },
      planningCenter: true,
      gmail: true,
    });
    expect(JSON.stringify(getSetupReadiness())).not.toContain('secret-not-returned');
    expect(JSON.stringify(getSetupReadiness())).not.toContain('pco-secret');
  });
});
