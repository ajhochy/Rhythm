import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { profileConfiguresModel } from './agent_runner';

afterEach(() => vi.restoreAllMocks());

const stub = (cfg: unknown) =>
  vi.spyOn(AgentConfigsRepository.prototype, 'getById').mockReturnValue(cfg as never);

describe('profileConfiguresModel', () => {
  it('is false without a config id or config row', () => {
    expect(profileConfiguresModel(null)).toBe(false);
    stub(null);
    expect(profileConfiguresModel('x')).toBe(false);
  });
  it('needs both provider and model', () => {
    stub({ modelProvider: 'anthropic', modelId: null });
    expect(profileConfiguresModel('x')).toBe(false);
    stub({ modelProvider: 'anthropic', modelId: 'claude-sonnet-4-6' });
    expect(profileConfiguresModel('x')).toBe(true);
  });
  it('treats a lookup failure as pinned', () => {
    vi.spyOn(AgentConfigsRepository.prototype, 'getById').mockImplementation(() => {
      throw new Error('db');
    });
    expect(profileConfiguresModel('x')).toBe(true);
  });
});
