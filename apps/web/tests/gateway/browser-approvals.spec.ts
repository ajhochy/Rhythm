import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createLiveGateway } from '../../src/gateway';

test('web-approvals-2c-g01: browser decisions send only the displayed revision/hash without native credentials', async () => {
  const calls: { path: string; headers: http.IncomingHttpHeaders; body: unknown }[] = [];
  const card = { id: 'owned-card', sessionId: 'owned-session', action: 'Synthetic approval', preview: 'Exact preview', consequence: 'Sandbox only', status: 'pending', createdAt: new Date().toISOString(), payloadDigest: null, securityAction: null, expiresAt: null, decisionMode: 'trusted-tailnet-web', revision: 'a'.repeat(64), cardHash: 'b'.repeat(64) };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ path: req.url!, headers: req.headers, body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.method === 'PATCH' ? { id: card.id, status: 'approved', decidedAt: new Date().toISOString(), audit: { source: 'trusted-tailnet-web' } } : [card]));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const gateway = createLiveGateway({ browserOrigin: origin, cloud: false });
    expect(gateway.domains.notifications).toBeUndefined();
    expect(gateway.domains.approvals).toBeDefined();
    const rows = await gateway.domains.approvals!.listPending();
    expect(rows).toEqual([card]);
    await gateway.domains.approvals!.decide(card.id, 'approved', { revision: card.revision, cardHash: card.cardHash });
    expect(calls.map(call => ({ path: call.path, body: call.body }))).toEqual([
      { path: '/web/approvals?status=pending', body: null },
      { path: '/web/approvals/owned-card', body: { status: 'approved', revision: card.revision, cardHash: card.cardHash } },
    ]);
    for (const call of calls) {
      expect(call.headers.authorization).toBeUndefined();
      expect(call.headers['x-rhythm-human-approval']).toBeUndefined();
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
