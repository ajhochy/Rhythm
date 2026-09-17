/**
 * Child-process half of the bounded-heap skill usage regression.
 * The parent test launches this file with a 128 MiB V8 heap against a wholly
 * synthetic SQLite fixture. Keep this process minimal so its exit status
 * measures countSkillToolUses rather than Vitest worker overhead.
 */
import Database from 'better-sqlite3';

import { setDb } from '../../database/db';
import { countSkillToolUses } from '../../services/skill_usage_tracker';

const dbPath = process.argv[2];
if (!dbPath) throw new Error('database path argument is required');

const db = new Database(dbPath, { readonly: true });
void (async () => {
  try {
    setDb(db);
    process.stdout.write(JSON.stringify(Object.fromEntries(await countSkillToolUses())));
  } finally {
    setDb(null);
    db.close();
  }
})();
