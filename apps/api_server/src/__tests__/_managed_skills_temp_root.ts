/**
 * Test-isolation helper for the Rhythm-managed skills directory.
 *
 * The managed-skills root defaults to `~/.config/opencode/skills` — the user's
 * REAL, hand-authored skill library. Tests that isolated only the DB
 * (`setDb(makeDb())`) still reached the real `writeManagedSkill()` through the
 * proposal appliers and overwrote live SKILL.md files, using real skill names
 * because the fixtures were lifted from live evidence.
 *
 * Call this once at the top of any test file whose code path can resolve the
 * managed-skills root, BEFORE any other `beforeEach` that needs the redirect —
 * vitest runs hooks in registration order:
 *
 *   const managedRoot = useTempManagedSkillsRoot();
 *   beforeEach(() => { setDb(makeDb()); registerAllProposalAppliers(); });
 *
 * `managedSkillsRoot()` throws under vitest when it resolves to the real path,
 * so a missing call fails loudly instead of eating a user's skill.
 */
import { afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Point `RHYTHM_MANAGED_SKILLS_DIR` at a fresh temp dir for each test in the
 * calling file, restoring the previous value and removing the dir afterwards.
 * Returns an accessor for the current test's temp root (the path changes every
 * test, so read it inside the test body, not at module scope).
 */
export function useTempManagedSkillsRoot(label = 'rhythm-skills'): () => string {
  let dir = '';
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `${label}-`));
    saved = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    process.env.RHYTHM_MANAGED_SKILLS_DIR = dir;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = saved;
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  return () => dir;
}
