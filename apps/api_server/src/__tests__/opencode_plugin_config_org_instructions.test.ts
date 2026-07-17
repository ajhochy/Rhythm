/**
 * #1072 (OCU-31) — syncOrgInstructions contract tests.
 *
 * Covers: fetch/write/register/cache-fallback, additive instructions[]
 * registration (user entries preserved), and offline-start serving the
 * cached copy without blocking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncOrgInstructions } from '../services/opencode_plugin_config';

describe('syncOrgInstructions', () => {
  let dir: string;
  let configPath: string;
  let instructionsPath: string;
  const originalFetch = global.fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'org-instructions-cfg-'));
    configPath = join(dir, 'opencode.json');
    instructionsPath = join(dir, 'rhythm-org-instructions.md');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(content: string | null, ok = true) {
    global.fetch = vi.fn().mockResolvedValue({
      ok,
      json: async () => (content === null ? {} : { content, updatedAt: new Date().toISOString() }),
    }) as unknown as typeof fetch;
  }

  it('fetches, writes the file, and registers it in instructions[] on a fresh machine', async () => {
    mockFetch('# Org policy\n\nBe kind.');
    const changed = await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    expect(changed).toBe(true);
    expect(readFileSync(instructionsPath, 'utf8')).toBe('# Org policy\n\nBe kind.');
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.instructions).toEqual([instructionsPath]);
  });

  it('preserves a user-added instructions[] entry (additive, never replaces)', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ instructions: ['./my-own-notes.md'] }));
    mockFetch('org content');
    await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.instructions).toContain('./my-own-notes.md');
    expect(parsed.instructions).toContain(instructionsPath);
  });

  it('is idempotent — a second sync with unchanged content makes no config changes', async () => {
    mockFetch('stable content');
    await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    const changed = await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    expect(changed).toBe(false);
  });

  it('offline/unreachable prod falls back to the cached file and still registers it', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(instructionsPath, 'cached content from a prior successful sync');
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const changed = await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    expect(changed).toBe(true); // not yet registered in this fresh config
    expect(readFileSync(instructionsPath, 'utf8')).toBe('cached content from a prior successful sync');
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.instructions).toContain(instructionsPath);
  });

  it('offline with NOTHING cached yet never blocks startup — returns false, writes nothing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const changed = await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    expect(changed).toBe(false);
    expect(existsSync(instructionsPath)).toBe(false);
    expect(existsSync(configPath)).toBe(false);
  });

  it('a non-200 response is treated as unreachable (falls back to cache, never clears)', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(instructionsPath, 'still-good cached content');
    mockFetch(null, false);
    await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    expect(readFileSync(instructionsPath, 'utf8')).toBe('still-good cached content');
  });

  it('a successful fetch with DIFFERENT content overwrites the cached file', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(instructionsPath, 'old content');
    mockFetch('new content');
    await syncOrgInstructions('http://prod.example', configPath, instructionsPath);
    expect(readFileSync(instructionsPath, 'utf8')).toBe('new content');
  });
});
