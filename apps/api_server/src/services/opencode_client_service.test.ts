import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import {
  OpencodeClientService,
  augmentPathForOpencode,
} from './opencode_client_service';

describe('augmentPathForOpencode', () => {
  let originalPath: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it('prepends opencode bin + homebrew + /usr/local/bin to PATH', () => {
    process.env.PATH = '/usr/bin:/bin';
    augmentPathForOpencode();
    const parts = process.env.PATH!.split(':');
    expect(parts).toContain(join(homedir(), '.opencode', 'bin'));
    expect(parts).toContain('/opt/homebrew/bin');
    expect(parts).toContain('/usr/local/bin');
    expect(parts).toContain('/usr/bin');
  });

  it('is idempotent — repeated calls do not duplicate entries', () => {
    process.env.PATH = '/usr/bin:/bin';
    augmentPathForOpencode();
    const afterFirst = process.env.PATH;
    augmentPathForOpencode();
    augmentPathForOpencode();
    expect(process.env.PATH).toBe(afterFirst);
  });

  it('preserves entries already in PATH without reordering them', () => {
    const homebrew = '/opt/homebrew/bin';
    process.env.PATH = `${homebrew}:/usr/bin`;
    augmentPathForOpencode();
    const parts = process.env.PATH!.split(':');
    expect(parts.filter((p) => p === homebrew).length).toBe(1);
  });

  it('handles empty PATH gracefully', () => {
    process.env.PATH = '';
    augmentPathForOpencode();
    const parts = process.env.PATH!.split(':');
    expect(parts).toContain(join(homedir(), '.opencode', 'bin'));
    expect(parts.filter((p) => p === '').length).toBe(0);
  });
});

describe('OpencodeClientService', () => {
  it('starts as uninitialized', () => {
    const service = new OpencodeClientService();
    expect(service.isReady).toBe(false);
    expect(service.statusMessage).toContain('not initialized');
  });

  it('returns empty providers when not initialized', async () => {
    const service = new OpencodeClientService();
    const providers = await service.listProviders();
    expect(providers).toEqual([]);
  });

  it('returns empty models when not initialized', async () => {
    const service = new OpencodeClientService();
    const models = await service.listModels('anthropic');
    expect(models).toEqual([]);
  });

  it('returns false for setAuth when not initialized', async () => {
    const service = new OpencodeClientService();
    const result = await service.setAuth('anthropic', 'sk-test');
    expect(result).toBe(false);
  });

  it('returns null for createSession when not initialized', async () => {
    const service = new OpencodeClientService();
    const session = await service.createSession('test-session');
    expect(session).toBeNull();
  });

  it('returns null for prompt when not initialized', async () => {
    const service = new OpencodeClientService();
    const result = await service.prompt('session-id', 'hello');
    expect(result).toBeNull();
  });

  it('returns null for subscribeToEvents when not initialized', async () => {
    const service = new OpencodeClientService();
    const events = await service.subscribeToEvents();
    expect(events).toBeNull();
  });

  it('updates status after dispose', () => {
    const service = new OpencodeClientService();
    service.dispose();
    expect(service.isReady).toBe(false);
  });
});
