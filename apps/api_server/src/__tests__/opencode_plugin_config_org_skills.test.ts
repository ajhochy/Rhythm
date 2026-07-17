/**
 * #1054 (OCU-13) — ensureOrgSkillIndex contract tests.
 *
 * Verifies the managed opencode.json `skills.urls` merge logic in isolation
 * (no server spawn, no real engine): preserves user entries, never touches
 * `skills.paths`, is idempotent, and replaces (not duplicates) our own entry
 * when the configured prod URL changes. The live "the engine actually lists
 * the org skill" proof is a separate gated live-e2e test — this file is the
 * fast, deterministic contract for the config-merge logic underneath it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { ensureOrgSkillIndex } from '../services/opencode_plugin_config';
import { env } from '../config/env';

function withEnv(overrides: Partial<typeof env>) {
  const mutableEnv = env as Record<string, unknown>;
  const prior: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    prior[key] = mutableEnv[key];
    mutableEnv[key] = (overrides as Record<string, unknown>)[key];
  }
  return () => {
    for (const key of Object.keys(prior)) {
      mutableEnv[key] = prior[key];
    }
  };
}

describe('ensureOrgSkillIndex', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'org-skill-index-cfg-'));
    configPath = join(dir, 'opencode.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the config from scratch with the org index URL when the file is missing', () => {
    const changed = ensureOrgSkillIndex('http://localhost:4144/org-skills', configPath);
    expect(changed).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.skills.urls).toEqual(['http://localhost:4144/org-skills']);
    // 2-space indent + trailing newline (matches ensureRequiredPlugins style)
    const raw = readFileSync(configPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('preserves a pre-existing user skills.urls entry and never touches skills.paths', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        plugin: ['opencode-gemini-auth'],
        skills: {
          paths: ['~/my-custom-skills'],
          urls: ['https://example.com/.well-known/skills/'],
        },
      }),
      'utf8',
    );

    const changed = ensureOrgSkillIndex('http://localhost:4144/org-skills', configPath);
    expect(changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.plugin).toEqual(['opencode-gemini-auth']);
    expect(parsed.skills.paths).toEqual(['~/my-custom-skills']);
    expect(parsed.skills.urls).toEqual(
      expect.arrayContaining(['https://example.com/.well-known/skills/', 'http://localhost:4144/org-skills']),
    );
    expect(parsed.skills.urls).toHaveLength(2);
  });

  it('is idempotent — re-running with the same URL makes no further change', () => {
    ensureOrgSkillIndex('http://localhost:4144/org-skills', configPath);
    const changed = ensureOrgSkillIndex('http://localhost:4144/org-skills', configPath);
    expect(changed).toBe(false);
  });

  it('replaces (not duplicates) our own entry when the configured URL changes', () => {
    ensureOrgSkillIndex('http://old-host:4144/org-skills', configPath);
    const changed = ensureOrgSkillIndex('https://api.vcrcapps.com/org-skills', configPath);
    expect(changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.skills.urls).toEqual(['https://api.vcrcapps.com/org-skills']);
  });

  it('replacing our entry still preserves an unrelated user entry alongside it', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ skills: { urls: ['https://example.com/.well-known/skills/', 'http://old-host:4144/org-skills'] } }),
      'utf8',
    );

    ensureOrgSkillIndex('https://api.vcrcapps.com/org-skills', configPath);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.skills.urls).toEqual(
      expect.arrayContaining(['https://example.com/.well-known/skills/', 'https://api.vcrcapps.com/org-skills']),
    );
    expect(parsed.skills.urls).toHaveLength(2);
  });

  it('leaves a malformed existing config alone and returns false', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, '{ not valid json', 'utf8');

    const changed = ensureOrgSkillIndex('http://localhost:4144/org-skills', configPath);
    expect(changed).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe('{ not valid json');
  });

  it('defaults the org URL from env.prodApiUrl when no explicit URL is passed', () => {
    const restore = withEnv({ prodApiUrl: 'http://localhost:9999' });
    try {
      ensureOrgSkillIndex(undefined, configPath);
      const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(parsed.skills.urls).toEqual(['http://localhost:9999/org-skills']);
    } finally {
      restore();
    }
  });

  it('falls back to the documented production default when env.prodApiUrl is unset', () => {
    const restore = withEnv({ prodApiUrl: null });
    try {
      ensureOrgSkillIndex(undefined, configPath);
      const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(parsed.skills.urls).toEqual(['https://api.vcrcapps.com/org-skills']);
    } finally {
      restore();
    }
  });

  it('resolves the config path from RHYTHM_OPENCODE_CONFIG_PATH when no explicit path is passed', () => {
    const overridePath = join(dir, 'override-opencode.json');
    const priorEnvVar = process.env.RHYTHM_OPENCODE_CONFIG_PATH;
    process.env.RHYTHM_OPENCODE_CONFIG_PATH = overridePath;
    try {
      ensureOrgSkillIndex('http://localhost:4144/org-skills');
      expect(existsSync(overridePath)).toBe(true);
    } finally {
      if (priorEnvVar === undefined) delete process.env.RHYTHM_OPENCODE_CONFIG_PATH;
      else process.env.RHYTHM_OPENCODE_CONFIG_PATH = priorEnvVar;
    }
  });
});
