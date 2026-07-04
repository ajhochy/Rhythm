import { OpencodeAuthStore } from '../../services/opencode_auth_store';
import type { CheckResult } from './types';

/**
 * #871 — API key presence checks. Reads presence/validity only; NEVER
 * includes the value of a secret in a returned `CheckResult`.
 *
 * `env` defaults to `process.env` but is injectable so tests (and future
 * `rhythm doctor --env-file <fixture>` runs) can check a fixture env without
 * mutating the real process environment.
 *
 * `authedProviders` defaults to reading opencode's `auth.json` via
 * `OpencodeAuthStore`. Agent dispatch actually runs through the opencode CLI
 * (see `agent_runner.ts` / `opencode_engine.ts`), which is commonly
 * authenticated via OAuth plugins rather than a raw env-var key — a user
 * signed in that way has a real, working provider even with neither
 * `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` set.
 */
export function checkApiKeys(
  env: NodeJS.ProcessEnv = process.env,
  authedProviders: string[] = new OpencodeAuthStore().listAuthedProviders(),
): CheckResult[] {
  const isSet = (key: string): boolean => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  };

  const results: CheckResult[] = [];

  // The AI provider is the one hard requirement — Rhythm cannot run its
  // agent without at least one of Anthropic or OpenAI configured, whether
  // via env var or OAuth (opencode auth.json). The two individual provider
  // checks are informational (status: 'unconfigured') so a user who only
  // set one provider isn't shown a false failure for the other; the
  // combined check below is what actually gates doctor's exit code for
  // this requirement.
  const hasAnthropic = isSet('ANTHROPIC_API_KEY') || authedProviders.includes('anthropic');
  results.push({
    label: 'Anthropic API key',
    pass: true,
    status: hasAnthropic ? 'ok' : 'unconfigured',
  });

  const hasOpenAi = isSet('OPENAI_API_KEY') || authedProviders.includes('openai');
  results.push({
    label: 'OpenAI API key',
    pass: true,
    status: hasOpenAi ? 'ok' : 'unconfigured',
  });

  results.push({
    label: 'AI provider (Anthropic or OpenAI)',
    pass: hasAnthropic || hasOpenAi,
    remediation:
      hasAnthropic || hasOpenAi
        ? undefined
        : 'No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, sign in via `opencode auth login`, or run `rhythm setup`.',
  });

  // The remaining integrations are optional — an unset value is reported as
  // "not configured" (pass, informational) rather than a failure, since a
  // fresh/valid install does not require every integration to be connected.
  const hasPco = isSet('PCO_APPLICATION_ID') && isSet('PCO_SECRET');
  const pcoPartial = isSet('PCO_APPLICATION_ID') !== isSet('PCO_SECRET');
  results.push({
    label: 'Planning Center Online credentials',
    pass: !pcoPartial,
    status: hasPco ? 'ok' : pcoPartial ? undefined : 'unconfigured',
    remediation: pcoPartial
      ? 'Only one of PCO_APPLICATION_ID / PCO_SECRET is set. Set both in your .env file to enable Planning Center integration.'
      : undefined,
  });

  const hasGoogle = isSet('GOOGLE_CLIENT_ID') && isSet('GOOGLE_CLIENT_SECRET');
  const googlePartial = isSet('GOOGLE_CLIENT_ID') !== isSet('GOOGLE_CLIENT_SECRET');
  results.push({
    label: 'Google Calendar / Gmail credentials',
    pass: !googlePartial,
    status: hasGoogle ? 'ok' : googlePartial ? undefined : 'unconfigured',
    remediation: googlePartial
      ? 'Only one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is set. Set both in your .env file to enable Google Calendar and Gmail.'
      : undefined,
  });

  const hasResend = isSet('RESEND_API_KEY');
  results.push({
    label: 'Resend email API key',
    pass: true,
    status: hasResend ? 'ok' : 'unconfigured',
  });

  return results;
}
