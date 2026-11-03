// Reuse the held external transport; fail only explicitly registered synthetic markers.
import { createServer } from 'node:http';
import { startC1Provider } from './_c1_synthetic_provider';
export async function startC1ErrorProvider() {
  const held = await startC1Provider();
  const failures = new Map<string, number>();
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const marker = request.method === 'POST' && request.url === '/v1/messages'
        ? body.toString().match(/C1-[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0] : undefined;
      if (marker && failures.has(marker)) {
        failures.set(marker, failures.get(marker)! + 1);
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Synthetic C1 provider unavailable: review model settings.' } }));
        return;
      }
      const result = await fetch(`${held.origin}${request.url}`, { method: request.method, headers: { 'Content-Type': 'application/json' }, body: request.method === 'POST' ? body : undefined });
      response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') ?? 'application/json' });
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { if (!response.headersSent) response.writeHead(502); response.end(String(error)); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic error-provider bind failed');
  return { origin: `http://127.0.0.1:${address.port}`, failures, holds: held.holds,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await held.close(); } };
}
