import type { DetectedConfig } from './detect_existing_config';
import type { PromptIO } from './prompts';

export interface RunQuickModeOptions {
  io: PromptIO;
  detected: DetectedConfig;
}

export interface RunModeResult {
  /** Newly-collected values to persist. Already-configured keys are NOT included (nothing to write). */
  values: Record<string, string>;
}

/**
 * #872 — Quick mode: the fastest path to a working install. Only the AI
 * provider is asked for (the one hard requirement — see `checkApiKeys` in
 * #871); every other integration is left as a sensible default (unconfigured
 * = simply not connected yet, which `rhythm doctor` reports as informational
 * rather than a failure). Already-configured values are detected and
 * announced, never re-asked — this is what keeps Quick mode under 2 minutes.
 *
 * OAuth-login is the ideal Quick-mode flow described in the issue, but the
 * OAuth/DCR+PKCE flow internals are explicitly out of scope for this issue
 * ("invokes it, not changes it") and no such flow exists yet for the
 * Anthropic/OpenAI provider — so Quick mode asks for a pasted API key as the
 * fallback until that lands. This keeps the same "one question, done" shape
 * the issue describes and is a drop-in seam for OAuth once available.
 */
export async function runQuickMode(options: RunQuickModeOptions): Promise<RunModeResult> {
  const { io, detected } = options;
  const values: Record<string, string> = {};

  const alreadyHasProvider = detected.ANTHROPIC_API_KEY.configured || detected.OPENAI_API_KEY.configured;

  if (alreadyHasProvider) {
    const via = detected.ANTHROPIC_API_KEY.configured ? 'Anthropic' : 'OpenAI';
    io.info(`Already set: ✅ AI provider (${via})`);
  } else {
    io.info('Connect an AI provider to get started (Anthropic is recommended).');
    const key = await io.askSecret('Paste your Anthropic API key:');
    values.ANTHROPIC_API_KEY = key;
  }

  for (const [key, detectedValue] of Object.entries(detected)) {
    if (key === 'ANTHROPIC_API_KEY' || key === 'OPENAI_API_KEY') continue;
    if (detectedValue.configured) {
      io.info(`Already set: ✅ ${key}`);
    }
  }

  return { values };
}
