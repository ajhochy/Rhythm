import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import {
  OpencodeClientService,
  resolveRhythmMcpCommand,
} from '../services/opencode_client_service';

// #814 — the command is resolved dynamically (bundled path, dev override, or
// pinned @version fallback); never assert the historical bare spec here.
const DESIRED = {
  type: 'local',
  timeout: 600_000,
  command: resolveRhythmMcpCommand(),
  environment: {
    RHYTHM_API_URL: 'https://api.vcrcapps.com',
    // #804 — memory MCP tools target the local agent server, not prod.
    RHYTHM_AGENT_URL: 'http://localhost:4001',
    RHYTHM_API_TOKEN: 'tok-1',
  },
};

describe('ensureRhythmMcp diff logic', () => {
  let dir: string;
  let configPath: string;
  let svc: OpencodeClientService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencode-cfg-'));
    configPath = join(dir, 'opencode.json');
    svc = new OpencodeClientService();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds rhythm when absent and persists environment', async () => {
    const result = await svc.ensureRhythmMcp('tok-1', 'https://api.vcrcapps.com', {
      configPath,
      register: false,
    });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.rhythm.environment.RHYTHM_API_TOKEN).toBe('tok-1');
    expect(parsed.mcp.rhythm.environment).not.toHaveProperty(
      'RHYTHM_MCP_INTERNAL_CREDENTIAL',
    );
    expect(parsed.mcp.rhythm.command).toEqual(DESIRED.command);
    expect(parsed.mcp.rhythm.timeout).toBe(600_000);
    // #804 — memory base is pinned to the local agent server regardless of the
    // prod apiUrl above. Changing the prod URL must NOT move this.
    expect(parsed.mcp.rhythm.environment.RHYTHM_AGENT_URL).toBe(
      'http://localhost:4001',
    );
  });

  it('#804: pins RHYTHM_AGENT_URL to the local server even when the prod URL differs', async () => {
    const result = await svc.ensureRhythmMcp('tok-1', 'https://example.test', {
      configPath,
      register: false,
    });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    // prod URL is whatever Settings says…
    expect(parsed.mcp.rhythm.environment.RHYTHM_API_URL).toBe(
      'https://example.test',
    );
    // …but the memory base stays local, decoupled from it.
    expect(parsed.mcp.rhythm.environment.RHYTHM_AGENT_URL).toBe(
      'http://localhost:4001',
    );
  });

  it('no-ops when config already matches', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcp: { rhythm: DESIRED } }), 'utf8');
    const result = await svc.ensureRhythmMcp('tok-1', 'https://api.vcrcapps.com', {
      configPath,
      register: false,
    });
    expect(result.changed).toBe(false);
  });

  it('rewrites when the token rotates', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcp: { rhythm: DESIRED } }), 'utf8');
    const result = await svc.ensureRhythmMcp('tok-2', 'https://api.vcrcapps.com', {
      configPath,
      register: false,
    });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.rhythm.environment.RHYTHM_API_TOKEN).toBe('tok-2');
  });

  it('registers the same secret-free config that it persists', async () => {
    const add = vi.fn().mockResolvedValue({});
    (
      svc as unknown as {
        client: { mcp: { add: typeof add } };
      }
    ).client = { mcp: { add } };

    await svc.ensureRhythmMcp('tok-1', 'https://api.vcrcapps.com', {
      configPath,
    });

    expect(add).toHaveBeenCalledWith({
      body: {
        name: 'rhythm',
        config: expect.objectContaining({
          environment: expect.not.objectContaining({
            RHYTHM_MCP_INTERNAL_CREDENTIAL: expect.anything(),
          }),
        }),
      },
    });
  });

  it('rewrites existing rhythm config when timeout is missing', async () => {
    const legacy = { ...DESIRED } as Record<string, unknown>;
    delete legacy.timeout;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcp: { rhythm: legacy } }), 'utf8');
    const result = await svc.ensureRhythmMcp('tok-1', 'https://api.vcrcapps.com', {
      configPath,
      register: false,
    });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.rhythm.timeout).toBe(600_000);
  });

  it('preserves other mcp servers when updating rhythm', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ mcp: { other: { type: 'local', command: ['x'] } } }),
      'utf8',
    );
    await svc.ensureRhythmMcp('tok-1', 'https://api.vcrcapps.com', {
      configPath,
      register: false,
    });
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.other).toBeTruthy();
    expect(parsed.mcp.rhythm).toBeTruthy();
  });

  it('AV-03 P4: sandbox configures the Rhythm MCP for its isolated API without logging its token', () => {
    // Regression: the sandbox-generated MCP server points at production or exposes its bearer token.
    const sandbox = readFileSync(join(__dirname, '../../../../tools/dev/sandbox.sh'), 'utf8');
    expect(sandbox).toContain('ensure_rhythm_mcp');
    expect(sandbox).toMatch(/apiUrl\\":\\"http:\/\/127\.0\.0\.1:\$API_PORT/);
    expect(sandbox).toContain('apiToken');
    expect(sandbox).not.toMatch(/printf[^\n]*\$token|printf[^\n]*RHYTHM_API_TOKEN/);
  });
});
