import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import {
  ensureOmlxProviderConfig,
  buildLocalAgentPermission,
  parseOllamaPsForModel,
  detectAndUnloadCompetingOllamaModel,
  OMLX_PROVIDER_ID,
  OMLX_LOCAL_AGENT_ID,
} from '../services/local_omlx_provider';

describe('ensureOmlxProviderConfig (#868)', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'omlx-cfg-'));
    configPath = join(dir, 'opencode.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is OPTIONAL: no-ops (never writes) when disabled, matching the default', () => {
    const result = ensureOmlxProviderConfig({ configPath, enabled: false });
    expect(result.changed).toBe(false);
    expect(result.enabled).toBe(false);
    // no file should have been created at all — cloud/default config untouched
    expect(() => readFileSync(configPath, 'utf8')).toThrow();
  });

  it('defaults to disabled when no explicit `enabled` is passed (env.omlxProviderEnabled default)', () => {
    const result = ensureOmlxProviderConfig({ configPath });
    expect(result.changed).toBe(false);
    expect(result.enabled).toBe(false);
  });

  it('creates the provider + agent blocks from scratch when enabled', () => {
    const result = ensureOmlxProviderConfig({ configPath, enabled: true });
    expect(result.changed).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.providerId).toBe(OMLX_PROVIDER_ID);
    expect(result.agentId).toBe(OMLX_LOCAL_AGENT_ID);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.provider.omlx.npm).toBe('@ai-sdk/openai-compatible');
    expect(parsed.provider.omlx.options.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(parsed.agent.local.mode).toBe('primary');
    expect(parsed.agent.local.model).toMatch(/^omlx\//);
  });

  it('preserves unrelated top-level keys and other provider/agent entries', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        plugin: ['opencode-gemini-auth'],
        mcp: { rhythm: { type: 'local', command: ['x'] } },
        provider: { google: { options: { projectId: 'p1' } } },
        agent: { 'workflow-orchestrator': { mode: 'primary' } },
      }),
      'utf8',
    );

    const result = ensureOmlxProviderConfig({ configPath, enabled: true });
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.plugin).toEqual(['opencode-gemini-auth']);
    expect(parsed.mcp.rhythm).toBeTruthy();
    expect(parsed.provider.google.options.projectId).toBe('p1');
    expect(parsed.agent['workflow-orchestrator']).toEqual({ mode: 'primary' });
    expect(parsed.provider.omlx).toBeTruthy();
    expect(parsed.agent.local).toBeTruthy();
  });

  it('no-ops when already correct (idempotent)', () => {
    ensureOmlxProviderConfig({ configPath, enabled: true });
    const before = statSync(configPath).mtimeMs;
    const beforeContent = readFileSync(configPath, 'utf8');

    const result = ensureOmlxProviderConfig({ configPath, enabled: true });
    expect(result.changed).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(beforeContent);
    expect(statSync(configPath).mtimeMs).toBe(before);
  });

  it('does NOT clobber a malformed config file', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    const garbage = '{ this is not valid json ]]';
    writeFileSync(configPath, garbage, 'utf8');

    const result = ensureOmlxProviderConfig({ configPath, enabled: true });
    expect(result.changed).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(garbage);
  });

  it('never throws when the write target is unwritable', () => {
    const filePath = join(dir, 'afile');
    writeFileSync(filePath, 'x', 'utf8');
    const badPath = join(filePath, 'opencode.json');
    expect(() => ensureOmlxProviderConfig({ configPath: badPath, enabled: true })).not.toThrow();
  });

  it('never writes a machine-specific literal path or username into the generated config', () => {
    ensureOmlxProviderConfig({ configPath, enabled: true });
    const raw = readFileSync(configPath, 'utf8');
    // The endpoint must be a loopback URL, never a filesystem path or "/Users/...".
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toContain(require('os').userInfo().username);
  });
});

