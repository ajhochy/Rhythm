import { describe, expect, it, vi } from 'vitest';

import { blankSlateConfig } from '../../config/rhythm_config';
import { runBlankSlateMode } from './blank_slate_mode';
import { ScriptedPromptIO } from './prompts';

describe('runBlankSlateMode', () => {
  it('asks only for the AI provider, writes it, and returns a config with only core capabilities enabled', async () => {
    const io = new ScriptedPromptIO(['sk-anthropic']);
    const saveRhythmConfig = vi.fn();
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);

    const result = await runBlankSlateMode({
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
      configuredMcpServerIds: ['notion', 'canva', 'pdf-tools'],
      saveRhythmConfig,
      writeEnvConfig,
    });

    expect(writeEnvConfig).toHaveBeenCalledWith({ ANTHROPIC_API_KEY: 'sk-anthropic' }, expect.anything());
    expect(saveRhythmConfig).toHaveBeenCalledTimes(1);
    const [savedConfig] = saveRhythmConfig.mock.calls[0];
    expect(savedConfig.capabilities.fileOps).toBe(true);
    expect(savedConfig.capabilities.terminal).toBe(true);
    expect(savedConfig.capabilities.webSearch).toBe(false);
    expect(savedConfig.disabledMcpServers.sort()).toEqual(['canva', 'notion', 'pdf-tools']);
    expect(result.config).toEqual(savedConfig);
  });

  it('does not re-ask for the AI provider when already configured', async () => {
    const io = new ScriptedPromptIO([]);
    const saveRhythmConfig = vi.fn();
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);

    await runBlankSlateMode({
      io,
      detected: {
        ANTHROPIC_API_KEY: { source: 'env', configured: true },
        OPENAI_API_KEY: { source: null, configured: false },
        PCO_APPLICATION_ID: { source: null, configured: false },
        PCO_SECRET: { source: null, configured: false },
        GOOGLE_CLIENT_ID: { source: null, configured: false },
        GOOGLE_CLIENT_SECRET: { source: null, configured: false },
        GOOGLE_PROJECT_ID: { source: null, configured: false },
        RESEND_API_KEY: { source: null, configured: false },
      },
      configuredMcpServerIds: [],
      saveRhythmConfig,
      writeEnvConfig,
    });

    expect(writeEnvConfig).not.toHaveBeenCalled();
  });

  it('never enables a capability the blank-slate contract disables, even if requested', async () => {
    const io = new ScriptedPromptIO(['sk-anthropic']);
    const saveRhythmConfig = vi.fn();
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);

    await runBlankSlateMode({
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
      configuredMcpServerIds: [],
      saveRhythmConfig,
      writeEnvConfig,
    });

    const [savedConfig] = saveRhythmConfig.mock.calls[0];
    const expected = blankSlateConfig();
    for (const key of Object.keys(expected.capabilities)) {
      expect(savedConfig.capabilities[key]).toBe(expected.capabilities[key as keyof typeof expected.capabilities]);
    }
  });
});
