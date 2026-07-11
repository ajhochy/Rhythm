import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSession, prompt, listAuthedProviders } = vi.hoisted(() => ({
  createSession: vi.fn(),
  prompt: vi.fn(),
  listAuthedProviders: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { createSession, prompt, listAuthedProviders },
}));

import { scoreSkillBody } from '../services/skill_refiner';

describe('skill_refiner default scorer provider fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAuthedProviders.mockResolvedValue(['anthropic', 'google']);
    createSession
      .mockResolvedValueOnce({ id: 'anthropic-session' })
      .mockResolvedValueOnce({ id: 'google-session' });
    prompt
      .mockResolvedValueOnce({
        info: { error: { name: 'UnknownError' } },
        parts: [],
      })
      .mockResolvedValueOnce({
        info: {},
        parts: [{ type: 'text', text: '87 complete and actionable' }],
      });
  });

  it('passes each retry provider into createSession so Gemini gets its deferred tool cap', async () => {
    const result = await scoreSkillBody(
      { name: 'conventional commit', description: 'Write consistent commits' },
      '# Conventional commits\nUse type(scope): summary.',
    );

    expect(result.score).toBe(87);
    expect(createSession).toHaveBeenNthCalledWith(
      1,
      'skill-measure-score',
      undefined,
      undefined,
      undefined,
      'anthropic',
    );
    expect(createSession).toHaveBeenNthCalledWith(
      2,
      'skill-measure-score',
      undefined,
      undefined,
      undefined,
      'google',
    );
    expect(prompt).toHaveBeenNthCalledWith(
      2,
      'google-session',
      expect.any(String),
      { providerID: 'google', modelID: 'gemini-2.5-pro' },
      undefined,
      { permissionMode: 'bypassPermissions' },
    );
  });
});
