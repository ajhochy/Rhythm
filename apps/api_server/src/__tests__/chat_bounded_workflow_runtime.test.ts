import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OpencodeClientService } from '../services/opencode_client_service';

describe('exact workflow existing local core recovery', () => {
  let home: string;
  let configPath: string;
  let deletionPath: string;
  let service: OpencodeClientService;
  let state: string;
  let connects: number;
  let onStatus: (() => void) | null;
  let onConnect: (() => void) | null;
  const config = { mcp: { rhythm: { type: 'local', enabled: true, command: ['owned-fixture-command'] } } };
  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'chat-workflow-runtime-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    configPath = path.join(home, '.config/opencode/opencode.json');
    deletionPath = path.join(home, '.config/rhythm/mcp-deletions.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    mkdirSync(path.dirname(deletionPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(deletionPath, JSON.stringify({ deleted: [] }));
    state = 'configured'; connects = 0; onStatus = null; onConnect = null;
    service = new OpencodeClientService();
    (service as unknown as { client: unknown }).client = { mcp: {
      status: async () => { onStatus?.(); return { data: { rhythm: { status: state } } }; },
      connect: async () => { connects++; state = 'connected'; onConnect?.(); return { data: true }; },
    } };
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(home, { recursive: true, force: true }); });
  it('reconnects only configured local core, verifies connected and preserves all config/deletion bytes', async () => {
    const before = [readFileSync(configPath), readFileSync(deletionPath)];
    expect(await service.reconnectConfiguredLocalRhythmMcp()).toBe(true);
    expect(state).toBe('connected'); expect(connects).toBe(1);
    expect([readFileSync(configPath), readFileSync(deletionPath)]).toEqual(before);
    expect(await service.reconnectConfiguredLocalRhythmMcp()).toBe(true);
    expect(connects).toBe(1);
  });
  it.each(['absent', 'disabled', 'deleted', 'remote', 'needs_auth', 'failed', 'malformed_deletion'])('holds %s without connecting or enabling it', async (kind) => {
    if (kind === 'absent') writeFileSync(configPath, '{}');
    if (kind === 'disabled') writeFileSync(configPath, JSON.stringify({ mcp: { rhythm: { ...config.mcp.rhythm, enabled: false } } }));
    if (kind === 'deleted') writeFileSync(deletionPath, JSON.stringify({ deleted: ['rhythm'] }));
    if (kind === 'remote') writeFileSync(configPath, JSON.stringify({ mcp: { rhythm: { type: 'remote', url: 'https://fixture.invalid' } } }));
    if (kind === 'needs_auth' || kind === 'failed') state = kind;
    if (kind === 'malformed_deletion') writeFileSync(deletionPath, '{}');
    const before = [readFileSync(configPath), readFileSync(deletionPath)];
    expect(await service.reconnectConfiguredLocalRhythmMcp()).toBe(false);
    expect(connects).toBe(0);
    expect([readFileSync(configPath), readFileSync(deletionPath)]).toEqual(before);
  });
  it('rechecks disabled/config drift after status and after connection awaits', async () => {
    const disable = () => writeFileSync(configPath, JSON.stringify({ mcp: { rhythm: { ...config.mcp.rhythm, enabled: false } } }));
    onStatus = disable;
    expect(await service.reconnectConfiguredLocalRhythmMcp()).toBe(false);
    expect(connects).toBe(0);
    writeFileSync(configPath, JSON.stringify(config)); onStatus = null; onConnect = disable;
    expect(await service.reconnectConfiguredLocalRhythmMcp()).toBe(false);
    expect(connects).toBe(1);
  });
});
