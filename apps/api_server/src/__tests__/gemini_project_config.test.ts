import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { ensureGeminiProjectConfig, ensureGeminiProjectEnv } from '../services/gemini_project_config';
import { GEMINI_CODE_ASSIST_PROJECT_ID } from '../config/env';

describe('ensureGeminiProjectConfig', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gemini-cfg-'));
    configPath = join(dir, 'opencode.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the config from scratch when the file is missing', () => {
    const result = ensureGeminiProjectConfig({ configPath });
    expect(result.changed).toBe(true);
    expect(result.projectId).toBe(GEMINI_CODE_ASSIST_PROJECT_ID);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.provider.google.options.projectId).toBe(
      GEMINI_CODE_ASSIST_PROJECT_ID,
    );
    // 2-space indent + trailing newline (match addMcp write style)
    const raw = readFileSync(configPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "provider"');
  });

  it('preserves unrelated keys when adding the projectId', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        plugin: ['opencode-gemini-auth'],
        mcp: { rhythm: { type: 'local', command: ['x'] } },
      }),
      'utf8',
    );

    const result = ensureGeminiProjectConfig({ configPath });
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.plugin).toEqual(['opencode-gemini-auth']);
    expect(parsed.mcp.rhythm).toBeTruthy();
    expect(parsed.provider.google.options.projectId).toBe(
      GEMINI_CODE_ASSIST_PROJECT_ID,
    );
  });

  it('no-ops when the projectId already matches (idempotent)', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          google: { options: { projectId: GEMINI_CODE_ASSIST_PROJECT_ID } },
        },
      }) + '\n',
      'utf8',
    );
    const before = statSync(configPath).mtimeMs;
    const beforeContent = readFileSync(configPath, 'utf8');

    const result = ensureGeminiProjectConfig({ configPath });
    expect(result.changed).toBe(false);
    // content unchanged
    expect(readFileSync(configPath, 'utf8')).toBe(beforeContent);
    expect(statSync(configPath).mtimeMs).toBe(before);
  });

  it('overwrites a different existing projectId', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: { google: { options: { projectId: 'some-other-project' } } },
      }),
      'utf8',
    );

    const result = ensureGeminiProjectConfig({ configPath });
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.provider.google.options.projectId).toBe(
      GEMINI_CODE_ASSIST_PROJECT_ID,
    );
  });

  it('does NOT clobber a malformed config file', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    const garbage = '{ this is not valid json ]]';
    writeFileSync(configPath, garbage, 'utf8');

    const result = ensureGeminiProjectConfig({ configPath });
    expect(result.changed).toBe(false);
    // original content preserved, not destroyed
    expect(readFileSync(configPath, 'utf8')).toBe(garbage);
  });

  it('respects an injected projectId override', () => {
    const result = ensureGeminiProjectConfig({
      configPath,
      projectId: 'injected-project-id',
    });
    expect(result.changed).toBe(true);
    expect(result.projectId).toBe('injected-project-id');

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.provider.google.options.projectId).toBe('injected-project-id');
  });

  it('preserves other provider.google.options keys', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          google: { options: { baseURL: 'https://example.test' } },
          anthropic: { options: { foo: 'bar' } },
        },
      }),
      'utf8',
    );

    const result = ensureGeminiProjectConfig({ configPath });
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.provider.google.options.baseURL).toBe('https://example.test');
    expect(parsed.provider.google.options.projectId).toBe(
      GEMINI_CODE_ASSIST_PROJECT_ID,
    );
    expect(parsed.provider.anthropic.options.foo).toBe('bar');
  });

  it('never throws when the write target is unwritable', () => {
    // configPath points at a path whose parent is a file, not a dir → write fails
    const filePath = join(dir, 'afile');
    writeFileSync(filePath, 'x', 'utf8');
    const badPath = join(filePath, 'opencode.json');
    expect(() => ensureGeminiProjectConfig({ configPath: badPath })).not.toThrow();
  });
});

// ── #927: engine-env projectId export ───────────────────────────────────────────
// The opencode.json write above is only surfaced to the gemini-auth plugin via
// the engine's forever-cached config.get(); the env var is the plugin's
// highest-priority, cache-free resolver read live on every turn. Exporting it
// before the engine spawns is what makes the projectId resolve deterministically
// without a manual Re-auth click.

describe('#927 ensureGeminiProjectEnv', () => {
  const KEY = 'OPENCODE_GEMINI_PROJECT_ID';
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[KEY];
    delete process.env[KEY];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('sets OPENCODE_GEMINI_PROJECT_ID when unset (the cache-free resolver the turn path reads)', () => {
    const returned = ensureGeminiProjectEnv({ projectId: 'rhythm-491406' });
    expect(process.env[KEY]).toBe('rhythm-491406');
    expect(returned).toBe('rhythm-491406');
  });

  it('defaults to GEMINI_CODE_ASSIST_PROJECT_ID when no explicit projectId is given', () => {
    ensureGeminiProjectEnv();
    expect(process.env[KEY]).toBe(GEMINI_CODE_ASSIST_PROJECT_ID);
  });

  it('never overwrites an operator-provided value', () => {
    process.env[KEY] = 'operator-project';
    const returned = ensureGeminiProjectEnv({ projectId: 'rhythm-491406' });
    expect(process.env[KEY]).toBe('operator-project');
    expect(returned).toBe('operator-project');
  });

  it('treats a whitespace-only existing value as unset', () => {
    process.env[KEY] = '   ';
    ensureGeminiProjectEnv({ projectId: 'rhythm-491406' });
    expect(process.env[KEY]).toBe('rhythm-491406');
  });
});
