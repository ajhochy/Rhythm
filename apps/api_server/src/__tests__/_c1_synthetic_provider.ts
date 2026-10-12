// Only the external model transport is synthetic; scheduler/API/engine remain real.
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startC1Provider() {
  const holds = new Map<string, { state: string; requests: number; responses: ServerResponse[] }>();
  function complete(response: ServerResponse, marker: string) {
    const events = [
      { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: 'text', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: marker } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n');
  }
  const server = createServer((request, response) => {
    const control = request.url?.match(/^\/c1\/holds\/([^/]+)(\/release)?$/);
    if (control) {
      const marker = decodeURIComponent(control[1]);
      const hold = holds.get(marker) ?? { state: marker === 'readiness' ? 'ready' : 'waiting', requests: 0, responses: [] };
      holds.set(marker, hold);
      if (control[2] && request.method === 'POST') {
        hold.state = 'released';
        for (const pending of hold.responses.splice(0)) complete(pending, marker);
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ state: hold.state, requests: hold.requests }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/messages') { response.writeHead(404); response.end(); return; }
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        const marker = JSON.stringify(body).match(/C1-[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
        if (!marker) { response.writeHead(400); response.end('Synthetic C1 marker missing'); return; }
        const hold = holds.get(marker) ?? { state: 'waiting', requests: 0, responses: [] };
        hold.requests++;
        holds.set(marker, hold);
        console.log('C1 actual provider request', JSON.stringify({ marker, requests: hold.requests }));
        if (hold.state === 'released') complete(response, marker);
        else { hold.state = 'held'; hold.responses.push(response); }
      } catch { response.writeHead(400); response.end('Malformed synthetic model request'); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('C1 provider bind failed');
  return { origin: `http://127.0.0.1:${address.port}`, holds,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
