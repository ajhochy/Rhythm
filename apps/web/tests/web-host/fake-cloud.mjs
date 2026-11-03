// Synthetic-only loopback upstream. UI/proxy fixture evidence, never real-account proof.
// Task/public artifact envelopes follow models/task.ts, models/live_artifact.ts and their
// controllers. This in-memory store intentionally does not claim production DB behavior.
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
const port = 7097;
const bearer = 'web-cloud-synthetic-bearer-only';
const recorded = [];
let disconnected = false;
const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const user = { id: 99, name: 'Synthetic Admin', email: 'admin@example.invalid',
  googleSub: 'web-cloud-synthetic-owner', role: 'admin', artifactTabIds: [] };
const workspace = { id: 9099, name: 'Synthetic cloud workspace' };
const task = (id, title, input = {}) => ({ id, title, notes: input.notes ?? null,
  dueDate: input.dueDate ?? null, scheduledDate: input.scheduledDate ?? null,
  scheduledOrder: null, locked: false, status: input.status ?? 'open', sourceType: null,
  sourceId: null, sourceName: null, ownerId: user.id, goalId: null, priority: input.priority ?? null,
  tags: input.tags ?? [], energy: input.energy ?? null, workspaceId: null, isShared: false,
  collaborators: [], preferredAgent: null, createdAt: now(), updatedAt: now() });
const tasks = new Map([['synthetic-cloud-task', { ...task('synthetic-cloud-task', 'Synthetic cloud task'),
  notes: '', priority: 0, createdAt: '2026-10-22T12:00:00.000Z' }]]);
const artifacts = new Map();
const json = (res, status, body) => { res.statusCode = status; res.end(status === 204 ? undefined : JSON.stringify(body)); };
const error = (res, status, code, message) => json(res, status, { error: { code, message } });
const bundleValue = input => {
  if (!input || ['html', 'css', 'js'].some(key => typeof input[key] !== 'string')) throw new Error('invalid bundle');
  return { html: input.html, css: input.css, js: input.js };
};
const stateValue = input => {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('invalid state');
  return input;
};
const ownedTitle = title => typeof title === 'string' && title.startsWith('[smoke] ') && title.trim().length > 8;
const snapshot = entry => ({ artifact: entry.artifact,
  bundleRevisions: entry.bundleRevisions, stateRevisions: entry.stateRevisions, contents: entry.contents });