describe('buildLocalAgentPermission (#868 constrained tool surface)', () => {
  it('allows only the core coding tool surface', () => {
    const permission = buildLocalAgentPermission();
    expect(permission.read).toBe('allow');
    expect(permission.glob).toBe('allow');
    expect(permission.grep).toBe('allow');
    expect(permission.list).toBe('allow');
    expect(permission.edit).toBe('allow');
    expect(permission.bash).toBe('allow');
  });

  it('disables subagent delegation, web, and skills', () => {
    const permission = buildLocalAgentPermission();
    expect(permission.task).toBe('deny');
    expect(permission.webfetch).toBe('deny');
    expect(permission.websearch).toBe('deny');
    expect(permission.skill).toBe('deny');
  });

  it('denies MCP tool surface via the catch-all', () => {
    const permission = buildLocalAgentPermission();
    expect(permission['*']).toBe('deny');
  });
});

describe('parseOllamaPsForModel', () => {
  const psOutput = [
    'NAME                 ID              SIZE      PROCESSOR    UNTIL',
    'qwen3.6-work:latest  abc123          23 GB     100% GPU     4 minutes from now',
  ].join('\n');

  it('detects a running model by base name', () => {
    expect(parseOllamaPsForModel(psOutput, 'qwen3.6-work')).toBe(true);
  });

  it('returns false when the model is not running', () => {
    expect(parseOllamaPsForModel(psOutput, 'llama3')).toBe(false);
  });

  it('returns false for an empty ps output (just header, or nothing running)', () => {
    expect(parseOllamaPsForModel('NAME  ID  SIZE  PROCESSOR  UNTIL', 'qwen3.6-work')).toBe(false);
    expect(parseOllamaPsForModel('', 'qwen3.6-work')).toBe(false);
  });
});

describe('detectAndUnloadCompetingOllamaModel (#868)', () => {
  it('detects and auto-unloads a competing model by default', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce('NAME  ID  SIZE  PROCESSOR  UNTIL\nqwen3.6-work:latest  x  23 GB  100% GPU  1m')
      .mockResolvedValueOnce('');

    const result = await detectAndUnloadCompetingOllamaModel({ runner: { run }, model: 'qwen3.6-work' });
    expect(result.detected).toBe(true);
    expect(result.unloaded).toBe(true);
    expect(run).toHaveBeenNthCalledWith(1, 'ollama', ['ps']);
    expect(run).toHaveBeenNthCalledWith(2, 'ollama', ['stop', 'qwen3.6-work']);
  });

  it('surfaces the manual action when autoUnload is false', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce('NAME  ID  SIZE  PROCESSOR  UNTIL\nqwen3.6-work:latest  x  23 GB  100% GPU  1m');

    const result = await detectAndUnloadCompetingOllamaModel({
      runner: { run },
      model: 'qwen3.6-work',
      autoUnload: false,
    });
    expect(result.detected).toBe(true);
    expect(result.unloaded).toBe(false);
    expect(result.action).toBe('ollama stop qwen3.6-work');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports not-detected when nothing competing is running', async () => {
    const run = vi.fn().mockResolvedValueOnce('NAME  ID  SIZE  PROCESSOR  UNTIL');
    const result = await detectAndUnloadCompetingOllamaModel({ runner: { run }, model: 'qwen3.6-work' });
    expect(result.detected).toBe(false);
    expect(result.unloaded).toBe(false);
  });

  it('never throws when the ollama binary is unavailable', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('command not found: ollama'));
    const result = await detectAndUnloadCompetingOllamaModel({ runner: { run }, model: 'qwen3.6-work' });
    expect(result.detected).toBe(false);
    expect(result.unloaded).toBe(false);
  });

  it('surfaces an error but never throws when `ollama stop` itself fails', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce('NAME  ID  SIZE  PROCESSOR  UNTIL\nqwen3.6-work:latest  x  23 GB  100% GPU  1m')
      .mockRejectedValueOnce(new Error('stop failed'));

    const result = await detectAndUnloadCompetingOllamaModel({ runner: { run }, model: 'qwen3.6-work' });
    expect(result.detected).toBe(true);
    expect(result.unloaded).toBe(false);
    expect(result.error).toContain('stop failed');
  });
});
