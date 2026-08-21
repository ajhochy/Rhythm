import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RHYTHM_ROOT_CLASS } from '../src/host/theme';

const STYLES_ROOT = join(__dirname, '..', 'src', 'styles');

function listCssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return listCssFiles(full);
    return entry.endsWith('.css') ? [full] : [];
  });
}

// rhythm.css is an @import manifest (see src/styles/rhythm.css) rather than one physical
// file with every rule inlined — every screen ships its own scoped stylesheet under
// src/styles/screens/. Concatenating every real file (and dropping the @import lines
// themselves, which aren't rules) checks the scoping invariant across the whole shipped
// stylesheet, not just whichever rules happen to be typed directly into the entry file.
const css = listCssFiles(STYLES_ROOT)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/^\s*@import\s+.*;\s*$/gm, '');

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

  it('every top-level rule is scoped under the single Rhythm root class, and only @media queries and @keyframes definitions are allowed as bare top-level blocks', () => {
    const selectors = topLevelSelectors(css);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      const isMediaQuery = selector.startsWith('@media');
      // @keyframes names are inherently global in CSS — they cannot be nested under a class
      // selector — so the scoping invariant here is a naming convention instead: every
      // animation name must carry the "rhythm-" prefix to avoid colliding with a host page's
      // own @keyframes.
      const isRhythmKeyframes = /^@keyframes\s+rhythm-/.test(selector);
      const isScoped = selector.split(',').every((part) => part.trim().startsWith(`.${RHYTHM_ROOT_CLASS}`));
      expect(isMediaQuery || isRhythmKeyframes || isScoped, `unscoped top-level selector leaks past the Rhythm root: "${selector}"`).toBe(true);
    }
  });
});
