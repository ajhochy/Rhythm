import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readQualificationFixture } from './qualification_fixture.mjs';
import { captureOwnedRoot, checkoutRoot } from './web_paid_custody.mjs';
const file = fileURLToPath(import.meta.url);
const fail = () => { throw new Error('Paid synthetic source database rejected'); };

/** Web initialization precedes qualification bootstrap. Seed only its public owner here. */
export function preparePaidSourceDatabase({ manifestPath, sourceRevision, sourceRoot }) {
  try {
    const { manifest } = readQualificationFixture(manifestPath, sourceRevision);
    captureOwnedRoot(sourceRoot);
    if (sourceRoot === manifest.fixtureRoot || existsSync(manifest.dbPath)) fail();
    const dbPath = join(sourceRoot, 'rhythm.db');
    // Exclusive creation also rejects an existing or dangling symlink destination.
    writeFileSync(dbPath, '', { flag: 'wx', mode: 0o600 });
    for (const name of ['home', 'tmp']) mkdirSync(join(sourceRoot, name), { mode: 0o700 });
    execFileSync(process.execPath, [file, 'seed', manifestPath, sourceRevision, sourceRoot], {
      cwd: sourceRoot, stdio: 'ignore', timeout: 30_000,
      env: { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: join(sourceRoot, 'home'),
        TMPDIR: join(sourceRoot, 'tmp'), DB_CLIENT: 'sqlite', DB_PATH: dbPath, RHYTHM_OPTIMIZER_MODE: 'shadow',
        XDG_CONFIG_HOME: join(sourceRoot, 'home/.config'), XDG_DATA_HOME: join(sourceRoot, 'home/.local/share'),
        XDG_CACHE_HOME: join(sourceRoot, 'home/.cache'), AUTO_PROMOTION_FEATURE_AVAILABLE: 'false' },
    });
    readQualificationFixture(manifestPath, sourceRevision);
    return { dbPath, ownerUserId: manifest.ownerUserId };
  } catch { fail(); }
}

async function seed(manifestPath, sourceRevision, sourceRoot) {
  const { manifest } = readQualificationFixture(manifestPath, sourceRevision);
  captureOwnedRoot(sourceRoot);
  const dbPath = join(sourceRoot, 'rhythm.db'), st = lstatSync(dbPath);
  if (sourceRoot === manifest.fixtureRoot || existsSync(manifest.dbPath) || process.env.DB_PATH !== dbPath
    || process.env.HOME !== join(sourceRoot, 'home') || process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST
    || !st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || st.nlink !== 1 || st.size !== 0
    || (st.mode & 0o777) !== 0o600) fail();
  const requireApi = createRequire(join(checkoutRoot, 'apps/api_server/package.json'));
  const { initDb, getDb } = requireApi('./dist/database/db.js');
  await initDb();
  const db = getDb(), user = manifest.publicUserSeed;
  try {
    if (db.prepare('SELECT COUNT(*) count FROM users').get().count !== 0
      || db.prepare('SELECT COUNT(*) count FROM sessions').get().count !== 0
      || db.prepare('SELECT COUNT(*) count FROM agent_sessions').get().count !== 0) fail();
    db.prepare('INSERT INTO users(id,name,email,google_sub,timezone) VALUES(?,?,?,?,?)')
      .run(user.id, user.name, user.email, user.googleSub, user.timezone);
    db.pragma('wal_checkpoint(TRUNCATE)'); db.pragma('journal_mode = DELETE');
  } finally { db.close(); }
  chmodSync(dbPath, 0o600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, manifestPath, sourceRevision, sourceRoot, extra] = process.argv.slice(2);
  if (mode !== 'seed' || !sourceRoot || extra) process.exitCode = 1;
  else seed(manifestPath, sourceRevision, sourceRoot).catch(() => { process.exitCode = 1; });
}
