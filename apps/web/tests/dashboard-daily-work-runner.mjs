import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const mode = process.env.DASHBOARD_CHECK;
if (mode && !['artifacts', 'fixture', 'live'].includes(mode)) throw new Error('Unsupported Dashboard check');
const port = mode === 'artifacts' ? 4178 : 4286;
const liveBase = (name) => {
  const url = new URL(process.env[name] ?? '');
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || port < 1024 || port > 65535 || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error(`${name} must be http://127.0.0.1:<unprivileged-port>`);
  return url.origin;
};
const live = mode === 'live' ? {
  api: liveBase('RHYTHM_LIVE_API_URL'),
  engine: liveBase('RHYTHM_LIVE_ENGINE_URL'),
  gateway: liveBase('RHYTHM_LIVE_GATEWAY_URL'),
} : null;
const api = mode === 'artifacts' ? 'http://127.0.0.1:4098' : live?.api ?? 'http://127.0.0.1:4287';
const engine = mode === 'artifacts' ? 'http://127.0.0.1:4097' : live?.engine ?? 'http://127.0.0.1:4288';
const production = mode === 'artifacts' ? 'https://api.vcrcapps.com' : 'https://design-fixture.invalid';
const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
await new Promise(resolve => probe.close(resolve));
const renderer = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  stdio: 'inherit', env: { ...process.env, VITE_RHYTHM_GATEWAY_MODE: mode === 'fixture' ? 'fixture' : 'live', VITE_RHYTHM_API_BASE: api, VITE_RHYTHM_ENGINE_BASE: engine, VITE_RHYTHM_EXPECTED_API_BASE: api, VITE_RHYTHM_EXPECTED_ENGINE_BASE: engine, VITE_RHYTHM_PRODUCTION_API_BASE: production },
});
let tests;
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
}
try {
  console.log(`Captured renderer PID ${renderer.pid}, strict port ${port}`);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (renderer.exitCode !== null) throw new Error('Owned renderer exited before readiness');
    try { ready = (await fetch(`http://127.0.0.1:${port}`)).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Owned renderer readiness timeout');
  tests = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/dashboard-daily-work-playwright.config.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ...(live ? { RHYTHM_LIVE_API_URL: live.api, RHYTHM_LIVE_ENGINE_URL: live.engine, RHYTHM_LIVE_GATEWAY_URL: live.gateway } : {}), DASHBOARD_OWNED_RENDERER: '1' } });
  process.exitCode = (await once(tests, 'exit'))[0] ?? 1;
} finally {
  await stop(tests);
  await stop(renderer);
  const closed = net.createServer();
  await new Promise((resolve, reject) => { closed.once('error', reject); closed.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => closed.close(resolve));
  console.log(`Renderer cleanup verified: captured child exited and port ${port} free`);
}
