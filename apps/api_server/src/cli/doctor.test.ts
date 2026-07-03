import { describe, expect, it } from 'vitest';

import { formatDoctorReport, runDoctor } from './doctor';

describe('runDoctor (integration)', () => {
  it('exits 0 on a fully valid fixture env', async () => {
    const report = await runDoctor({
      env: {
        ANTHROPIC_API_KEY: 'sk-test',
        PCO_APPLICATION_ID: 'app',
        PCO_SECRET: 'secret',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        RESEND_API_KEY: 'key',
      },
      deps: {
        nodeVersion: () => ({ label: 'Node.js version', pass: true }),
        pythonVersion: async () => ({ label: 'Python version', pass: true }),
        configValidity: async () => [{ label: '.env file', pass: true, status: 'ok' }],
        mcpServers: () => [],
        mcpReachability: async () => [],
        rhythmConfig: () => ({ capabilities: {}, disabledMcpServers: [], enabledSkills: null }),
      },
    });

    expect(report.exitCode).toBe(0);
    expect(report.failCount).toBe(0);
  });

  it('exits 1 when a required key is missing', async () => {
    const report = await runDoctor({
      env: {},
      deps: {
        nodeVersion: () => ({ label: 'Node.js version', pass: true }),
        pythonVersion: async () => ({ label: 'Python version', pass: true }),
        configValidity: async () => [],
        mcpServers: () => [],
        mcpReachability: async () => [],
        rhythmConfig: () => ({ capabilities: {}, disabledMcpServers: [], enabledSkills: null }),
      },
    });

    expect(report.exitCode).toBe(1);
    expect(report.failCount).toBeGreaterThan(0);
    const provider = report.results.find((r) => r.label === 'AI provider (Anthropic or OpenAI)');
    expect(provider?.pass).toBe(false);
    expect(provider?.remediation).toBeDefined();
  });

  it('does not crash when the MCP reachability check reports a timeout', async () => {
    const report = await runDoctor({
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      deps: {
        nodeVersion: () => ({ label: 'Node.js version', pass: true }),
        pythonVersion: async () => ({ label: 'Python version', pass: true }),
        configValidity: async () => [],
        mcpServers: () => [{ id: 'slow', name: 'Slow', type: 'remote', url: 'https://slow.example.com' }],
        mcpReachability: async () => [
          { label: 'MCP server: Slow', pass: false, remediation: 'Slow timed out after 3000ms.' },
        ],
        rhythmConfig: () => ({ capabilities: {}, disabledMcpServers: [], enabledSkills: null }),
      },
    });

    expect(report.exitCode).toBe(1);
    const mcp = report.results.find((r) => r.label === 'MCP server: Slow');
    expect(mcp?.pass).toBe(false);
  });

  it('formatDoctorReport renders checkmarks, remediation, and a summary line', async () => {
    const report = await runDoctor({
      env: {},
      deps: {
        nodeVersion: () => ({ label: 'Node.js version', pass: true }),
        pythonVersion: async () => ({ label: 'Python version', pass: true }),
        configValidity: async () => [],
        mcpServers: () => [],
        mcpReachability: async () => [],
        rhythmConfig: () => ({ capabilities: {}, disabledMcpServers: [], enabledSkills: null }),
      },
    });

    const text = formatDoctorReport(report);
    expect(text).toContain('✅');
    expect(text).toContain('❌');
    expect(text).toMatch(/\d+ checks passed, \d+ need attention/);
  });
});
