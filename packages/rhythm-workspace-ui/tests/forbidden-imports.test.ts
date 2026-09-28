import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanForForbiddenTerms, FORBIDDEN_TERMS } from './test-utils/forbiddenScan';

const SRC_ROOT = join(__dirname, '..', 'src');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return listSourceFiles(full);
    if (/\.(ts|tsx)$/.test(entry)) return [full];
    return [];
  });
}

describe('scanForForbiddenTerms (scanner self-test)', () => {
  it('flags each forbidden term when present', () => {
    for (const term of FORBIDDEN_TERMS) {
      const hits = scanForForbiddenTerms(`const x = "${term.needle}";`, 'fixture.ts');
      expect(hits, `expected "${term.needle}" to be flagged (${term.reason})`).toHaveLength(1);
    }
  });

  it('reports nothing for clean, host-neutral source', () => {
    const hits = scanForForbiddenTerms('export function TasksScreen() { return null; }', 'fixture.ts');
    expect(hits).toHaveLength(0);
  });
});

describe('shared package source (real sweep)', () => {
  it('imports no Electron types, window.rhythmShell, bearer credential, session creation, approval, or agent-navigation coupling', () => {
    const violations = listSourceFiles(SRC_ROOT).flatMap((file) => {
      const contents = readFileSync(file, 'utf8');
      return scanForForbiddenTerms(contents, file);
    });
    expect(violations, JSON.stringify(violations, null, 2)).toHaveLength(0);
  });
});
