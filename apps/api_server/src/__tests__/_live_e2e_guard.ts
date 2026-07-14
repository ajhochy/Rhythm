/**
 * #1001 — live-E2E isolation guard.
 *
 * The live-E2E suite drives the RUNNING api_server over HTTP/WS and creates
 * throwaway agent profiles/skills through the API. Its BASE defaults to the
 * real app instance (:4001/:4000), so running the gate without isolation left
 * "test agent" profiles behind in the real DB + ~/.config/opencode (the #1001
 * leak). This guard makes the suite REFUSE to run unless the operator has
 * explicitly stood up an isolated backend:
 *
 *   1. DB_PATH must be set to a non-real path (a temp copy), AND
 *   2. RHYTHM_LIVE_E2E_ISOLATED=1 must be set — the operator's explicit
 *      acknowledgement that DB_PATH + RHYTHM_MANAGED_SKILLS_DIR + an
 *      agents-dir backup/restore are all pointed at a throwaway backend, not
 *      the real ~/.config/opencode.
 *
 * A careless `RHYTHM_LIVE_E2E=1 npx vitest …` against the real server now
 * fails loudly at setup instead of silently mutating live config.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function realDbPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Rhythm', 'rhythm.db');
}

export function assertLiveE2EIsolation(): void {
  const dbPath = process.env.DB_PATH ?? '';
  const isolated = process.env.RHYTHM_LIVE_E2E_ISOLATED === '1';

  const problems: string[] = [];
  if (!isolated) {
    problems.push('RHYTHM_LIVE_E2E_ISOLATED=1 is not set');
  }
  if (!dbPath) {
    problems.push('DB_PATH is unset (would resolve to the default real DB)');
  } else if (resolve(dbPath) === resolve(realDbPath())) {
    problems.push(`DB_PATH points at the REAL DB (${dbPath})`);
  }

  if (problems.length > 0) {
    throw new Error(
      '[live-E2E isolation guard] refusing to run against a non-isolated backend — ' +
        problems.join('; ') +
        '. Stand up an isolated server (temp DB_PATH + RHYTHM_MANAGED_SKILLS_DIR copy + ' +
        'agents-dir backup/restore), point RHYTHM_LIVE_URL at it, and set ' +
        'RHYTHM_LIVE_E2E_ISOLATED=1 before running the live-E2E gate. See #1001.',
    );
  }
}
