/**
 * skill_env_validator.test.ts — #874 (setup-04): skills declare required env vars.
 *
 * Scope note: Rhythm's skill runtime is the desktop app + local agent server —
 * there is no interactive TTY the api_server can prompt through (unlike the
 * hermes-agent CLI prior art the issue cites). This module is the DETECTION +
 * SURFACING layer the issue's acceptance criteria describe as consumed by
 * "the picker/doctor": it tells the caller which declared vars are missing so
 * a UI (CLI prompt, `rhythm doctor`, or a Flutter dialog) can act on it, and it
 * owns the actual secure `.env` write path (masked in a UI's responsibility,
 * not this module's — see storeEnvVar's 0600 permission contract) plus the
 * env values available to sandboxed skill execution.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkRequiredEnv,
  storeEnvVar,
  buildMessagingConfigInstruction,
} from '../skill_env_validator';

describe('checkRequiredEnv (#874)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('a skill with no required_environment_variables field behaves unchanged (empty result)', () => {
    const result = checkRequiredEnv([]);
    expect(result.missing).toEqual([]);
    expect(result.satisfied).toEqual([]);
    expect(result.allSatisfied).toBe(true);
  });

  it('flags a declared var that is missing from process.env', () => {
    delete process.env.TENOR_API_KEY;
    const result = checkRequiredEnv([{ name: 'TENOR_API_KEY', prompt: 'Your Tenor API key' }]);
    expect(result.missing).toEqual([{ name: 'TENOR_API_KEY', prompt: 'Your Tenor API key' }]);
    expect(result.satisfied).toEqual([]);
    expect(result.allSatisfied).toBe(false);
  });

  it('does not flag an already-set var (already-set values are not re-asked)', () => {
    process.env.TENOR_API_KEY = 'already-set-value';
    const result = checkRequiredEnv([{ name: 'TENOR_API_KEY' }]);
    expect(result.missing).toEqual([]);
    expect(result.satisfied).toEqual(['TENOR_API_KEY']);
    expect(result.allSatisfied).toBe(true);
  });

  it('treats an empty-string env var as missing, not satisfied', () => {
    process.env.TENOR_API_KEY = '';
    const result = checkRequiredEnv([{ name: 'TENOR_API_KEY' }]);
    expect(result.missing.map((v) => v.name)).toEqual(['TENOR_API_KEY']);
  });

  it('handles a mix of satisfied and missing vars in one skill', () => {
    process.env.FOO_KEY = 'set';
    delete process.env.BAR_KEY;
    const result = checkRequiredEnv([{ name: 'FOO_KEY' }, { name: 'BAR_KEY' }]);
    expect(result.satisfied).toEqual(['FOO_KEY']);
    expect(result.missing.map((v) => v.name)).toEqual(['BAR_KEY']);
    expect(result.allSatisfied).toBe(false);
  });
});

describe('storeEnvVar (#874)', () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rhythm-env-validator-'));
    envPath = join(dir, '.env');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a collected value to .env with 0600 permissions', () => {
    storeEnvVar('TENOR_API_KEY', 'super-secret-value', envPath);
    expect(existsSync(envPath)).toBe(true);
    const mode = statSync(envPath).mode & 0o777;
    expect(mode).toBe(0o600);
    const contents = readFileSync(envPath, 'utf8');
    expect(contents).toContain('TENOR_API_KEY=super-secret-value');
  });

  it('appends to an existing .env without clobbering other keys', () => {
    storeEnvVar('FIRST_KEY', 'one', envPath);
    storeEnvVar('SECOND_KEY', 'two', envPath);
    const contents = readFileSync(envPath, 'utf8');
    expect(contents).toContain('FIRST_KEY=one');
    expect(contents).toContain('SECOND_KEY=two');
  });

  it('updates an existing key in place rather than duplicating it', () => {
    storeEnvVar('TENOR_API_KEY', 'old-value', envPath);
    storeEnvVar('TENOR_API_KEY', 'new-value', envPath);
    const contents = readFileSync(envPath, 'utf8');
    const matches = contents.split('\n').filter((l) => l.startsWith('TENOR_API_KEY='));
    expect(matches).toEqual(['TENOR_API_KEY=new-value']);
  });

  it('sets process.env immediately so the value is usable without a restart', () => {
    delete process.env.TENOR_API_KEY;
    storeEnvVar('TENOR_API_KEY', 'live-value', envPath);
    expect(process.env.TENOR_API_KEY).toBe('live-value');
    delete process.env.TENOR_API_KEY;
  });

  it('quotes values containing special characters so the .env file stays parseable', () => {
    storeEnvVar('WEIRD_KEY', 'value with spaces and #hash', envPath);
    const contents = readFileSync(envPath, 'utf8');
    expect(contents).toContain('WEIRD_KEY="value with spaces and #hash"');
  });
});

describe('buildMessagingConfigInstruction (#874)', () => {
  it('returns a plain-text configuration instruction, never a secret prompt, for a messaging surface', () => {
    const msg = buildMessagingConfigInstruction([
      { name: 'TENOR_API_KEY', help: 'Get one free at https://developers.google.com/tenor' },
    ]);
    expect(msg).toContain('TENOR_API_KEY');
    expect(msg).toContain('rhythm setup');
    expect(msg).not.toMatch(/enter|paste|type in|reply with/i); // never solicits the secret value in chat
  });

  it('lists every missing var when there are multiple', () => {
    const msg = buildMessagingConfigInstruction([{ name: 'FOO_KEY' }, { name: 'BAR_KEY' }]);
    expect(msg).toContain('FOO_KEY');
    expect(msg).toContain('BAR_KEY');
  });
});
