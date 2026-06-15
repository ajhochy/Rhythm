import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { OpencodeClientService } from '../services/opencode_client_service';

const DESIRED = {
  type: 'local',
  command: ['npx', '-y', '@ajhochy/rhythm-mcp-server'],
  environment: {
    RHYTHM_API_URL: 'https://api.vcrcapps.com',
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
    expect(parsed.mcp.rhythm.command).toEqual(DESIRED.command);
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
});
