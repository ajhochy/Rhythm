import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHermesBackendArtifact } from '../../apps/electron/src/hermes-backend-artifact.mjs';

const script = fileURLToPath(new URL('./qualification_hermes_history.py', import.meta.url));

/** Seed through the exact staged or bundled Python with no inherited account or provider environment. */
export function seedQualificationHermesHistory(fixtureRoot, runtime, { bundled = false } = {}) {
  const unavailable = () => new Error('Qualification Hermes history unavailable');
  try {
    if (typeof fixtureRoot !== 'string' || !fixtureRoot.startsWith('/private/tmp/') || resolve(fixtureRoot) !== fixtureRoot) throw unavailable();
    const backend = bundled ? resolveHermesBackendArtifact(runtime.root) : null;
    if (bundled ? runtime?.root !== backend.root
      : runtime?.backendExecutablePath !== join(runtime.runtimeRoot, '.venv', 'bin', 'hermes')) throw unavailable();
    const fixture = lstatSync(fixtureRoot);
    if (realpathSync(fixtureRoot) !== fixtureRoot || !fixture.isDirectory() || fixture.uid !== process.getuid()
      || (fixture.mode & 0o777) !== 0o700) throw unavailable();
    const hermesHome = join(fixtureRoot, 'hermes-home');
    mkdirSync(hermesHome, { mode: 0o700 });
    const home = join(fixtureRoot, 'home');
    for (const directory of [home, hermesHome]) {
      const stat = lstatSync(directory);
      if (realpathSync(directory) !== directory || !stat.isDirectory() || stat.uid !== process.getuid()
        || (stat.mode & 0o777) !== 0o700) throw unavailable();
    }
    const nonce = randomUUID();
    const python = bundled ? join(backend.root, 'python', 'bin', 'python3') : join(runtime.runtimeRoot, '.venv', 'bin', 'python');
    if (realpathSync(python) !== (bundled ? join(backend.root, 'python', 'bin', 'python3.12') : runtime.pythonExecutablePath)) throw unavailable();
    execFileSync(python, ['-B', script, `smoke-${nonce}`, `[smoke] Private Hermes history ${nonce.slice(0, 8)}`], {
      cwd: hermesHome, timeout: 20_000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { HOME: home, HERMES_HOME: hermesHome, XDG_CACHE_HOME: join(fixtureRoot, 'xdg-cache'),
        ...(bundled ? { PYTHONHOME: join(backend.root, 'python'),
          PYTHONPATH: `${join(backend.root, 'source')}:${join(backend.root, 'site-packages')}` } : {}),
        PYTHONDONTWRITEBYTECODE: '1', HERMES_DISABLE_LAZY_INSTALLS: '1', LANG: 'C.UTF-8', PATH: '/usr/bin:/bin' },
    });
  } catch { throw unavailable(); }
}
