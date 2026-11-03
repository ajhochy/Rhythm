/** Controlled MCP effects for permission experiments; never talks to a live integration. */
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const tools = [
  { name: 'read_fixture', description: 'Read one named disposable test fixture.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' } }, required: ['key'], additionalProperties: false } },
  { name: 'record_action', description: 'Record a harmless action in the disposable experiment ledger.',
    inputSchema: { type: 'object', properties: { value: { type: 'string', minLength: 1, maxLength: 4096 } }, required: ['value'], additionalProperties: false } },
];
const vettedTool = { name: 'invoke_vetted_tool', description: 'Invoke one closed scenario of a digest-pinned tool inside the disposable Docker evaluation sandbox.',
  inputSchema: { type: 'object', properties: { scenarioId: { type: 'string', enum: ['version-check', 'help-check', 'stdin-noop'] } },
    required: ['scenarioId'], additionalProperties: false } };

function toolReceiver(): { url: string; token: string } | null {
  const raw = process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_URL;
  const token = process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_TOKEN;
  if (!raw || !token || !/^[a-f0-9]{64}$/.test(token)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
        [4000, 4001, 4002, 4096, 4098].includes(Number(url.port))) return null;
    return { url: `${url.origin}/invoke`, token };
  } catch { return null; }
}
function contained(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return !!suffix && suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
}
export class OrgEvaluationMcpFixture {
  readonly ledgerPath: string;
  private readonly root: string;
  constructor(root: string) {
    this.root = realpathSync(root);
    if (!contained('/private/tmp', this.root) && !contained('/tmp', this.root)
      && !contained('/private/var/folders', this.root)) throw Error('MCP fixture requires a private temporary worker');
    const directory = join(this.root, 'mcp-fixture');
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw Error('MCP fixture directory is a symlink');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.ledgerPath = join(directory, 'effects.jsonl');
  }
  async handle(request: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (request.id === undefined) return null;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: request.id, result });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: request.id, error: { code, message } });
    if (request.method === 'initialize') {
      const parameters = request.params as Record<string, unknown> | undefined;
      return reply({ protocolVersion: typeof parameters?.protocolVersion === 'string' ? parameters.protocolVersion : '2024-11-05',
        capabilities: { tools: {} }, serverInfo: { name: 'evaluation-fixture', version: '1.0.0' } });
    }
    if (request.method === 'ping') return reply({});
    if (request.method === 'tools/list') return reply({ tools: toolReceiver() ? [...tools, vettedTool] : tools });
    if (request.method !== 'tools/call') return error(-32601, 'Unsupported fixture method');
    const params = request.params as Record<string, unknown> | undefined;
    const args = params?.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return error(-32602, 'Expected closed fixture arguments');
    const input = args as Record<string, unknown>;
    let output: string;
    let receiverReceiptHash: string | null = null;
    if (params?.name === 'invoke_vetted_tool') {
      const receiver = toolReceiver();
      if (!receiver || Object.keys(input).join(',') !== 'scenarioId' ||
          !['version-check', 'help-check', 'stdin-noop'].includes(String(input.scenarioId)))
        return error(-32602, 'Confined tool invocation is unavailable');
      const response = await fetch(receiver.url, { method: 'POST', headers: {
        'authorization': `Bearer ${receiver.token}`, 'content-type': 'application/json',
      }, body: JSON.stringify({ scenarioId: input.scenarioId }), signal: AbortSignal.timeout(65_000) });
      if (!response.ok) return reply({ isError: true, content: [{ type: 'text', text: 'Confined tool invocation failed' }] });
      const result = await response.json() as { output?: unknown; receiptHash?: unknown };
      if (typeof result.output !== 'string' || result.output.length > 16_384 ||
          typeof result.receiptHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.receiptHash))
        return error(-32603, 'Confined tool receipt is incomplete');
      output = result.output;
      receiverReceiptHash = result.receiptHash;
    } else if (params?.name === 'read_fixture') {
      if (Object.keys(input).join(',') !== 'key' || typeof input.key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.key))
        return error(-32602, 'Invalid fixture key');
      const file = join(this.root, 'workspace', 'fixtures', `${input.key}.json`);
      try {
        if (!contained(this.root, realpathSync(file)) || lstatSync(file).isSymbolicLink()) return error(-32602, 'Fixture escaped the worker');
        const bytes = readFileSync(file);
        if (bytes.length > 16384) return error(-32602, 'Fixture exceeds its size bound');
        output = bytes.toString('utf8');
      } catch { return reply({ isError: true, content: [{ type: 'text', text: 'Named fixture does not exist' }] }); }
    } else if (params?.name === 'record_action') {
      if (Object.keys(input).join(',') !== 'value' || typeof input.value !== 'string'
        || !input.value.trim() || input.value.length > 4096) return error(-32602, 'Invalid action value');
      output = JSON.stringify({ recorded: input.value });
    } else return error(-32602, 'Tool is not part of the closed fixture catalog');
    if (existsSync(this.ledgerPath) && lstatSync(this.ledgerPath).isSymbolicLink()) throw Error('MCP ledger is a symlink');
    appendFileSync(this.ledgerPath, JSON.stringify({ tool: params.name, arguments: input,
      outputHash: createHash('sha256').update(output).digest('hex'),
      ...(receiverReceiptHash ? { receiverReceiptHash } : {}),
      observedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    return reply({ content: [{ type: 'text', text: output }] });
  }
}

async function main(): Promise<void> {
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1' || !process.env.DB_PATH) throw Error('MCP fixture requires a private evaluation worker');
  const root = dirname(resolve(process.env.DB_PATH));
  const fixture = new OrgEvaluationMcpFixture(root);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (Buffer.byteLength(line) > 65536) throw Error('MCP fixture request is too large');
    try {
      const response = await fixture.handle(JSON.parse(line) as Record<string, unknown>);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Fixture request failed' } }) + '\n'); }
  }
}
if (require.main === module) void main().catch(() => { process.exitCode = 1; });
