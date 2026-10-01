// Attach-only slice of packaged-interactive-smoke. No spawn, signing, auth enrollment,
// API client, sandbox lifecycle, or approval decision is permitted here. The
// separately gated native-trigger mode permits only the reviewed synthetic job.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File, verifyZipHash } from './colony-installed/run.mjs';

export const CASES = Object.freeze([
  'installed-identity', 'frame-attribution', 'approval-reload-get',
  'approval-global-null-session', 'approval-global-bound-session',
  'approval-focus-fetch', 'approval-new-creation-fetch', 'approval-actionable-error',
  'native-trigger-request-response', 'native-backend-version', 'native-pending-terminal',
  'native-error', 'native-dedupe', 'native-reopen', 'human-gesture-nonce-decision',
  'reported-pending-id-metadata',
]);
export const NATIVE_GAP = 'UNVERIFIED: native production synthetic Trigger now click, POST response, durable run, pending/terminal/error/dedupe/reopen, and exact reported-click attribution remain unobserved; renderer CDP does not observe main-process fetch. A bridge read and owned proxy receipt do not substitute for these checks.';
export function surface(url) {
  if (/^rhythm:\/\/app\/index\.html(?:[?#]|$)/.test(url)) return 'outer-rhythm';
  if (/^file:/.test(url) && /\/renderer\/index\.html(?:[?#]|$)/.test(url)) return 'embedded-hermes-candidate';
  return 'unattributed';
}
export function triggerLane(method, path) {
  if (method !== 'POST') return null;
  if (/^\/agent-schedules\/[^/]+\/trigger-now$/.test(path)) return 'rhythm-schedule';
  if (/^\/api\/cron\/jobs\/[^/]+\/trigger$/.test(path)) return 'hermes-native-cron';
  return null; // A source label or job title never identifies AJ's exact click.
}
export function redactedOrigin(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//sha256:${createHash('sha256').update(parsed.origin).digest('hex').slice(0, 16)}`;
}
export function pendingMetadata(rows, ids) {
  assert.ok(Array.isArray(rows), 'UNVERIFIED: approval GET returned non-array, not an empty queue');
  return rows.filter(row => ids.includes(row.id)).map(row => Object.fromEntries(
    ['id', 'status', 'sessionId', 'lane', 'createdAt', 'expiresAt']
      .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]),
  ));
}
export function nativeCronMetadata(value) {
  assert.ok(value && typeof value === 'object', 'owned native cron fixture required');
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  assert.match(value.profile, new RegExp(`^attribution-20261001-${uuid}$`));
  assert.match(value.connectionId, /^native-attribution-20261001-[a-f0-9-]{36}$/, 'dedicated synthetic proxy connection required');
  assert.equal(value.connectionId, value.profile.replace(/^attribution-/, 'native-attribution-'));
  assert.match(value.jobId, /^[a-f0-9]{12}$/);
  assert.equal(value.jobName, value.profile.replace(/^attribution-/, 'rhythm-native-attribution-'));
  assert.match(value.backendBase, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(!['4001', '4096', '4097', '4098'].includes(new URL(value.backendBase).port), 'live or shared sandbox port forbidden');
  assert.ok(Number.isSafeInteger(value.backendPid) && value.backendPid > 1);
  assert.match(value.proxyBase, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(!['4001', '4096', '4097', '4098'].includes(new URL(value.proxyBase).port), 'live or shared proxy port forbidden');
  assert.notEqual(value.proxyBase, value.backendBase);
  assert.ok(Number.isSafeInteger(value.proxyPid) && value.proxyPid > 1 && value.proxyPid !== value.backendPid);
  assert.ok(typeof value.backendVersion === 'string' && value.backendVersion.length > 0);
  assert.ok(typeof value.profileHome === 'string' && isAbsolute(value.profileHome), 'isolated Hermes profile home required');
  assert.ok(typeof value.proxyReceiptLog === 'string' && isAbsolute(value.proxyReceiptLog), 'owned proxy receipt log required');
  return { profile: value.profile, connectionId: value.connectionId, jobId: value.jobId,
    jobName: value.jobName, backendBase: value.backendBase, backendPid: value.backendPid,
    proxyBase: value.proxyBase, proxyPid: value.proxyPid,
    backendVersion: value.backendVersion, profileHome: value.profileHome,
    proxyReceiptLog: value.proxyReceiptLog };
}
export function nativeTriggerReceipts(log, jobId) {
  assert.match(jobId, /^[a-f0-9]{12}$/);
  return log.split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(row => row.method === 'POST' && row.route === 'synthetic-trigger' && row.jobId === jobId)
    .map(row => ({ status: row.upstreamStatus }));
}
export function receipt() {
  return { status: 'BLOCKED', installedQualified: false, cases: CASES.map(id => ({ id, status: 'not-run' })),
    reportedPendingIds: { status: 'pending', queried: false }, requests: [], frames: [], blockers: [] };
}
function under(root, path) {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function external(path) {
  assert.ok(isAbsolute(path), 'absolute owned path required');
  const actual = await realpath(path);
  assert.ok(actual.startsWith('/private/tmp/') || actual.startsWith('/var/folders/'), 'owned external temp path required');
  assert.ok(!actual.includes('.app/'), 'never use signed Resources for diagnostics');
  return actual;
}
async function logTail(path, maxBytes = 131_072) {
  const size = (await stat(path)).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const handle = await open(path, 'r');
  try {
    await handle.read(buffer, 0, length, size - length);
  } finally {
    await handle.close();
  }
  return buffer.toString('utf8');
}
async function logSince(path, offset, maxBytes = 1_048_576) {
  const size = (await stat(path)).size;
  assert.ok(size >= offset, 'owned proxy receipt log rotated during native proof');
  const length = size - offset;
  assert.ok(length <= maxBytes, 'owned proxy receipt log grew beyond bounded proof window');
  const buffer = Buffer.alloc(length);
  const handle = await open(path, 'r');
  try {
    await handle.read(buffer, 0, length, offset);
  } finally {
    await handle.close();
  }
  return buffer.toString('utf8');
}
async function nativeRuns(page, native) {
  return page.evaluate(async ({ connectionId, profile, jobId }) => {
    const response = await window.hermesDesktop.api({ connectionId, profile,
      path: `/api/cron/jobs/${jobId}/runs?limit=20`, method: 'GET' });
    if (!Array.isArray(response?.runs)) throw new Error('native cron run ledger unavailable');
    return response.runs.map(run => ({ id: run.id, ended_at: run.ended_at, source: run.source }));
  }, { connectionId: native.connectionId, profile: native.profile, jobId: native.jobId });
}
async function triggerNativeCron(fixture, paths, page, out) {
  assert.equal(process.env.RHYTHM_INSTALLED_ATTRIBUTION_TRIGGER, 'owned-synthetic-only', 'native click requires explicit synthetic-only gate');
  const native = nativeCronMetadata(fixture.nativeCron);
  const home = await external(native.profileHome);
  assert.ok(!under(paths.app, home) && !under(paths.profile, home), 'Hermes profile must be distinct from installed app and Electron user data');
  const script = await realpath(resolve(home, 'scripts/native-cron-silent.sh'));
  assert.ok(under(resolve(home, 'scripts'), script), 'synthetic cron script escapes isolated profile');
  assert.equal(await sha256File(script), await sha256File(resolve(import.meta.dirname, 'fixtures/native-cron-silent.sh')),
    'synthetic cron script differs from reviewed harmless fixture');
  const before = await nativeRuns(page, native);
  assert.deepEqual(before, [], 'unique synthetic job must have no previous runs');
  const offset = (await stat(native.proxyReceiptLog)).size;
  const row = page.locator(`[data-panel-row="${native.jobId}"]`);
  await row.getByRole('button', { name: native.jobName, exact: true }).click({ timeout: 10_000 });
  const heading = page.getByRole('heading', { name: native.jobName, exact: true, level: 3 });
  await heading.waitFor({ state: 'visible', timeout: 10_000 });
  const button = heading.locator('xpath=../..').getByRole('button', { name: 'Trigger now', exact: true });
  assert.equal(await button.isEnabled(), true, 'selected synthetic job trigger unavailable');
  for (const id of ['native-trigger-request-response', 'native-pending-terminal', 'native-dedupe', 'native-reopen']) {
    out.cases.find(c => c.id === id).status = 'fail';
  }
  await button.click({ timeout: 10_000 });
  let disabled = false;
  for (let attempt = 0; attempt < 20 && !disabled; attempt++) {
    disabled = await button.isDisabled();
    if (!disabled) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(disabled, true, 'synthetic Trigger now did not enter pending/disabled state');
  await assert.rejects(button.click({ timeout: 500 }), /Timeout/, 'pending trigger accepted a duplicate user click');
  out.cases.find(c => c.id === 'native-dedupe').status = 'pass';
  let posts = [];
  for (let attempt = 0; attempt < 300; attempt++) {
    posts = nativeTriggerReceipts(await logSince(native.proxyReceiptLog, offset), native.jobId);
    if (posts.length > 0 && posts[0].status !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(posts, [{ status: 200 }], 'expected exactly one successful native Hermes POST through owned proxy');
  out.nativeCron.trigger = { method: 'POST', path: `/api/cron/jobs/${native.jobId}/trigger`,
    status: 200, count: 1, frameRole: 'embedded-hermes-candidate' };
  out.cases.find(c => c.id === 'native-trigger-request-response').status = 'pass';
  let run;
  for (let attempt = 0; attempt < 200; attempt++) {
    const rows = await nativeRuns(page, native);
    run = rows.find(row => row.id.startsWith(`cron_${native.jobId}_`) && row.ended_at !== null);
    if (run) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(run && Number.isFinite(run.ended_at), 'native trigger did not produce a terminal durable cron run');
  assert.deepEqual(nativeTriggerReceipts(await logSince(native.proxyReceiptLog, offset), native.jobId),
    [{ status: 200 }], 'duplicate native POST observed after durable run');
  await page.getByText('Run history · 1', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  out.nativeCron.trigger.run = { id: run.id, endedAt: run.ended_at };
  out.cases.find(c => c.id === 'native-pending-terminal').status = 'pass';
  await page.getByRole('button', { name: 'Close cron', exact: true }).click({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Cron', exact: true }).click({ timeout: 10_000 });
  const reopened = page.locator(`[data-panel-row="${native.jobId}"]`);
  await reopened.getByRole('button', { name: native.jobName, exact: true }).click({ timeout: 10_000 });
  await page.getByRole('heading', { name: native.jobName, exact: true, level: 3 }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('Run history · 1', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  out.cases.find(c => c.id === 'native-reopen').status = 'pass';
}
async function observeNativeCron(fixture, paths, pages, out, trigger) {
  const native = nativeCronMetadata(fixture.nativeCron);
  const proxyLog = await external(native.proxyReceiptLog);
  assert.ok(!under(paths.app, proxyLog) && !under(paths.profile, proxyLog), 'proxy receipt log must be external to installed app and profile');
  assert.ok(under(paths.artifacts, proxyLog), 'proxy receipt log must belong to owned artifacts directory');
  execFileSync('/usr/sbin/lsof', ['-a', '-p', String(native.backendPid),
    `-iTCP:${new URL(native.backendBase).port}`, '-sTCP:LISTEN'], { stdio: 'pipe' });
  execFileSync('/usr/sbin/lsof', ['-a', '-p', String(native.proxyPid),
    `-iTCP:${new URL(native.proxyBase).port}`, '-sTCP:LISTEN'], { stdio: 'pipe' });
  const embedded = pages.filter(page => surface(page.url()) === 'embedded-hermes-candidate');
  assert.equal(embedded.length, 1, 'exactly one installed embedded Hermes renderer required');
  const active = await embedded[0].evaluate(() => window.hermesDesktop.profile.get());
  assert.equal(active?.profile, native.profile, 'installed Hermes active profile differs from owned synthetic profile');
  const route = await embedded[0].evaluate(({ connectionId, profile }) =>
    window.hermesDesktop.getConnectionFor({ connectionId, profile }), native);
  assert.equal(route?.baseUrl, native.proxyBase, 'native registry connection does not point to owned proxy');
  assert.equal(route?.connectionId, native.connectionId);
  const marker = randomUUID();
  const healthPath = `/api/health?rhythm_attribution=${marker}`;
  out.cases.find(c => c.id === 'native-backend-version').status = 'fail';
  // The installed preload invokes production hermes:api. Only metadata leaves the renderer.
  const result = await embedded[0].evaluate(async ({ connectionId, profile, healthPath }) => {
    if (typeof window.hermesDesktop?.api !== 'function') throw new Error('native Hermes bridge unavailable');
    const health = await window.hermesDesktop.api({ connectionId, profile, path: healthPath, method: 'GET' });
    const jobs = await window.hermesDesktop.api({ connectionId, profile,
      path: `/api/cron/jobs?profile=${encodeURIComponent(profile)}`, method: 'GET' });
    return { health: { ok: health?.ok, version: health?.version },
      jobs: Array.isArray(jobs) ? jobs.map(job => ({ id: job.id, name: job.name, no_agent: job.no_agent,
        deliver: job.deliver, script: job.script })) : null };
  }, { connectionId: native.connectionId, profile: native.profile, healthPath });
  assert.equal(result.health.ok, true);
  assert.equal(result.health.version, native.backendVersion, 'running backend version differs from pinned fixture');
  assert.ok(Array.isArray(result.jobs), 'native bridge cron inventory was not an array');
  assert.deepEqual(result.jobs.filter(job => job.id === native.jobId),
    [{ id: native.jobId, name: native.jobName, no_agent: true, deliver: 'local', script: 'native-cron-silent.sh' }],
    'owned local script-only job not present in native inventory');
  let seen = false;
  for (let attempt = 0; attempt < 30 && !seen; attempt++) {
    const tail = await logTail(proxyLog);
    seen = tail.split('\n').filter(Boolean).some(line => {
      try {
        const row = JSON.parse(line);
        return row.method === 'GET' && row.route === 'health' && row.marker === marker && row.upstreamStatus === 200;
      } catch { return false; }
    });
    if (!seen) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(seen, 'UNVERIFIED: owned proxy receipt lacks the unique native bridge GET');
  out.nativeCron = { profile: native.profile, connectionId: native.connectionId,
    jobId: native.jobId, jobName: native.jobName, backendVersion: result.health.version,
    proxyOrigin: redactedOrigin(native.proxyBase), upstreamOrigin: redactedOrigin(native.backendBase),
    bridgeHealthMarker: marker, proxyCorroborated: true, trigger: 'not-run' };
  out.cases.find(c => c.id === 'native-backend-version').status = 'pass';
  if (trigger) await triggerNativeCron(fixture, paths, embedded[0], out);
}
async function preflight(fixture, out) {
  assert.equal(fixture.kind, 'synthetic-installed-attribution-v1');
  assert.equal(fixture.managerReady, true, 'manager must explicitly release runtime after A');
  assert.match(fixture.hermesPin, /^[a-f0-9]{40}$/);
  out.cases.find(c => c.id === 'installed-identity').status = 'fail';
  const app = await realpath(fixture.appPath);
  assert.ok(app.endsWith('.app'));
  assert.notEqual(app, '/Users/ajhochhalter/Applications/Rhythm Mega Consolidation.app', 'known invalid seal: do not qualify or repair');
  const artifacts = await external(fixture.artifactsDir);
  const profile = await external(fixture.userData);
  assert.notEqual(artifacts, profile);
  assert.ok(!under(app, artifacts) && !under(app, profile));
  out.identity = { app, archiveSha256: await verifyZipHash(fixture), files: [] };
  for (const [path, expected] of Object.entries(fixture.fileSha256 ?? {})) {
    assert.match(expected, /^[a-f0-9]{64}$/);
    const actual = await realpath(resolve(app, 'Contents/Resources', path));
    assert.ok(under(resolve(app, 'Contents/Resources'), actual), 'identity file escapes Resources');
    assert.equal(await sha256File(actual), expected, `installed bytes differ: ${path}`);
    out.identity.files.push({ path, sha256: expected });
  }
  for (const required of ['app/src/main.mjs', 'hermes-desktop/electron/embedded-host.mjs', 'hermes-desktop/install-stamp.json']) {
    assert.ok(Object.hasOwn(fixture.fileSha256, required), `missing qualification hash ${required}`);
  }
  const stamp = JSON.parse(await readFile(resolve(app, 'Contents/Resources/hermes-desktop/install-stamp.json'), 'utf8'));
  assert.equal(stamp.dirty, false);
  assert.equal(stamp.commit, fixture.hermesPin);
  out.identity.hermesPin = stamp.commit;
  for (const [command, args] of [
    ['/usr/bin/codesign', ['--verify', '--deep', '--strict', app]],
    ['/usr/sbin/spctl', ['--assess', '--type', 'execute', app]],
    ['/usr/bin/xcrun', ['stapler', 'validate', app]],
  ]) execFileSync(command, args, { cwd: artifacts, stdio: 'pipe', timeout: 60_000 });
  out.cases.find(c => c.id === 'installed-identity').status = 'pass';
  return { app, artifacts, profile };
}
async function observe(fixture, paths, out, trigger = false) {
  assert.equal(process.env.RHYTHM_INSTALLED_ATTRIBUTION_RUNTIME, 'manager-ready', 'no runtime without explicit readiness');
  assert.equal(fixture.syntheticOnly, true, 'no live human profile or user rows');
  for (const [base, pid] of [[fixture.apiBase, fixture.apiPid], [fixture.engineBase, fixture.enginePid]]) {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(!['4001', '4096'].includes(new URL(base).port));
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), `-iTCP:${new URL(base).port}`, '-sTCP:LISTEN'], { stdio: 'pipe' });
  }
  assert.notEqual(fixture.apiBase, fixture.engineBase);
  assert.match(fixture.cdpEndpoint, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+$/);
  assert.ok(Number.isSafeInteger(fixture.appPid) && fixture.appPid > 1);
  const executable = execFileSync('/bin/ps', ['-p', String(fixture.appPid), '-o', 'comm='], { encoding: 'utf8' }).trim();
  assert.equal(executable, resolve(paths.app, 'Contents/MacOS/Rhythm'), 'CDP must belong to the installed candidate');
  const args = execFileSync('/bin/ps', ['-p', String(fixture.appPid), '-o', 'args='], { encoding: 'utf8' });
  assert.ok(args.includes('--interactive-smoke') && args.includes('--allow-test-runtime-ports'), 'normal owning launch forbidden');
  const [port, endpointPath] = (await readFile(resolve(paths.profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  assert.equal(fixture.cdpEndpoint, `ws://127.0.0.1:${port}${endpointPath}`, 'CDP endpoint must match owned profile');
  execFileSync('/usr/sbin/lsof', ['-a', '-p', String(fixture.appPid), `-iTCP:${port}`, '-sTCP:LISTEN'], { stdio: 'pipe' });
  // Own worktree dependencies only; do not import a main-checkout dependency symlink.
  const deps = resolve(import.meta.dirname, '../../web/node_modules');
  assert.equal((await lstat(deps)).isSymbolicLink(), false);
  const playwright = await realpath(resolve(deps, 'playwright/index.mjs'));
  assert.ok(under(deps, playwright));
  const { chromium } = await import(playwright);
  const browser = await chromium.connectOverCDP(fixture.cdpEndpoint);
  try {
    out.cases.find(c => c.id === 'frame-attribution').status = 'fail';
    const pages = browser.contexts().flatMap(context => context.pages());
    for (const page of pages) {
      const cdp = await page.context().newCDPSession(page);
      const { targetInfo } = await cdp.send('Target.getTargetInfo');
      const { frameTree } = await cdp.send('Page.getFrameTree');
      out.frames.push({ role: surface(page.url()), url: page.url(), cdpTargetId: targetInfo.targetId,
        cdpFrameId: frameTree.frame.id, webContentsId: null }); // CDP IDs are NOT WebContents IDs.
      const scripts = [];
      cdp.on('Debugger.scriptParsed', script => scripts.push(script));
      await cdp.send('Debugger.enable');
      out.frames.at(-1).loadedRendererAssets = [];
      for (const asset of fixture.rendererAssets ?? []) {
        const script = scripts.find(item => item.url === asset.url);
        if (!script) continue;
        assert.equal(fixture.fileSha256[asset.resourcePath], asset.sha256, 'renderer asset must be in installed identity manifest');
        const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId });
        const hash = createHash('sha256').update(scriptSource).digest('hex');
        assert.equal(hash, asset.sha256, 'running renderer bytes differ from installed manifest');
        out.frames.at(-1).loadedRendererAssets.push({ url: asset.url, sha256: hash });
      }
      if (surface(page.url()) === 'embedded-hermes-candidate') {
        const renderer = await realpath(fileURLToPath(new URL(page.url())));
        assert.ok(under(resolve(paths.app, 'Contents/Resources/hermes-desktop'), renderer), 'not the installed factory renderer');
        out.frames.at(-1).artifactSource = 'factory';
        out.frames.at(-1).rendererSha256 = await sha256File(renderer);
      }
      await cdp.detach();
    }
    const outer = pages.filter(page => surface(page.url()) === 'outer-rhythm');
    assert.equal(outer.length, 1, 'exactly one owned outer shell required');
    for (const role of ['outer-rhythm', 'embedded-hermes-candidate']) {
      assert.ok(out.frames.some(frame => frame.role === role && frame.loadedRendererAssets.length > 0), `UNVERIFIED: missing running ${role} renderer hash`);
    }
    out.cases.find(c => c.id === 'frame-attribution').status = 'pass';
    const page = outer[0];
    const gateway = await page.evaluate(() => ({ api: window.rhythmShell?.gateway?.apiBase, engine: window.rhythmShell?.gateway?.engineBase }));
    assert.equal(gateway.api, fixture.apiBase);
    assert.equal(gateway.engine, fixture.engineBase);
    assert.match(gateway.api, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(!['4001', '4096'].includes(new URL(gateway.api).port));
    assert.ok(!['4001', '4096'].includes(new URL(gateway.engine).port));
    // Only the existing UI's authenticated human GET. No capability invocation or bearer extraction.
    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (url.origin === fixture.apiBase && url.pathname === '/agent-approvals' && request.method() === 'GET') {
        out.requests.push({ phase: 'reload', frameRole: 'outer-rhythm', method: 'GET', path: '/agent-approvals',
          origin: redactedOrigin(url.href), status: null, category: 'transport-failure' });
      }
    });
    const pending = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === fixture.apiBase && url.pathname === '/agent-approvals' && response.request().method() === 'GET';
    }, { timeout: 15_000 });
    out.cases.find(c => c.id === 'approval-reload-get').status = 'fail';
    await page.reload();
    const response = await pending;
    const headers = await response.request().allHeaders();
    const request = { phase: 'reload', frameRole: 'outer-rhythm', method: 'GET', path: '/agent-approvals',
      origin: redactedOrigin(response.url()), status: response.status(),
      humanAuthPresent: Boolean(headers.authorization && headers['x-rhythm-human-approval']),
      category: response.status() === 403 ? 'human-auth-forbidden' : response.status() === 503 ? 'human-auth-unconfigured' : response.ok() ? 'success' : 'http-error' };
    out.requests.push(request);
    assert.ok(request.humanAuthPresent, 'UNVERIFIED: native human-read authentication unavailable');
    assert.ok(response.ok(), `UNVERIFIED: actual reload GET failed (${request.category}/${request.status}); receipt retained`);
    const body = await response.json();
    if (!Array.isArray(body)) request.category = 'non-array-response';
    request.syntheticMetadata = pendingMetadata(body, fixture.syntheticApprovalIds ?? []);
    // A successful one-shot GET does not prove focus/new-creation refresh or card visibility.
    out.cases.find(c => c.id === 'approval-reload-get').status = 'pass';
    if (fixture.nativeCron) await observeNativeCron(fixture, paths, pages, out, trigger);
  } finally {
    await browser.close(); // disconnect CDP only; never stop manager's app/runtime
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, fixturePath] = process.argv.slice(2);
  const out = receipt();
  let artifacts;
  try {
    assert.ok(['preflight', 'observe', 'native-trigger', 'qualify'].includes(mode), 'Usage: node installed-attribution.mjs preflight|observe|native-trigger|qualify <owned-fixture.json>');
    await external(fixturePath);
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    artifacts = await external(fixture.artifactsDir);
    const paths = await preflight(fixture, out);
    if (mode === 'observe' || mode === 'native-trigger') {
      assert.ok(mode !== 'native-trigger' || fixture.nativeCron, 'native-trigger requires owned nativeCron fixture');
      await observe(fixture, paths, out, mode === 'native-trigger');
    }
    // Deliberate red gate: a partial diagnostic receipt is never packaged acceptance.
    assert.fail(NATIVE_GAP);
  } catch (error) {
    out.blockers.push(error.message);
    process.exitCode = 1;
  } finally {
    if (artifacts) await writeFile(resolve(artifacts, `installed-attribution-${Date.now()}.json`), `${JSON.stringify(out, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(out, null, 2));
  }
}
