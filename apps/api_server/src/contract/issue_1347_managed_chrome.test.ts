import { afterEach, describe, expect, it, vi } from 'vitest';

import { findChromeBinary } from '../services/managed_chrome_service';
import { logger } from '../utils/logger';

const defaultChrome =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeForTesting =
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const chromium = '/Applications/Chromium.app/Contents/MacOS/Chromium';

describe('issue #1347 managed Chrome binary isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('issue-1347-c1: explicit RHYTHM_CHROME_BIN remains highest priority', () => {
    const selected = findChromeBinary({
      envGet: (key) => key === 'RHYTHM_CHROME_BIN' ? '/custom/testing-chrome' : undefined,
      fsExists: () => true,
      shellResolve: () => chromium,
    });

    expect(selected).toBe('/custom/testing-chrome');
  });

  it('issue-1347-c2: Chrome for Testing and Chromium beat the default app bundle', () => {
    // Regression: the first known path was the GUI Chrome bundle, so Rhythm's
    // headless child hijacked macOS LaunchServices for the user's browser.
    const selected = findChromeBinary({
      envGet: () => undefined,
      fsExists: (path) => [defaultChrome, chromeForTesting, chromium].includes(path),
      shellResolve: () => null,
    });

    expect(selected).toBe(chromeForTesting);
    expect(selected).not.toBe(defaultChrome);
  });

  it('issue-1347-c3: default-bundle-only discovery refuses to launch and warns loudly', () => {
    // Regression: using a separate profile directory does not prevent the
    // headless process from becoming the running instance of Google Chrome.
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const selected = findChromeBinary({
      envGet: () => undefined,
      fsExists: (path) => path === defaultChrome,
      shellResolve: () => defaultChrome,
    });

    expect(selected).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/refus|default.*Chrome|GUI/i),
    );
  });
});
