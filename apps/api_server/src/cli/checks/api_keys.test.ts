import { describe, expect, it } from 'vitest';

import { checkApiKeys } from './api_keys';

describe('checkApiKeys', () => {
  it('reports the Anthropic key as configured when present', () => {
    const results = checkApiKeys({
      ANTHROPIC_API_KEY: 'sk-test-value',
      PCO_APPLICATION_ID: 'app-id',
      PCO_SECRET: 'secret',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      RESEND_API_KEY: 'resend-key',
    });

    const anthropic = results.find((r) => r.label === 'Anthropic API key');
    expect(anthropic).toBeDefined();
    expect(anthropic?.pass).toBe(true);
    expect(anthropic?.status).toBe('ok');
  });

  it('fails the combined AI provider check with remediation when no key is present', () => {
    const results = checkApiKeys({}, []);

    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(false);
    expect(provider?.remediation).toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY/);
  });

  it('never includes the raw secret value anywhere in the results', () => {
    const secretValue = 'sk-super-secret-value-12345';
    const results = checkApiKeys({ ANTHROPIC_API_KEY: secretValue });

    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(secretValue);
  });

  it('treats an empty-string env var the same as missing', () => {
    const results = checkApiKeys({ ANTHROPIC_API_KEY: '' }, []);
    const anthropic = results.find((r) => r.label === 'Anthropic API key');
    expect(anthropic?.status).toBe('unconfigured');

    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(false);
  });

  it('flags PCO as a real failure only when partially configured (one of two vars set)', () => {
    const partial = checkApiKeys({ PCO_APPLICATION_ID: 'app-id' });
    const pco = partial.find((r) => r.label === 'Planning Center Online credentials');
    expect(pco?.pass).toBe(false);
    expect(pco?.remediation).toBeDefined();

    const full = checkApiKeys({ PCO_APPLICATION_ID: 'app-id', PCO_SECRET: 'secret' });
    const pcoFull = full.find((r) => r.label === 'Planning Center Online credentials');
    expect(pcoFull?.pass).toBe(true);
    expect(pcoFull?.status).toBe('ok');
  });

  it('reports PCO as unconfigured (not a failure) when neither var is set', () => {
    const results = checkApiKeys({});
    const pco = results.find((r) => r.label === 'Planning Center Online credentials');
    expect(pco?.pass).toBe(true);
    expect(pco?.status).toBe('unconfigured');
  });

  it('accepts an OpenAI key as an alternative to Anthropic for the AI provider check', () => {
    const results = checkApiKeys({ OPENAI_API_KEY: 'sk-openai' }, []);
    const anthropic = results.find((r) => r.label === 'Anthropic API key');
    expect(anthropic?.status).toBe('unconfigured');

    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(true);
  });

  it('passes the AI provider check when Anthropic is OAuth-authed with no env var set', () => {
    const results = checkApiKeys({}, ['anthropic']);

    const anthropic = results.find((r) => r.label === 'Anthropic API key');
    expect(anthropic?.status).toBe('ok');

    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(true);
  });

  it('passes the AI provider check when OpenAI is OAuth-authed with no env var set', () => {
    const results = checkApiKeys({}, ['openai']);

    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(true);
  });

  it('still passes via dotenv-equivalent env var when no OAuth provider is authed', () => {
    const results = checkApiKeys({ ANTHROPIC_API_KEY: 'sk-test' }, []);
    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(true);
  });

  it('fails the AI provider check when neither env var nor OAuth provider is present', () => {
    const results = checkApiKeys({}, ['google', 'github-copilot']);
    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(false);
  });

  it('passes when both env var and OAuth are configured', () => {
    const results = checkApiKeys({ ANTHROPIC_API_KEY: 'sk-test' }, ['anthropic', 'openai']);
    const provider = results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(true);
  });
});
