import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('issue #1375 transcript-share purge startup gate', () => {
  it.each([
    { name: 'VITEST true', env: { VITEST: 'true', RHYTHM_TRANSCRIPT_SHARE_PURGE_ENABLED: 'true' }, dbClient: 'postgres', expected: 0 },
    { name: 'flag false', env: { VITEST: 'false', RHYTHM_TRANSCRIPT_SHARE_PURGE_ENABLED: 'false' }, dbClient: 'postgres', expected: 0 },
    { name: 'SQLite', env: { VITEST: 'false', RHYTHM_TRANSCRIPT_SHARE_PURGE_ENABLED: 'true' }, dbClient: 'sqlite', expected: 0 },
    { name: 'all enabled', env: { VITEST: 'false', RHYTHM_TRANSCRIPT_SHARE_PURGE_ENABLED: 'true' }, dbClient: 'postgres', expected: 1 },
  ])('issue-1375-c4: $name starts the job $expected time(s)', async ({ env, dbClient, expected }) => {
    const modulePath = path.resolve(__dirname, '../jobs/transcript_share_purge_job.ts');
    expect(
      existsSync(modulePath),
      'regression: purge startup module is missing',
    ).toBe(true);
    if (!existsSync(modulePath)) return;

    vi.resetModules();
    const module = await import(modulePath);
    const start = vi.fn();
    expect(module.startTranscriptSharePurgeJobIfEnabled({ env, dbClient, start })).toBe(expected === 1);
    expect(start).toHaveBeenCalledTimes(expected);
  });

  it('issue-1375-c4: server startup delegates through the triple-gated helper', () => {
    const serverPath = path.resolve(__dirname, '../server.ts');
    const source = readFileSync(serverPath, 'utf8');
    expect(source).toContain('startTranscriptSharePurgeJobIfEnabled');
  });
});
