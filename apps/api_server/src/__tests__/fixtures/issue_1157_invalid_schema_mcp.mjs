import readline from 'node:readline';

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return;

  if (request.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'issue-1157-invalid-schema', version: '1.0.0' },
      },
    });
    return;
  }

  if (request.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'union_search',
            description: 'Search through one of two fixture scopes.',
            inputSchema: {
              type: 'object',
              properties: {},
              anyOf: [
                {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                },
                {
                  type: 'object',
                  properties: { id: { type: 'number' } },
                  required: ['id'],
                },
              ],
            },
          },
        ],
      },
    });
    return;
  }

  if (request.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: { content: [{ type: 'text', text: 'fixture result' }] },
    });
    return;
  }

  if (request.method === 'ping') {
    send({ jsonrpc: '2.0', id: request.id, result: {} });
    return;
  }

  send({
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32601, message: `Unsupported method: ${request.method}` },
  });
});