const addContent = (entry, kind, value) => {
  const contentHash = hash(value);
  if (!entry.contents.some(content => content.kind === kind && content.hash === contentHash))
    entry.contents.push({ kind, hash: contentHash, body: JSON.stringify(value) });
  const revisionKey = kind === 'bundle' ? 'currentBundleRevision' : 'currentStateRevision';
  const hashKey = kind === 'bundle' ? 'currentBundleHash' : 'currentStateHash';
  entry.artifact[revisionKey] += 1;
  entry.artifact[hashKey] = contentHash;
  entry[`${kind}Revisions`].push({ revision: entry.artifact[revisionKey], hash: contentHash, actorUserId: user.id });
  entry[kind] = value;
  entry.artifact.updatedAt = now();
};
const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const route = url.pathname;
  if (req.url === '/_cloud/status') return res.end(JSON.stringify({ recorded }));
  if (req.url === '/_cloud/disconnect' && req.method === 'POST') { disconnected = true; return res.end('{}'); }
  if (req.url === '/_cloud/shutdown' && req.method === 'POST') { res.end('{}'); server.close(); return; }
  // Read-only oracle is loopback-only and rejects the forwarder's credential, so it cannot
  // become a browser-visible /cloud/_cloud/ledger route. It contains synthetic records only.
  if (route === '/_cloud/ledger') {
    if (req.method !== 'GET' || req.headers.authorization || req.socket.remoteAddress !== '127.0.0.1')
      return error(res, 404, 'NOT_FOUND', 'Not found');
    const id = url.searchParams.get('id');
    return json(res, 200, { fixture: 'rhythm-web-cloud-parity-v1', ownerUserId: user.id, workspaceId: workspace.id,
      tasks: [...tasks.values()].filter(row => !id || row.id === id),
      artifacts: [...artifacts.values()].filter(entry => !id || entry.artifact.id === id).map(snapshot),
      artifactTabIds: user.artifactTabIds });
  }
  recorded.push({ url: req.url, method: req.method, authorization: req.headers.authorization, cookie: req.headers.cookie });
  if (req.headers.authorization !== `Bearer ${bearer}`) return json(res, 403, {});
  // Preserve the original identity-validation behavior even after disconnection.
  if (req.url === '/auth/me') return json(res, 200, { user, workspace, workspaceRole: 'admin' });
  if (disconnected) return json(res, 401, {});
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1024 * 1024) return error(res, 413, 'TOO_LARGE', 'Fixture request too large');
    }
    const body = raw ? JSON.parse(raw) : {};
    if (route === '/workspaces/me' && req.method === 'GET') return json(res, 200, workspace);
    if (route === '/users/me/preferences' && req.method === 'PATCH') {
      const ids = body.artifactTabIds;
      if (!Array.isArray(ids) || ids.length > 50 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)))
        return error(res, 400, 'BAD_REQUEST', 'artifactTabIds must be unique UUID strings');
      user.artifactTabIds = [...ids];
      return json(res, 200, user);
    }
    if (route === '/tasks' && req.method === 'GET') {
      const status = url.searchParams.get('status') ?? 'open';
      const search = url.searchParams.get('search')?.toLowerCase();
      return json(res, 200, [...tasks.values()].filter(row => (status === 'all' || row.status === status)
        && (!search || row.title.toLowerCase().includes(search))));
    }
    if (route === '/tasks' && req.method === 'POST') {
      if (!ownedTitle(body.title)) return error(res, 400, 'BAD_REQUEST', 'Synthetic writes require a marked title');
      const row = task(randomUUID(), body.title, body); tasks.set(row.id, row);
      return json(res, 201, row);
    }
    const taskMatch = route.match(/^\/tasks\/([^/]+)(\/collaborators)?$/);
    if (taskMatch) {
      const row = tasks.get(decodeURIComponent(taskMatch[1]));
      if (!row) return error(res, 404, 'NOT_FOUND', 'Task not found');
      if (req.method === 'GET') return json(res, 200, taskMatch[2] ? [] : row);
      if (taskMatch[2] || row.id === 'synthetic-cloud-task') return error(res, 403, 'FORBIDDEN', 'Fixture seed is read-only');
      if (req.method === 'PATCH') {
        if ('title' in body && !ownedTitle(body.title)) return error(res, 400, 'BAD_REQUEST', 'Synthetic writes require a marked title');
        for (const key of ['title', 'notes', 'dueDate', 'scheduledDate', 'status', 'priority', 'tags', 'energy'])
          if (key in body) row[key] = body[key];
        row.updatedAt = now(); return json(res, 200, row);
      }
      if (req.method === 'DELETE') { tasks.delete(row.id); return json(res, 204); }
    }
    if (route === '/live-artifacts' && req.method === 'GET') {
      const search = url.searchParams.get('search')?.toLowerCase();
      return json(res, 200, [...artifacts.values()].map(entry => entry.artifact)
        .filter(row => !row.deletedAt && (!search || row.title.toLowerCase().includes(search))));
    }
    if (route === '/live-artifacts' && req.method === 'POST') {
      if (body.type !== 'html' || !ownedTitle(body.title) || body.workspaceId !== workspace.id
        || body.visibility !== 'private' || (body.collaborators?.length ?? 0) || (body.declaredCapabilities?.length ?? 0))
        return error(res, 400, 'BAD_REQUEST', 'Fixture artifacts must be marked, private and unshared');
      const bundle = bundleValue(body.bundle); const state = stateValue(body.state);
      const stamp = now();
      const entry = { artifact: { id: randomUUID(), type: 'html', title: body.title.trim(), ownerUserId: user.id,
        workspaceId: workspace.id, visibility: 'private', currentBundleRevision: 0, currentBundleHash: '',
        currentStateRevision: 0, currentStateHash: '', declaredCapabilities: [], createdAt: stamp,
        updatedAt: stamp, updatedByDisplayName: null, deletedAt: null }, bundleRevisions: [], stateRevisions: [], contents: [] };
      addContent(entry, 'bundle', bundle); addContent(entry, 'state', state);
      artifacts.set(entry.artifact.id, entry); return json(res, 201, entry.artifact);
    }
    const artifactMatch = route.match(/^\/live-artifacts\/([^/]+)(?:\/(render|bundle|state|collaborators))?$/);
    if (artifactMatch) {
      const entry = artifacts.get(decodeURIComponent(artifactMatch[1]));
      if (!entry) return error(res, 404, 'NOT_FOUND', 'Live artifact not found');
      if (entry.artifact.deletedAt) return error(res, 410, 'artifact_deleted', 'Artifact deleted');
      const operation = artifactMatch[2];
      if (req.method === 'GET' && operation === 'render') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('content-security-policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
        res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
        return res.end(entry.bundle.html);
      }
      if (req.method === 'GET') return json(res, 200, operation === 'collaborators' ? [] : { ...entry.artifact, state: entry.state });
      if (req.method === 'DELETE' && !operation) { entry.artifact.deletedAt = now(); return json(res, 204); }
      if (req.method === 'PATCH' && !operation) {
        if (!ownedTitle(body.title) || Object.keys(body).some(key => key !== 'title'))
          return error(res, 400, 'BAD_REQUEST', 'Fixture metadata writes only rename owned artifacts');
        entry.artifact.title = body.title.trim(); entry.artifact.updatedAt = now();
        return json(res, 200, entry.artifact);
      }
      if (req.method === 'PUT' && ['bundle', 'state'].includes(operation)) {
        const kind = operation === 'bundle' ? 'Bundle' : 'State';
        if (body[`expected${kind}Revision`] !== entry.artifact[`current${kind}Revision`])
          return json(res, 409, { error: { code: 'CONFLICT', message: `stale ${operation} revision` },
            [`current${kind}Revision`]: entry.artifact[`current${kind}Revision`] });
        addContent(entry, operation, operation === 'bundle' ? bundleValue(body.bundle) : stateValue(body.state));
        return json(res, 200, entry.artifact);
      }
      return error(res, 405, 'METHOD_NOT_ALLOWED', 'Unsupported fixture operation');
    }
    if (route === '/dashboard/summary' && req.method === 'GET') {
      const open = [...tasks.values()].filter(row => row.status !== 'done');
      return json(res, 200, { tasks: { openCount: open.length, pastDueCount: 0, pastDeadlineCount: 0,
        pastDeadlineTasks: [], todayRemainingCount: 0, todayTotalCount: 0, thisWeekRemainingCount: 0,
        thisWeekTotalCount: 0, unscheduledCount: open.length, recent: open, pastDue: [], today: [], thisWeek: [], unscheduled: open },
        rhythms: { activeCount: 0, items: [] }, projects: { activeCount: 0, items: [] }, goals: { activeCount: 0, items: [] },
        messages: { threadCount: 0, unreadPreviews: [] } });
    }
    if (req.url === '/facilities') return json(res, 200, [{ id: 909, name: 'Synthetic cloud room', description: 'Loopback fake upstream', capacity: 20, location: null, building: null, createdAt: '2026-10-22T12:00:00.000Z', updatedAt: '2026-10-22T12:00:00.000Z' }]);
    if (req.method !== 'GET') return error(res, 405, 'METHOD_NOT_ALLOWED', 'Unsupported fixture write');
    return json(res, 200, []);
  } catch {
    return error(res, 400, 'BAD_REQUEST', 'Invalid synthetic fixture input');
  }
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close());
