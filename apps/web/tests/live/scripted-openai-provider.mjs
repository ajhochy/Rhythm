// #1582 S0: loopback-only scripted OpenAI-compatible endpoint. No external calls.
import http from 'node:http';

const port = 6996;
const key = 's0-local-synthetic-key';
const hits = [];
let disconnects = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chunk = (delta = {}, finish_reason = null) => ({
  id: 'chatcmpl-s0', object: 'chat.completion.chunk', created: 1, model: 's0-local',
  choices: [{ index: 0, delta, finish_reason }],
});

const server = http.createServer(async (req, res) => {
  if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::1') {
    res.writeHead(403).end(); return;
  }
  if (req.url === '/_s0/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits, disconnects })); return;
  }
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST' || req.headers.authorization !== `Bearer ${key}`) {
    res.writeHead(403).end(); return;
  }
  let body;
  try {
    const buffers = [];
    for await (const data of req) buffers.push(data);
    body = JSON.parse(Buffer.concat(buffers).toString());
  } catch { res.writeHead(400).end(); return; }
  const user = body.messages?.filter((m) => m.role === 'user').at(-1);
  const text = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? '');
  const scenario = text.match(/S0:(plain|reasoning|tool|permission|question|cancel|error)/)?.[1];
  const afterTool = body.messages?.some((m) => m.role === 'tool' || m.role === 'function');
  const hit = { scenario, afterTool: Boolean(afterTool), tools: body.tools?.map((tool) => tool.function?.name) ?? [] };
  hits.push(hit);
  if (!scenario) { res.writeHead(400).end('missing S0 scenario'); return; }
  if (scenario === 'error') {
    res.writeHead(503, { 'Content-Type': 'application/json', 'retry-after-ms': '20' });
    res.end(JSON.stringify({ error: { message: 'S0 synthetic provider failure', type: 'invalid_request_error' } })); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  let finished = false;
  res.on('close', () => { if (!finished) disconnects++; });
  const send = (value) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
  send(chunk({ role: 'assistant' }));
  const toolName = scenario === 'question' ? 'question' : 'bash';
  if (!afterTool && ['tool', 'permission', 'question'].includes(scenario)) {
    if (!hit.tools.includes(toolName)) {
      send(chunk({ content: 'S0 tool unavailable' }));
    } else {
      const args = scenario === 'question'
        ? { questions: [{ question: 'Choose a synthetic color?', header: 'Color', options: [
          { label: 'Blue', description: 'Synthetic choice' }, { label: 'Green', description: 'Synthetic choice' },
        ] }] }
        : { command: 'pwd', description: 'Read sandbox working directory' };
      send(chunk({ tool_calls: [{ index: 0, id: `call-s0-${scenario}`, type: 'function', function: { name: toolName, arguments: '' } }] }));
      send(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }));
      send(chunk({}, 'tool_calls'));
      finished = true; res.end('data: [DONE]\n\n'); return;
    }
  } else if (scenario === 'reasoning') {
    for (const part of ['Plan ', 'Plan ', '🌱']) { send(chunk({ reasoning_content: part })); await sleep(180); }
    for (const part of ['repeat ', 'repeat ', 'é✓']) { send(chunk({ content: part })); await sleep(180); }
  } else if (scenario === 'cancel') {
    send(chunk({ content: 'partial-' }));
    // A server abort without provider disconnect is not qualified cancellation.
    for (let i = 0; i < 200 && !res.destroyed; i++) await sleep(100);
    if (res.destroyed) return;
    send(chunk({ content: 'unexpected-completion' }));
  } else {
    for (const part of (afterTool ? ['tool ', 'resolved'] : ['hello ', 'hello ', '🌱'])) {
      send(chunk({ content: part })); await sleep(180);
    }
  }
  send(chunk({}, 'stop')); finished = true; res.end('data: [DONE]\n\n');
});
server.listen(port, '127.0.0.1', () => console.log(`S0 provider listening on 127.0.0.1:${port}`));
