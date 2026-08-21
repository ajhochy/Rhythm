import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RHYTHM_ROOT_CLASS } from '../src/host/theme';

const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'rhythm.css'), 'utf8');

function topLevelSelectors(source: string): string[] {
  // Strips comments, then walks brace depth so only depth-0 (top-level) rule selectors
  // are considered — a selector nested inside e.g. a media query body is depth 1+.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const char of stripped) {
    if (char === '{') {
      if (depth === 0) selectors.push(buffer.trim());
      depth += 1;
      buffer = '';
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
      buffer = '';
    } else if (depth === 0) {
      buffer += char;
    }
  }
  return selectors.filter(Boolean);
}

describe('scoped stylesheet', () => {
  it('is non-empty and defines at least one rule', () => {
    expect(css.trim().length).toBeGreaterThan(0);
  });

  it('every top-level rule is scoped under the single Rhythm root class, and only @media queries are allowed as bare top-level blocks', () => {
    const selectors = topLevelSelectors(css);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      const isMediaQuery = selector.startsWith('@media');
      const isScoped = selector.split(',').every((part) => part.trim().startsWith(`.${RHYTHM_ROOT_CLASS}`));
      expect(isMediaQuery || isScoped, `unscoped top-level selector leaks past the Rhythm root: "${selector}"`).toBe(true);
    }
  });
});
