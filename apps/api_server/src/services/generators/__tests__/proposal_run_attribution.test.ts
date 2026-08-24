/**
 * Every generator that writes a proposal must attribute it to an audit run.
 *
 * This guard exists because the defect was found ONE LANE AT A TIME. The
 * workflow-signal lanes were fixed first and the class was reported closed; a
 * look at a real database then showed 33 unattributed `external-adoption`
 * rows, 32 `create-recipe` and 2 `refine-recipe` — three more generators with
 * the same omission, none of which anyone had audited.
 *
 * An unattributed row is invisible to per-run reporting AND to
 * `deleteRunProposals` cleanup, so it accumulates silently and forever.
 *
 * Structural on purpose. A behavioural test can only cover the lanes someone
 * thought to exercise, which is precisely how this was missed twice. This one
 * fails for a generator nobody has written yet.
 *
 * WHAT IT DOES NOT COVER, stated so nobody reads more into a green run than is
 * there: a file that references `auditRunId` somewhere but builds one
 * particular proposal input without it, via a helper. The file-level check
 * below catches a whole lane that forgot; the literal check catches an inline
 * object that forgot. A prebuilt input assembled in a helper that drops the
 * field, inside a file that uses it elsewhere, would pass.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const GENERATORS_DIR = join(__dirname, '..');

/** Calls that write an agent_org_proposals row (not cookbooks or webhooks). */
const PROPOSAL_WRITE = /\b(?:\w+\.)?proposalsRepo\.createAsync\(|\bcreateIfNotDuplicate\(\s*\w+\s*,/;

function inlineLiteralWrites(source: string): string[] {
  const bodies: string[] = [];
  const re = /\b(?:\w+\.)?proposalsRepo\.createAsync\(\s*\{|\bcreateIfNotDuplicate\(\s*\w+\s*,\s*\{/g;
  for (const match of source.matchAll(re)) {
    const start = source.indexOf('{', match.index! + match[0].length - 1);
    let depth = 0;
    let i = start;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(source.slice(start, i + 1));
  }
  return bodies;
}

const files = readdirSync(GENERATORS_DIR).filter(
  (entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'),
);
const writers = files.filter((file) =>
  PROPOSAL_WRITE.test(readFileSync(join(GENERATORS_DIR, file), 'utf8')),
);

describe('every generator attributes its proposals to an audit run', () => {
  it('finds the generators that write proposals', () => {
    // Non-vacuity. Both assertions below are satisfied by an empty list, and a
    // mis-pointed scan is exactly how a guard ends up proving nothing.
    expect(files.length).toBeGreaterThan(5);
    expect(writers.length).toBeGreaterThanOrEqual(6);
  });

  it.each(writers)('%s references auditRunId', (file) => {
    expect(readFileSync(join(GENERATORS_DIR, file), 'utf8')).toMatch(/\bauditRunId\b/);
  });

  it('no inline proposal literal omits auditRunId', () => {
    const offenders: string[] = [];
    let literals = 0;
    for (const file of writers) {
      for (const body of inlineLiteralWrites(readFileSync(join(GENERATORS_DIR, file), 'utf8'))) {
        literals += 1;
        if (!/\bauditRunId\b/.test(body)) {
          offenders.push(`${file}: ${body.split('\n')[1]?.trim() ?? body.slice(0, 60)}`);
        }
      }
    }
    expect(literals).toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });
});
