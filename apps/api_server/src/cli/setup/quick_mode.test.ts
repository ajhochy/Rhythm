import { describe, expect, it, vi } from 'vitest';

import { ScriptedPromptIO } from './prompts';
import { runQuickMode } from './quick_mode';

describe('runQuickMode', () => {
  it('skips already-configured values and only asks for what is missing', async () => {
    const io = new ScriptedPromptIO(['sk-anthropic-from-user']);

    const result = await runQuickMode({
      io,
      detected: {
        ANTHROPIC_API_KEY: { source: null, configured: false },
        OPENAI_API_KEY: { source: null, configured: false },
        PCO_APPLICATION_ID: { source: 'env', configured: true },
        PCO_SECRET: { source: 'env', configured: true },
        GOOGLE_CLIENT_ID: { source: 'dotenv', configured: true },
        GOOGLE_CLIENT_SECRET: { source: 'dotenv', configured: true },
        GOOGLE_PROJECT_ID: { source: null, configured: false },
        RESEND_API_KEY: { source: null, configured: false },
      },
    });

    expect(result.values).toEqual({ ANTHROPIC_API_KEY: 'sk-anthropic-from-user' });
    // Already-configured values are announced, not re-asked.
    expect(io.infoLog.some((line) => /Already set/i.test(line) && /PCO/i.test(line))).toBe(true);
  });

  it('completes with an empty values object when everything is already configured', async () => {
    const io = new ScriptedPromptIO([]);
    const allConfigured = {
      ANTHROPIC_API_KEY: { source: 'env' as const, configured: true },
      OPENAI_API_KEY: { source: null, configured: false },
      PCO_APPLICATION_ID: { source: 'env' as const, configured: true },
      PCO_SECRET: { source: 'env' as const, configured: true },
      GOOGLE_CLIENT_ID: { source: 'env' as const, configured: true },
      GOOGLE_CLIENT_SECRET: { source: 'env' as const, configured: true },
      GOOGLE_PROJECT_ID: { source: null, configured: false },
      RESEND_API_KEY: { source: null, configured: false },
    };

    const result = await runQuickMode({ io, detected: allConfigured });
    expect(result.values).toEqual({});
  });

  it('propagates an interruption (e.g. Ctrl+C) without partially returning values', async () => {
    const io = new ScriptedPromptIO([]); // no answers scripted -> throws on first ask
    await expect(
      runQuickMode({
        io,
        detected: {
          ANTHROPIC_API_KEY: { source: null, configured: false },
          OPENAI_API_KEY: { source: null, configured: false },
          PCO_APPLICATION_ID: { source: null, configured: false },
          PCO_SECRET: { source: null, configured: false },
          GOOGLE_CLIENT_ID: { source: null, configured: false },
          GOOGLE_CLIENT_SECRET: { source: null, configured: false },
          GOOGLE_PROJECT_ID: { source: null, configured: false },
          RESEND_API_KEY: { source: null, configured: false },
        },
      }),
    ).rejects.toThrow();
  });
});
