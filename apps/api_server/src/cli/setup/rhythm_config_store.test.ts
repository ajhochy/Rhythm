import { describe, expect, it, vi } from 'vitest';

import { blankSlateConfig } from '../../config/rhythm_config';
import { loadRhythmConfig, saveRhythmConfig } from './rhythm_config_store';

describe('loadRhythmConfig', () => {
  it('returns a fully-unconfigured config when no file exists yet', () => {
    const config = loadRhythmConfig({ existsSync: () => false, readFileSync: () => '', path: '/fake/rhythm-capabilities.json' });
    expect(config.capabilities).toEqual({});
    expect(config.enabledSkills).toBeNull();
  });

  it('parses a previously-written config', () => {
    const written = blankSlateConfig();
    const config = loadRhythmConfig({
      existsSync: () => true,
      readFileSync: () => JSON.stringify(written),
      path: '/fake/rhythm-capabilities.json',
    });
    expect(config).toEqual(written);
  });

  it('falls back to unconfigured (never throws) on invalid JSON', () => {
    const config = loadRhythmConfig({
      existsSync: () => true,
      readFileSync: () => '{not json',
      path: '/fake/rhythm-capabilities.json',
    });
    expect(config.capabilities).toEqual({});
  });
});

describe('saveRhythmConfig', () => {
  it('writes the config as pretty JSON to the target path', () => {
    const writeFileSync = vi.fn();
    const config = blankSlateConfig();

    saveRhythmConfig(config, { writeFileSync, path: '/fake/rhythm-capabilities.json' });

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = writeFileSync.mock.calls[0];
    expect(path).toBe('/fake/rhythm-capabilities.json');
    expect(JSON.parse(content)).toEqual(config);
  });
});
