// Synthetic-only loopback provider. Started only by the opted-in live suite.
import http from 'node:http';

const port = Number(process.env.RHYTHM_SDMR_PROVIDER_PORT ?? '7481');
if (!Number.isInteger(port) || port < 7480 || port > 7489) {
  throw new Error('RHYTHM_SDMR_PROVIDER_PORT must be in 7480-7489');
}
const apiKey = 'sdmr-synthetic-only';
const model = 'scripted';
const requests = [];
// Opt-in response TIMING gate (inert unless a tag is registered): holds only that tag's FIRST
// chat request, then sends exactly the normal scripted response. Never alters content or errors.
const gates = new Map();
// Opt-in non-streaming replies (Free extraction proofs): POST /_sdmr/reply/<tag> registers what the fake
// model answers for a stream:false request whose user text carries SDMRX:<tag>. The caller's verifier decides.
const replies = new Map();

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
  if (request.method === 'GET' && request.url === '/_sdmr/held') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify([...gates].filter(([, gate]) => gate.held).map(([tag]) => tag))); return;
  }
  const replyControl = request.method === 'POST' && /^\/_sdmr\/reply\/([A-Za-z0-9_-]{1,40})$/.exec(request.url ?? '');
  if (replyControl) {
    const parts = []; for await (const part of request) parts.push(part);
    try {
      const spec = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!spec || (typeof spec.content !== 'string' && typeof spec.byModel !== 'object')) throw new Error('reply');
      replies.set(replyControl[1], spec);
    } catch { response.writeHead(400).end(); return; }
    response.writeHead(204).end(); return;
  }
  const control = request.method === 'POST' && /^\/_sdmr\/(hold|release)\/([A-Za-z0-9_-]{1,40})$/.exec(request.url ?? '');
  if (control) {
    const [, op, gateTag] = control;
    if (op === 'hold' && !gates.has(gateTag)) {
      let release;
      const promise = new Promise((done) => { release = done; });
      gates.set(gateTag, { used: false, held: false, release, promise });
    } else if (op === 'release' && gates.has(gateTag)) gates.get(gateTag).release();
    else { response.writeHead(409).end(); return; }
    response.writeHead(204).end(); return;
  }
  const fakeTokens = [apiKey, 'g2-fake-account-token'];
  if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/decisions'].includes(request.url) ||
      !fakeTokens.some(token => request.headers.authorization === `Bearer ${token}`)) {
    response.writeHead(403).end(); return;
  }
  let body;
  try {
    const parts = [];
    for await (const part of request) parts.push(part);
    body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (request.url === '/v1/decisions') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ usage: { input_tokens: 8 }, answers: [
        { name: 'tier', type: 'score', score: 0, confidence: 1, probabilities: ['tier4', 'tier3', 'tier2', 'tier1'].map((label, value) => ({ label, value, probability: value === 0 ? 1 : 0 })) },
        { name: 'category', type: 'choice', choice: 'knowledge', confidence: 1 },
        { name: 'can_queue', type: 'predicate', probability: 0 }, { name: 'security_sensitive', type: 'predicate', probability: 0 },
      ] }));
      return;
    }
    if (!Array.isArray(body.messages)) throw new Error('messages required');
  } catch { response.writeHead(400).end(); return; }
  const lastUserIndex = body.messages.findLastIndex((message) => message.role === 'user');
  const lastUserText = text(body.messages[lastUserIndex]);
  const toolResults = body.messages.filter((message) => message.role === 'tool').map(text);
  const currentResults = body.messages.slice(lastUserIndex + 1).filter((message) => message.role === 'tool');
  // Auth is recorded only AFTER the hardcoded synthetic-token whitelist above.
  requests.push({ headers: { authorization: request.headers.authorization }, body,
    reasoning_effort: body.reasoning_effort, reasoning: body.reasoning,
    systemText: body.messages.filter((message) => message.role === 'system').map(text).join('\n'),
    lastUserText, toolNames: (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean),
    messageCount: body.messages.length, toolResults });
  if (body.stream === false) {
    const tagged = lastUserText.match(/SDMRX:([A-Za-z0-9_-]{1,40})/);
    if (!tagged || !replies.has(tagged[1])) { response.writeHead(400).end(); return; }
    const registered = replies.get(tagged[1]);
    const selected = registered.byModel?.[body.model] ?? registered;
    const status = Number(selected.status ?? 200);
    if (status !== 200) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'synthetic' })); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'chatcmpl-sdmrx', object: 'chat.completion', model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: String(selected.content ?? '') } }] }));
    return;
  }
  const marker = lastUserText.match(/SDMR:(PWD|WRITE|ECHO):([A-Za-z0-9_-]+)(?::([^\s]+))?/);
  const [, action, tag = 'none', path] = marker ?? [];
  // Refuse shell metacharacters; this provider must never turn a fixture into shell injection.
  if (action === 'WRITE' && (!path || !/^\/(?:private\/tmp|var\/folders)\/[A-Za-z0-9_./-]+$/.test(path) || path.split('/').includes('..'))) {
    response.writeHead(400).end(); return;
  }
  const gate = gates.get(tag);
  if (gate && !gate.used && currentResults.length === 0) {
    gate.used = true; gate.held = true;
    await gate.promise;
    gate.held = false;
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
