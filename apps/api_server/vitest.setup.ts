/**
 * C6 item 5 — inherited-environment full-suite contamination fix.
 *
 * A developer shell configured for the Flutter app's embedded local server
 * commonly exports real ambient values: `AGENT_LOCAL=true`, `DB_PATH`
 * pointing at the real `~/Library/Application Support/Rhythm/rhythm.db`,
 * `MEMORY_VAULT_PATH` pointing at the real Obsidian vault,
 * `MEMORY_VAULT_SUBDIR=` (empty), and `PORT=4001`. Any test file that does
 * not explicitly override these before importing `config/env` silently
 * inherits them instead of a safe default — confirmed to break
 * `issue_1219_memory_provenance`, `memory_index_rebuild`, `memory_injection`,
 * `delegation_caller_identity`, and `issue_1135_audit_lock_contract` when
 * `npm test` runs from such a shell.
 *
 * Registered via `test.setupFiles` in vitest.config.ts, so this runs in
 * every worker BEFORE that worker's test file (and therefore before
 * `config/env.ts`) ever imports. Every assignment below FORCES a value
 * (unconditional `=`, never `??=`) — the point is to override whatever the
 * ambient shell already exported, not merely fill an unset gap. Individual
 * tests remain free to override/restore further and `vi.resetModules()` to
 * re-import `config/env` under their own values (existing convention, e.g.
 * c6_feature_flags.test.ts) — this only fixes the shared starting point.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.RHYTHM_LIVE_E2E !== '1') {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-vitest-'));

  process.env.DB_PATH = path.join(runRoot, 'rhythm.db');
  process.env.MEMORY_VAULT_PATH = path.join(runRoot, 'memory-vault');
  process.env.MEMORY_VAULT_SUBDIR = 'memory';
  process.env.AGENT_LOCAL = 'false';
  process.env.PORT = '0';
  process.env.RHYTHM_TREATMENT_V2_ENABLED = 'false';
  process.env.RHYTHM_CALIBRATION_ENABLED = 'false';
}
