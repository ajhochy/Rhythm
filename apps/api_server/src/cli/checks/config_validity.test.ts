import { describe, expect, it } from 'vitest';

import { checkConfigValidity } from './config_validity';

describe('checkConfigValidity', () => {
  it('passes for a file that does not exist (nothing to validate yet)', async () => {
    const results = await checkConfigValidity({
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('should not be called');
      },
      paths: [{ label: '.env file', path: '/fake/.env', kind: 'dotenv' }],
    });
    expect(results[0].pass).toBe(true);
    expect(results[0].status).toBe('unconfigured');
  });

  it('passes for valid JSON content', async () => {
    const results = await checkConfigValidity({
      existsSync: () => true,
      readFileSync: () => '{"mcp": {}}',
      paths: [{ label: 'opencode.json', path: '/fake/opencode.json', kind: 'json' }],
    });
    expect(results[0].pass).toBe(true);
    expect(results[0].status).toBe('ok');
  });

  it('fails with remediation for invalid JSON content', async () => {
    const results = await checkConfigValidity({
      existsSync: () => true,
      readFileSync: () => '{not valid json',
      paths: [{ label: 'opencode.json', path: '/fake/opencode.json', kind: 'json' }],
    });
    expect(results[0].pass).toBe(false);
    expect(results[0].remediation).toMatch(/opencode\.json/);
  });

  it('passes for a readable dotenv file regardless of contents', async () => {
    const results = await checkConfigValidity({
      existsSync: () => true,
      readFileSync: () => 'ANTHROPIC_API_KEY=abc\n# comment\n',
      paths: [{ label: '.env file', path: '/fake/.env', kind: 'dotenv' }],
    });
    expect(results[0].pass).toBe(true);
  });

  it('fails gracefully (no throw) when the file exists but cannot be read', async () => {
    const results = await checkConfigValidity({
      existsSync: () => true,
      readFileSync: () => {
        throw new Error('EACCES: permission denied');
      },
      paths: [{ label: '.env file', path: '/fake/.env', kind: 'dotenv' }],
    });
    expect(results[0].pass).toBe(false);
    expect(results[0].remediation).toBeDefined();
  });
});
