/**
 * W1 package C — the projection boundary must be the ONLY way a profile
 * reaches disk.
 *
 * `writeAgentProfileFile` takes a complete config row. Any caller holding such
 * a row across an await has a possibly-stale copy, and writing it silently
 * overwrites a newer operator edit in the file the OpenCode engine loads.
 * `projectLatestAgentProfile` exists precisely so callers state an INTENT
 * (profile id + the revision they believe they are projecting) and the
 * boundary re-reads the latest row itself.
 *
 * A guard rather than a comment, because the whole class of defect is one
 * import away and every previous instance of it was found by review, not by
 * the suite.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** Files allowed to reach the low-level renderer directly. */
const ALLOWED = new Set([
  // The renderer itself.
  join(SRC, 'services', 'opencode_agent_writer.ts'),
  // The boundary — the one legitimate caller.
  join(SRC, 'services', 'agent_profile_projection_service.ts'),
]);

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'contract' || entry === 'node_modules') continue;
      productionFiles(full, out);
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
    out.push(full);
  }
  return out;
}

describe('W1 package C: profile projection has exactly one boundary', () => {
  it('no production module calls the low-level row writer directly', () => {
    const offenders: string[] = [];
    for (const file of productionFiles(SRC)) {
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const [index, line] of source.split('\n').entries()) {
        // Comments and doc references are fine; a CALL is not.
        const code = line.replace(/^\s*(\/\/|\*).*$/, '');
        if (/\bwriteAgentProfileFile\s*\(/.test(code) || /\bsyncAgentProfileFileForState\s*\(/.test(code)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
