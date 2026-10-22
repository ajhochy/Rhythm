import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createLiveGateway } from '../../src/gateway';

test('C3 cloud capability composes real cloud factories over tokenless same-origin HTTP; disconnected errors remain distinct', async () => {
  const recorded: { url?: string; authorization?: string }[] = [];
  let disconnected = false;
  const server = http.createServer((req, res) => {
    recorded.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.statusCode = disconnected ? 401 : 200;
    res.end(JSON.stringify(disconnected ? { error: { code: 'CLOUD_ACCOUNT_DISCONNECTED' } } : []));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const gateway = createLiveGateway({ browserOrigin: origin, cloud: true });
    expect(gateway.domains.tasks).toBeDefined();
    expect(gateway.domains.projects).toBeDefined();
    expect(gateway.domains.approvals).toBeUndefined();
    await expect(gateway.domains.tasks!.list()).resolves.toEqual([]);
    await gateway.domains.projects!.templates();
    expect(recorded).toEqual([{ url: '/cloud/tasks?status=all', authorization: undefined }, { url: '/cloud/project-templates', authorization: undefined }]);
    disconnected = true;
    await expect(gateway.domains.tasks!.list()).rejects.toThrow(/upstream account.*connect/i);
    await expect(gateway.domains.projects!.templates()).rejects.toThrow(/upstream account.*connect/i);
    await expect(gateway.domains.facilities!.facilities()).rejects.toThrow(/upstream account.*connect/i);
    await expect(gateway.domains.integrations!.accounts()).rejects.toThrow(/upstream account.*connect/i);
    expect(gateway.domains.sessions).toBeDefined();
    expect(createLiveGateway({ browserOrigin: origin }).domains.tasks).toBeUndefined();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
