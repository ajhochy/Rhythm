// Re-enter direct Node build commands in the shared process supervisor.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function ensureBuildGuard({ repoRoot, watch = [] }) {
  // The storage budget protects local dev disks only; CI runners build without it.
  if (process.env.GITHUB_ACTIONS === 'true') return;
  const python = process.env.RHYTHM_BUILD_PYTHON || 'python3';
  const guard = fileURLToPath(new URL('./guard.py', import.meta.url));
  const args = [guard, '--repo', repoRoot, ...watch.flatMap(path => ['--watch', path])];
  const probe = spawn(python, [...args, '--check-active'], { stdio: 'ignore' });
  const active = await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.once('exit', code => resolve(code === 0));
  });
  if (active) return;
  const child = spawn(python, [...args, '--', process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit', env: process.env,
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal));
  }
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve(status ?? ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal] || 1)));
  });
  process.exit(code);
}
