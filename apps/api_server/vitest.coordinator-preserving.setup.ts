import fs from 'node:fs';
import { inject } from 'vitest';

const root = process.env.RHYTHM_TEST_FIXTURE_ROOT;
if (process.env.NODE_ENV !== 'test' || process.env.RHYTHM_TEST_PRESERVE_FIXTURES !== '1' ||
    process.env.RHYTHM_LIVE_E2E === '1' || !root || fs.realpathSync(root) !== root ||
    !inject('rhythmTestRunRoot').startsWith(root + '/')) throw Error('preserving per-file isolation missing');
process.env.TMPDIR = root;
// Keep the original forced DB/vault/accounts/role/scheduler isolation BEFORE tests.
// Its setup creates per-file roots but has no deleting teardown.
await import('./vitest.setup');
