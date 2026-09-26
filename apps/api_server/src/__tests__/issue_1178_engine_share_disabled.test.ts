import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { disableEngineExternalSharing } from '../services/opencode_client_service';

describe('issue #1178 external OpenCode sharing guard', () => {
  it('forces external sharing off even when inherited environment opts in', () => {
    const env = {
      OPENCODE_AUTO_SHARE: '1',
      OPENCODE_DISABLE_SHARE: '0',
    } as NodeJS.ProcessEnv;

    disableEngineExternalSharing(env);

    expect(env.OPENCODE_AUTO_SHARE).toBeUndefined();
    expect(env.OPENCODE_DISABLE_SHARE).toBe('1');
  });

  it('applies the forced share guard before the SDK spawns the engine', () => {
    const source = readFileSync(
      join(__dirname, '..', 'services', 'opencode_client_service.ts'),
      'utf8',
    );
    const guardCall = source.indexOf('disableEngineExternalSharing();');
    const spawnCall = source.indexOf('mod.createOpencode(engineOptions)');

    expect(guardCall).toBeGreaterThan(-1);
    expect(spawnCall).toBeGreaterThan(-1);
    expect(guardCall).toBeLessThan(spawnCall);
  });

  it('guards the vendored engine contract that honors OPENCODE_DISABLE_SHARE', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'opencode_fork',
        'packages',
        'opencode',
        'src',
        'share',
        'share-next.ts',
      ),
      'utf8',
    );

    expect(source).toContain('process.env["OPENCODE_DISABLE_SHARE"] === "true"');
    expect(source).toContain('process.env["OPENCODE_DISABLE_SHARE"] === "1"');
  });
});
