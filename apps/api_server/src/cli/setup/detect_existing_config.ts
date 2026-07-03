import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The set of config keys `rhythm setup` walks through. */
export const SETUP_CONFIG_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'PCO_APPLICATION_ID',
  'PCO_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_PROJECT_ID',
  'RESEND_API_KEY',
] as const;

export type SetupConfigKey = (typeof SETUP_CONFIG_KEYS)[number];

export type ConfigSource = 'env' | 'dotenv' | 'opencode.json' | null;

export interface DetectedValue {
  source: ConfigSource;
  configured: boolean;
}

export type DetectedConfig = Record<SetupConfigKey, DetectedValue>;

export interface DetectExistingConfigDeps {
  env: NodeJS.ProcessEnv;
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  dotenvPath?: string;
  opencodeConfigPath?: string;
}

/** Minimal KEY=VALUE dotenv line parser — sufficient for detection (not a full dotenv impl). */
function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * #872 — detects which setup values are already configured, and where they
 * came from (env var, `.env` file, or `opencode.json`), so the wizard can
 * skip re-asking for anything already set. Precedence matches how the app
 * actually resolves config at runtime: process.env wins over `.env` file
 * contents (dotenv is typically loaded INTO process.env at boot, so this
 * mirrors that layering) which wins over opencode.json (used only for the
 * Google project id, which has no env-var equivalent).
 */
export function detectExistingConfig(
  deps: DetectExistingConfigDeps,
): DetectedConfig {
  const dotenvPath = deps.dotenvPath ?? join(process.cwd(), '.env');
  const opencodeConfigPath =
    deps.opencodeConfigPath ?? join(homedir(), '.config', 'opencode', 'opencode.json');

  let dotenvValues: Record<string, string> = {};
  if (deps.existsSync(dotenvPath)) {
    try {
      dotenvValues = parseDotenv(deps.readFileSync(dotenvPath));
    } catch {
      dotenvValues = {};
    }
  }

  let opencodeProjectId: string | undefined;
  if (deps.existsSync(opencodeConfigPath)) {
    try {
      const parsed = JSON.parse(deps.readFileSync(opencodeConfigPath)) as Record<string, unknown>;
      const provider = parsed.provider as Record<string, unknown> | undefined;
      const google = provider?.google as Record<string, unknown> | undefined;
      const options = google?.options as Record<string, unknown> | undefined;
      if (typeof options?.projectId === 'string' && options.projectId.length > 0) {
        opencodeProjectId = options.projectId;
      }
    } catch {
      opencodeProjectId = undefined;
    }
  }

  const result = {} as DetectedConfig;

  for (const key of SETUP_CONFIG_KEYS) {
    if (key === 'GOOGLE_PROJECT_ID') {
      result[key] = opencodeProjectId
        ? { source: 'opencode.json', configured: true }
        : { source: null, configured: false };
      continue;
    }

    if (isNonEmpty(deps.env[key])) {
      result[key] = { source: 'env', configured: true };
    } else if (isNonEmpty(dotenvValues[key])) {
      result[key] = { source: 'dotenv', configured: true };
    } else {
      result[key] = { source: null, configured: false };
    }
  }

  return result;
}

export const DEFAULT_DETECT_DEPS: Omit<DetectExistingConfigDeps, 'env'> = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, 'utf8'),
};
