import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { stableOwnedBytes } from '../../../../tools/testing/web_paid_custody.mjs';
import { API, paidFixture } from './paid-parity-fixture';

/** Node-only fixture setup. The synthetic actor bearer never enters the browser.
 * Production requireAuth on /tasks still requires a bearer; browser tasks use /cloud.
 */
export function paidTaskSetupApi(prefix: string) {
  assert(prefix.startsWith('[smoke] ') && prefix.length > 16);
  const owned = new Map<string, string>();
  const transport = async (route: string, init: RequestInit = {}): Promise<Response> => {
    const { manifest } = paidFixture();
    const url = new URL(route, API);
    assert.equal(url.origin, API);
    const match = url.pathname.match(/^\/tasks(?:\/([a-zA-Z0-9_-]+))?$/);
    assert(match && (url.search === '' || url.search === '?status=all'));
    const method = init.method ?? 'GET';
    assert(['GET', 'POST', 'DELETE'].includes(method));
    if (match[1]) assert(owned.has(match[1]), 'Refuse a task outside this exact fixture ledger');
    else assert(method !== 'DELETE');
    if (method === 'POST') {
      assert.equal(url.pathname, '/tasks');
      assert.equal(typeof init.body, 'string');
      const body = JSON.parse(String(init.body));
      assert(typeof body.title === 'string' && body.title.startsWith(prefix));
      assert(Object.keys(body).every(key => key === 'title'));
    } else assert(init.body === undefined);
    const token = stableOwnedBytes(manifest.syntheticActor.tokenPath, { privateFile: true }).bytes.toString('utf8');
    assert.equal(createHash('sha256').update(token).digest('hex'), manifest.tokenSha256);
    const supplied = new Headers(init.headers);
    for (const key of ['authorization', 'cookie', 'host', 'origin', 'x-rhythm-human-approval']) assert(!supplied.has(key));
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: Number(url.port), path: url.pathname + url.search, method,
        headers: { Host: url.host, Origin: API, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => resolve(new Response([204, 205, 304].includes(response.statusCode!) ? null : new Uint8Array(Buffer.concat(chunks)), {
          status: response.statusCode!, headers: { 'content-type': String(response.headers['content-type'] ?? 'application/json') },
        })));
      });
      req.setTimeout(20_000, () => req.destroy(new Error('Synthetic task setup timed out')));
      req.on('error', reject); req.end(init.body ?? undefined);
    });
  };
  const fetch = async (route: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (method === 'DELETE') {
      const id = new URL(route, API).pathname.split('/').at(-1)!;
      const detail = await transport(route);
      assert.equal(detail.status, 200);
      const row = await detail.json();
      assert.equal(row.id, id); assert.equal(row.title, owned.get(id));
      assert.equal(row.ownerId, paidFixture().manifest.ownerUserId); assert.equal(row.isShared, false);
    }
    const response = await transport(route, init);
    if (method === 'POST' && response.status === 201) {
      const row = await response.clone().json();
      assert(typeof row.id === 'string' && row.title.startsWith(prefix));
      assert.equal(row.ownerId, paidFixture().manifest.ownerUserId); assert.equal(row.isShared, false);
      owned.set(row.id, row.title);
    }
    return response;
  };
  return { fetch, async json<T>(route: string): Promise<T> {
    const response = await fetch(route); assert.equal(response.status, 200); return await response.json() as T;
  } };
}
