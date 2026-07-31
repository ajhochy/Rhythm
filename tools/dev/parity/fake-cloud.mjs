// Minimal stand-in for the Rhythm Cloud /auth/me endpoint, for live auth gates.
// Accepts exactly one bearer and answers with the identity of the local user
// whose googleSub/email are passed in via env. Counts hits so the test can
// assert the local server does NOT introspect per request.
import http from 'node:http';

const PORT = Number(process.env.FAKE_CLOUD_PORT ?? 4599);
const TOKEN = process.env.FAKE_CLOUD_TOKEN ?? '';
const EMAIL = process.env.FAKE_CLOUD_EMAIL ?? '';
const GOOGLE_SUB = process.env.FAKE_CLOUD_GOOGLE_SUB ?? '';
let hits = 0;

const server = http.createServer((req, res) => {
  if (req.url === '/__hits') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hits }));
    return;
  }
  if (!req.url?.startsWith('/auth/me')) {
    res.writeHead(404).end();
    return;
  }
  hits += 1;
  const auth = req.headers.authorization ?? '';
  const presented = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? '';
  if (!TOKEN || presented !== TOKEN) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid token' }));
    return;
  }
  // hasUserIdentity() requires id (positive safe integer), non-empty name,
  // email, and googleSub — a thinner payload is rejected before mapping.
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      user: {
        id: Number(process.env.FAKE_CLOUD_USER_ID ?? 1),
        name: process.env.FAKE_CLOUD_NAME ?? 'Fake Cloud User',
        email: EMAIL,
        googleSub: GOOGLE_SUB,
      },
    }),
  );
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake cloud listening on 127.0.0.1:${PORT}`);
});
