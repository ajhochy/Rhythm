import { describe, expect, it } from 'vitest';

import { ScriptedPromptIO } from './prompts';
import { runFullMode } from './full_mode';

const allUnconfigured = {
  ANTHROPIC_API_KEY: { source: null, configured: false },
  OPENAI_API_KEY: { source: null, configured: false },
  PCO_APPLICATION_ID: { source: null, configured: false },
  PCO_SECRET: { source: null, configured: false },
  GOOGLE_CLIENT_ID: { source: null, configured: false },
  GOOGLE_CLIENT_SECRET: { source: null, configured: false },
  GOOGLE_PROJECT_ID: { source: null, configured: false },
  RESEND_API_KEY: { source: null, configured: false },
} as const;

describe('runFullMode', () => {
  it('explains each integration before asking, and collects entered values', async () => {
    const io = new ScriptedPromptIO([
      'sk-anthropic', // AI provider
      'n', // skip OpenAI (already have Anthropic, but full mode still offers it — say no)
      'y', // wants PCO
      'app-id',
      'pco-secret',
      'n', // skip Google
      'n', // skip Resend
    ]);

    const result = await runFullMode({ io, detected: allUnconfigured });

    expect(result.values.ANTHROPIC_API_KEY).toBe('sk-anthropic');
    expect(result.values.PCO_APPLICATION_ID).toBe('app-id');
    expect(result.values.PCO_SECRET).toBe('pco-secret');
    expect(result.values.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(result.values.RESEND_API_KEY).toBeUndefined();

    // Each integration gets an explanation before the prompt.
    expect(io.infoLog.some((l) => /Planning Center/i.test(l))).toBe(true);
    expect(io.infoLog.some((l) => /Google/i.test(l))).toBe(true);
  });

  it('lets the user skip every optional integration', async () => {
    const io = new ScriptedPromptIO([
      'sk-anthropic',
      'n', // openai
      'n', // pco
      'n', // google
      'n', // resend
    ]);

    const result = await runFullMode({ io, detected: allUnconfigured });
    expect(Object.keys(result.values)).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('skips already-configured integrations and announces them instead of re-prompting', async () => {
    const io = new ScriptedPromptIO(['n']); // OpenAI stays optional/unconfigured -> still asked
    const allConfigured = {
      ANTHROPIC_API_KEY: { source: 'env' as const, configured: true },
      OPENAI_API_KEY: { source: null, configured: false },
      PCO_APPLICATION_ID: { source: 'env' as const, configured: true },
      PCO_SECRET: { source: 'env' as const, configured: true },
      GOOGLE_CLIENT_ID: { source: 'env' as const, configured: true },
      GOOGLE_CLIENT_SECRET: { source: 'env' as const, configured: true },
      GOOGLE_PROJECT_ID: { source: null, configured: false },
      RESEND_API_KEY: { source: 'env' as const, configured: true },
    };

    const result = await runFullMode({ io, detected: allConfigured });
    expect(result.values).toEqual({});
    expect(io.infoLog.filter((l) => /Already set/i.test(l)).length).toBeGreaterThanOrEqual(3);
  });
});
