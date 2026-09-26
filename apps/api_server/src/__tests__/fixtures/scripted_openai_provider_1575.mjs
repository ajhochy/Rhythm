import http from 'node:http';

const port = Number(process.env.RHYTHM_1575_PROVIDER_PORT ?? '7423');
if (!Number.isInteger(port) || port < 7420 || port > 7429) {
  throw new Error('RHYTHM_1575_PROVIDER_PORT must be in the assigned 7420-7429 block');
}

const apiKey = 'issue-1575-synthetic-only';
const model = 'cwd-scripted';
let requests = 0;
let pwdToolResult = null;

function chunk(delta = {}, finishReason = null) {
  return {
    id: 'chatcmpl-issue-1575',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function toolResultText(message) {
  if (typeof message?.content === 'string') return message.content.trim();
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.output?.value === 'string') return part.output.value;
      if (typeof part?.output === 'string') return part.output;
      return '';
    })
    .join('')
    .trim();
}

function sendToolCall(response, id, command, description) {
  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant' }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({
    tool_calls: [{
      index: 0,
      id,
      type: 'function',
      function: { name: 'bash', arguments: '' },
    }],
  }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({
    tool_calls: [{
      index: 0,
      function: { arguments: JSON.stringify({ command, description }) },
    }],
  }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`);
  response.end('data: [DONE]\n\n');
}

const server = http.createServer(async (request, response) => {
  if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1') {
    response.writeHead(403).end();
    return;
  }
  if (request.url === '/_1575/status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ requests, pwdToolResult }));
    return;
  }
  if (
    request.url !== '/v1/chat/completions' ||
    request.method !== 'POST' ||
    request.headers.authorization !== `Bearer ${apiKey}`
  ) {
    response.writeHead(403).end();
    return;
  }

  let body;
  try {
    const chunks = [];
    for await (const chunkPart of request) chunks.push(chunkPart);
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    response.writeHead(400).end();
    return;
  }

  requests += 1;
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  const toolMessage = body.messages?.filter((message) => message.role === 'tool').at(-1);
  if (!toolMessage) {
    sendToolCall(response, 'call-1575-pwd', 'pwd', 'Report the current working directory');
    return;
  }
  if (pwdToolResult === null) {
    pwdToolResult = toolResultText(toolMessage);
    sendToolCall(
      response,
      'call-1575-dirty',
      "printf 'owned by issue 1575 live test\\n' > issue-1575-owned-dirty-marker.txt",
      'Create an owned dirty marker before completion',
    );
    return;
  }

  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant' }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({ content: `CWD:${pwdToolResult}` }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
  response.end('data: [DONE]\n\n');
});

server.on('error', (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
server.listen(port, '127.0.0.1');
