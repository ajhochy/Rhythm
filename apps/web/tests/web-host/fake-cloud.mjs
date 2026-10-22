// Synthetic-only loopback upstream. No production hosts, credentials or calls.
import http from 'node:http';
const port = 7097;
const bearer = 'web-cloud-synthetic-bearer-only';
const recorded = [];
let disconnected = false;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/_cloud/status') return res.end(JSON.stringify({ recorded }));
  if (req.url === '/_cloud/disconnect' && req.method === 'POST') { disconnected = true; return res.end('{}'); }
  if (req.url === '/_cloud/shutdown' && req.method === 'POST') { res.end('{}'); server.close(); return; }
  recorded.push({ url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
  if (req.headers.authorization !== `Bearer ${bearer}`) { res.statusCode = 403; return res.end('{}'); }
  if (req.url === '/auth/me') return res.end(JSON.stringify({ user: { id: 99, name: 'Synthetic Admin', email: 'admin@example.invalid', googleSub: 'web-cloud-synthetic-owner' } }));
  if (disconnected) { res.statusCode = 401; return res.end('{}'); }
  if (req.url?.startsWith('/tasks')) return res.end(JSON.stringify([{ id: 'synthetic-cloud-task', title: 'Synthetic cloud task', notes: '', status: 'open', ownerId: 99, isShared: false, priority: 0, tags: [], createdAt: '2026-10-22T12:00:00.000Z' }]));
  if (req.url === '/facilities') return res.end(JSON.stringify([{ id: 909, name: 'Synthetic cloud room', description: 'Loopback fake upstream', capacity: 20, location: null, building: null, createdAt: '2026-10-22T12:00:00.000Z', updatedAt: '2026-10-22T12:00:00.000Z' }]));
  res.end('[]');
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close());
