import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.RHYTHM_1424_PROVIDER_PORT ?? '7476');
if (!Number.isInteger(port) || port < 7470 || port > 7479) {
  throw new Error('RHYTHM_1424_PROVIDER_PORT must be in the assigned 7470-7479 block');
}

const apiKey = 'issue-1424-synthetic-only';
const model = 'turn-lifecycle-scripted';

if (process.argv[2] === '--write-config') {
  const output = resolve(process.argv[3] ?? '');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const config = {
    mcp: {
      rhythm: {
        type: 'local',
        command: ['node', resolve(root, 'apps/mcp_server/dist/index.js')],
        environment: {
          RHYTHM_API_URL: 'http://127.0.0.1:7473',
          RHYTHM_API_TOKEN: 'e02-synthetic-session-not-a-secret',
        },
      },
    },
    provider: {
      issue1424: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Issue 1424 loopback scripted provider',
        options: { apiKey, baseURL: `http://127.0.0.1:${port}/v1` },
        models: {
          [model]: {
            name: 'Turn lifecycle scripted',
            limit: { context: 20_000, output: 1_000 },
          },
        },
      },
    },
  };
  writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o400 });
  process.stdout.write(`Synthetic #1424 OpenCode config: ${output}\n`);
  process.exit(0);
}

const queueOrder = [];
const requestLog = [];
let activeRequests = 0;
let maxActiveRequests = 0;
let questionSelectedLabels = [];
let permissionFeedback = '';

function chunk(delta = {}, finishReason = null) {
  return {
    id: 'chatcmpl-issue-1424',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? '');
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (typeof part?.text === 'string') return part.text;
    if (typeof part?.output === 'string') return part.output;
    if (typeof part?.output?.value === 'string') return part.output.value;
    return JSON.stringify(part ?? '');
  }).join('');
}

function send(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function finishText(response, text) {
  send(response, chunk({ role: 'assistant' }));
  send(response, chunk({ content: text }));
  send(response, chunk({}, 'stop'));
  response.end('data: [DONE]\n\n');
}

function finishTool(response, id, name, args) {
  send(response, chunk({ role: 'assistant' }));
  send(response, chunk({
    tool_calls: [{
      index: 0,
      id,
      type: 'function',
      function: { name, arguments: '' },
    }],
  }));
  send(response, chunk({
    tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }],
  }));
  send(response, chunk({}, 'tool_calls'));
  response.end('data: [DONE]\n\n');
}

const server = http.createServer(async (request, response) => {
  if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1') {
    response.writeHead(403).end();
    return;
  }
  if (request.url === '/_1424/status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      queueOrder,
      requestLog,
      activeRequests,
      maxActiveRequests,
      questionSelectedLabels,
      permissionFeedback,
    }));
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
    const buffers = [];
    for await (const part of request) buffers.push(part);
    body = JSON.parse(Buffer.concat(buffers).toString('utf8'));
  } catch {
    response.writeHead(400).end();
    return;
  }

  activeRequests += 1;
  maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
  response.on('close', () => { activeRequests = Math.max(0, activeRequests - 1); });
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latestUser = [...messages].reverse().find((message) => message?.role === 'user');
  const userText = textContent(latestUser?.content);
  const latestTool = [...messages].reverse().find((message) => message?.role === 'tool');
  const toolText = textContent(latestTool?.content);
  requestLog.push({
    user: userText.slice(0, 120),
    toolCallId: typeof latestTool?.tool_call_id === 'string' ? latestTool.tool_call_id : null,
    toolText: toolText.slice(0, 240),
  });

  const queueMatch = userText.match(/QUEUE-(1|2|3)/);
  if (queueMatch) {
    queueOrder.push(`QUEUE-${queueMatch[1]}`);
    if (queueMatch[1] === '1') await new Promise((resolve) => setTimeout(resolve, 1_200));
    finishText(response, `ACK QUEUE-${queueMatch[1]}`);
    return;
  }

  if (userText.includes('QUESTION-MULTI')) {
    if (!latestTool || latestTool.tool_call_id !== 'call-1424-question') {
      finishTool(response, 'call-1424-question', 'question', {
        questions: [{
          header: 'Colors',
          question: 'Choose exactly two synthetic colors',
          multiple: true,
          options: [
            { label: 'Blue', description: 'Synthetic blue' },
            { label: 'Green', description: 'Synthetic green' },
            { label: 'Red', description: 'Synthetic red' },
          ],
        }],
      });
      return;
    }
    questionSelectedLabels = ['Blue', 'Green', 'Red'].filter((label) => toolText.includes(label));
    finishText(response, 'QUESTION_DONE');
    return;
  }

  if (userText.includes('PERMISSION-REJECT')) {
    if (!latestTool || latestTool.tool_call_id !== 'call-1424-permission') {
      finishTool(response, 'call-1424-permission', 'bash', {
        command: 'pwd',
        description: 'Synthetic permission rejection probe',
      });
      return;
    }
    permissionFeedback = toolText;
    finishText(response, 'PERMISSION_DONE');
    return;
  }

  finishText(response, 'UNEXPECTED_SCENARIO');
});

server.on('error', (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
server.listen(port, '127.0.0.1');
