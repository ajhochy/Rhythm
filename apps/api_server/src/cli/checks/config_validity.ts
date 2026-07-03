import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CheckResult } from './types';

export type ConfigFileKind = 'json' | 'dotenv';

export interface ConfigFileSpec {
  label: string;
  path: string;
  kind: ConfigFileKind;
}

export interface ConfigValidityDeps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  paths?: ConfigFileSpec[];
}

const DEFAULT_DEPS: ConfigValidityDeps = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, 'utf8'),
};

/** Default config files `rhythm doctor` checks for validity/readability. */
export function defaultConfigPaths(cwd: string = process.cwd()): ConfigFileSpec[] {
  return [
    { label: '.env file', path: join(cwd, '.env'), kind: 'dotenv' },
    {
      label: 'opencode.json',
      path: join(homedir(), '.config', 'opencode', 'opencode.json'),
      kind: 'json',
    },
  ];
}

function validateDotenv(content: string): { ok: boolean; error?: string } {
  // A dotenv file has no strict grammar to fail; any readable text file is
  // "valid" for this check's purposes (line-level KEY=VALUE parsing is
  // permissive by convention across the ecosystem). We only guard against
  // binary/garbage content that can't even be read as UTF-8, which
  // `readFileSync` would already have thrown for.
  void content;
  return { ok: true };
}

function validateJson(content: string): { ok: boolean; error?: string } {
  try {
    JSON.parse(content);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * #871 — checks that declared config files are present, readable, and (for
 * JSON files) parse cleanly. A missing file is NOT a failure — it is
 * "unconfigured" (nothing to validate yet); only an existing-but-broken file
 * fails the check.
 */
export async function checkConfigValidity(
  deps: ConfigValidityDeps = DEFAULT_DEPS,
): Promise<CheckResult[]> {
  const paths = deps.paths ?? defaultConfigPaths();

  return paths.map((spec): CheckResult => {
    if (!deps.existsSync(spec.path)) {
      return {
        label: spec.label,
        pass: true,
        status: 'unconfigured',
      };
    }

    let content: string;
    try {
      content = deps.readFileSync(spec.path);
    } catch (err) {
      return {
        label: spec.label,
        pass: false,
        remediation: `${spec.label} exists at ${spec.path} but could not be read: ${
          err instanceof Error ? err.message : String(err)
        }. Check file permissions.`,
      };
    }

    const validation = spec.kind === 'json' ? validateJson(content) : validateDotenv(content);
    if (!validation.ok) {
      return {
        label: spec.label,
        pass: false,
        remediation: `${spec.label} at ${spec.path} is not valid JSON (${validation.error}). Fix or remove the file.`,
      };
    }

    return { label: spec.label, pass: true, status: 'ok' };
  });
}
