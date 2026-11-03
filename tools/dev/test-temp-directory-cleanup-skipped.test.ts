import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';

const owned = path.dirname(process.env.DB_PATH!);
assert.ok(fs.existsSync(owned));
console.log(`TEMP_CLEANUP_OWNED=${JSON.stringify(owned)}`);
test.skip('all-skipped files still allocate an isolated setup child', () => {});
