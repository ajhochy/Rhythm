import { describe, it, expect } from 'vitest';
import { OpencodeClientService } from './opencode_client_service';

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
