import type { DetectedConfig } from './detect_existing_config';
import type { PromptIO } from './prompts';
import type { RunModeResult } from './quick_mode';

export interface RunFullModeOptions {
  io: PromptIO;
  detected: DetectedConfig;
}

interface IntegrationStep {
  /** Detected-config keys this integration owns; all must already be configured to skip. */
  keys: string[];
  /** Human name shown in "Already set" / skip announcements. */
  name: string;
  /** Plain-English explanation shown BEFORE the prompt (required by the issue). */
  explanation: string;
  /** Collects values for this integration; only called when at least one key is unconfigured. */
  collect: (io: PromptIO) => Promise<Record<string, string>>;
}

const STEPS: IntegrationStep[] = [
  {
    keys: ['ANTHROPIC_API_KEY'],
    name: 'AI provider',
    explanation:
      'The AI provider powers the Rhythm agent (chat, automations, scheduled tasks). Anthropic is the default provider.',
    collect: async (io) => ({ ANTHROPIC_API_KEY: await io.askSecret('Paste your Anthropic API key:') }),
  },
  {
    keys: ['OPENAI_API_KEY'],
    name: 'OpenAI (optional alternative provider)',
    explanation:
      'OpenAI can be used instead of or alongside Anthropic for some agent profiles. Optional — skip if you only use Anthropic.',
    collect: async (io) => {
      const wants = await io.confirm('Connect an OpenAI API key?', false);
      if (!wants) return {} as Record<string, string>;
      return { OPENAI_API_KEY: await io.askSecret('Paste your OpenAI API key:') };
    },
  },
  {
    keys: ['PCO_APPLICATION_ID', 'PCO_SECRET'],
    name: 'Planning Center Online',
    explanation:
      'Planning Center Online (PCO) integration lets Rhythm read service plans, positions, and scheduling. Needed for worship/production workflows.',
    collect: async (io) => {
      const wants = await io.confirm('Connect Planning Center Online?', false);
      if (!wants) return {} as Record<string, string>;
      const applicationId = await io.askSecret('PCO Application ID:');
      const secret = await io.askSecret('PCO Secret:');
      return { PCO_APPLICATION_ID: applicationId, PCO_SECRET: secret };
    },
  },
  {
    keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    name: 'Google Calendar / Gmail',
    explanation:
      'Google integration enables Calendar event sync and Gmail search/send from the agent. Optional if you do not use Google Workspace.',
    collect: async (io) => {
      const wants = await io.confirm('Connect Google Calendar / Gmail?', false);
      if (!wants) return {} as Record<string, string>;
      const clientId = await io.askSecret('Google OAuth Client ID:');
      const clientSecret = await io.askSecret('Google OAuth Client Secret:');
      return { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret };
    },
  },
  {
    keys: ['RESEND_API_KEY'],
    name: 'Resend (outbound email)',
    explanation:
      'Resend sends outbound email notifications from Rhythm (e.g. digest emails). Optional.',
    collect: async (io) => {
      const wants = await io.confirm('Connect Resend for outbound email?', false);
      if (!wants) return {} as Record<string, string>;
      return { RESEND_API_KEY: await io.askSecret('Paste your Resend API key:') };
    },
  },
];

/**
 * #872 — Full mode: walks through each integration one at a time, explaining
 * what it is and why it matters BEFORE asking, and letting the user skip any
 * integration they don't need yet. Already-configured integrations are
 * detected and announced instead of re-prompted.
 */
export async function runFullMode(options: RunFullModeOptions): Promise<RunModeResult> {
  const { io, detected } = options;
  const values: Record<string, string> = {};

  for (const step of STEPS) {
    const allConfigured = step.keys.every((key) => detected[key as keyof DetectedConfig].configured);
    if (allConfigured) {
      io.info(`Already set: ✅ ${step.name}`);
      continue;
    }

    io.info(step.explanation);
    const collected = await step.collect(io);
    Object.assign(values, collected);
  }

  return { values };
}
