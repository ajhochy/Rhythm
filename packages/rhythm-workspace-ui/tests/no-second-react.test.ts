// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import buildConfig from '../tsup.config';

const DIST = join(__dirname, '..', 'dist');

describe('built package uses the host React runtime', () => {
  it('keeps React, React DOM, and JSX runtime entry points explicitly external', () => {
    expect(buildConfig).toMatchObject({
      external: expect.arrayContaining([
        'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client',
      ]),
    });
  });

  describe.each(['index.js', 'index.cjs'])('%s', (entry) => {
    it('resolves React and JSX through bare host imports', () => {
      const bundle = readFileSync(join(DIST, entry), 'utf8');
      expect(bundle).toMatch(/\b(?:from\s*|require\(\s*)['"]react['"]/);
      expect(bundle).toMatch(/\b(?:from\s*|require\(\s*)['"]react\/jsx-runtime['"]/);
    });

    it('contains no React or React DOM runtime implementation', () => {
      const bundle = readFileSync(join(DIST, entry), 'utf8');
      const sourceMap = JSON.parse(readFileSync(join(DIST, `${entry}.map`), 'utf8')) as { sources: string[] };
      expect(sourceMap.sources.length).toBeGreaterThan(0);
      expect(sourceMap.sources.filter((source) => /(?:^|[/\\])node_modules[/\\](?:react|react-dom)(?:[/\\]|$)/.test(source))).toEqual([]);
      for (const runtimeMarker of [
        '__reactFiber',
        '__reactContainer',
        '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
        '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
      ]) {
        expect(bundle.includes(runtimeMarker), `unexpected bundled runtime marker: ${runtimeMarker}`).toBe(false);
      }
    });
  });
});
