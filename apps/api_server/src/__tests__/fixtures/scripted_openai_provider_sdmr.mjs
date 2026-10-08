// Synthetic-only loopback provider. Started only by the opted-in live suite.
import http from 'node:http';

const port = Number(process.env.RHYTHM_SDMR_PROVIDER_PORT ?? '7481');
if (!Number.isInteger(port) || port < 7480 || port > 7489) {
  throw new Error('RHYTHM_SDMR_PROVIDER_PORT must be in 7480-7489');
}
const apiKey = 'sdmr-synthetic-only';
const model = 'scripted';
const requests = [];

// Same SSE chunk/tool-call wire format as scripted_openai_provider_1575.mjs.
function chunk(delta = {}, finishReason = null) {
  return {
    id: 'chatcmpl-sdmr', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
function text(message) {
  if (typeof message?.content === 'string') return message.content.trim();
  if (!Array.isArray(message?.content)) return '';
  return message.content.map((part) => {
    if (typeof part === 'string') return part;
    if (typeof part?.text === 'string') return part.text;
    if (typeof part?.output?.value === 'string') return part.output.value;
    if (typeof part?.output === 'string') return part.output;
    return '';
  }).join('').trim();
}
// Rhythm sessions expose built-in tools either directly (`bash`) or behind `mcp_dispatch`.
function sendToolCall(response, id, command, description, offered) {
  const direct = offered.includes('bash') || !offered.includes('mcp_dispatch');
  const name = direct ? 'bash' : 'mcp_dispatch';
  const args = direct ? { command, description }
    : { action: 'execute', family: 'builtin', name: 'bash', arguments: { command, description } };
  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant' }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({ tool_calls: [{
    index: 0, id, type: 'function', function: { name, arguments: '' },
  }] }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({ tool_calls: [{
    index: 0, function: { arguments: JSON.stringify(args) },
  }] }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`);
  response.end('data: [DONE]\n\n');
}
function sendText(response, content) {
  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant' }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({ content }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
  response.end('data: [DONE]\n\n');
}
const server = http.createServer(async (request, response) => {
  if (!['127.0.0.1', '::1'].includes(request.socket.remoteAddress)) {
    response.writeHead(403).end(); return;
  }
  if (request.method === 'GET' && ['/health', '/status', '/_sdmr/requests'].includes(request.url)) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url === '/_sdmr/requests' ? requests : { ready: true, requests: requests.length }));
    return;
  }
  if (request.method === 'POST' && request.url === '/_sdmr/reset') {
    requests.length = 0; response.writeHead(204).end(); return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions' ||
      request.headers.authorization !== `Bearer ${apiKey}`) {
    response.writeHead(403).end(); return;
  }
  let body;
  try {
    const parts = [];
    for await (const part of request) parts.push(part);
    body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!Array.isArray(body.messages)) throw new Error('messages required');
  } catch { response.writeHead(400).end(); return; }
  const lastUserIndex = body.messages.findLastIndex((message) => message.role === 'user');
  const lastUserText = text(body.messages[lastUserIndex]);
  const toolResults = body.messages.filter((message) => message.role === 'tool').map(text);
  const currentResults = body.messages.slice(lastUserIndex + 1).filter((message) => message.role === 'tool');
  requests.push({ body, systemText: body.messages.filter((message) => message.role === 'system').map(text).join('\n'),
    lastUserText, toolNames: (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean),
    messageCount: body.messages.length, toolResults });
  const marker = lastUserText.match(/SDMR:(PWD|WRITE|ECHO):([A-Za-z0-9_-]+)(?::([^\s]+))?/);
  const [, action, tag = 'none', path] = marker ?? [];
  // Refuse shell metacharacters; this provider must never turn a fixture into shell injection.
  if (action === 'WRITE' && (!path || !/^\/(?:private\/tmp|var\/folders)\/[A-Za-z0-9_./-]+$/.test(path) || path.split('/').includes('..'))) {
    response.writeHead(400).end(); return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  if ((action === 'PWD' || action === 'WRITE') && currentResults.length === 0) {
    sendToolCall(response, `call-sdmr-${tag}`, action === 'PWD' ? 'pwd' : `touch ${path}`,
      action === 'PWD' ? 'print working directory' : 'write marker', requests.at(-1).toolNames);
  } else if (action === 'PWD') {
    sendText(response, `SDMR_DONE ${tag} ${text(currentResults.at(-1)).split(/\r?\n/)[0]}`);
  } else if (action === 'WRITE') {
    sendText(response, `SDMR_WROTE ${tag}`);
  } else {
    sendText(response, `SDMR_ECHO ${tag}`);
  }
});
server.on('error', (error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
server.listen(port, '127.0.0.1');
