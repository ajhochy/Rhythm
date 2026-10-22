/** Private stdio MCP bridge for two production managed-tool names. */
import { createInterface } from 'node:readline';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const META = 'com.vcrc.rhythm/security-context';
export const MANAGED_TOOL_DENIAL_TEXT = 'Managed tool unavailable for this signed agent';
const TOOLS = [
  { name: 'rhythm_list_managed_tools',
    description: 'List human-approved local tools available to this signed agent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'rhythm_run_managed_tool',
    description: 'Run an approved local tool in a network-isolated container.',
    inputSchema: { type: 'object', properties: {
      proposalId: { type: 'string', minLength: 1, maxLength: 200 },
      argv: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2048 } },
      stdin: { type: 'string', maxLength: 32768 },
    }, required: ['proposalId', 'argv'], additionalProperties: false } },
] as const;

type JsonRpc = { id?: unknown; method?: unknown; params?: unknown };
const error = (id: unknown, code: number, message: string) =>
  ({ jsonrpc: '2.0', id, error: { code, message } });
const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });

function receiver(): { url: string; token: string } {
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1') throw Error('outside evaluation worker');
  const raw = process.env.RHYTHM_EVALUATION_MANAGED_RECEIVER_URL;
  const token = process.env.RHYTHM_EVALUATION_MANAGED_RECEIVER_TOKEN;
  if (!raw || !token || token.length < 32) throw Error('private managed receiver unavailable');
  const url = new URL(raw);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      [4000, 4001, 4002, 4096, 4098].includes(Number(url.port)))
    throw Error('private managed receiver unavailable');
  return { url: url.origin, token };
}

export async function handleManagedMcpRequest(input: JsonRpc): Promise<unknown | null> {
  if (input.id === undefined) return null;
  if (input.method === 'initialize') {
    const params = input.params as Record<string, unknown> | undefined;
    return reply(input.id, { protocolVersion: typeof params?.protocolVersion === 'string'
      ? params.protocolVersion : '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'rhythm', version: 'evaluation-private-1' } });
  }
  if (input.method === 'ping') return reply(input.id, {});
  if (input.method === 'tools/list') return reply(input.id, { tools: TOOLS });
  if (input.method !== 'tools/call') return error(input.id, -32601, 'Unsupported method');
  const params = input.params;
  if (!params || typeof params !== 'object' || Array.isArray(params))
    return error(input.id, -32602, 'Malformed tool call');
  const record = params as Record<string, unknown>;
  const name = record.name;
  if (name !== TOOLS[0].name && name !== TOOLS[1].name)
    return error(input.id, -32602, 'Tool unavailable');
  const args = record.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args))
    return error(input.id, -32602, 'Malformed tool arguments');
  const meta = record._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) ||
      Object.keys(meta).length !== 1 || !Object.hasOwn(meta, META))
    return reply(input.id, { isError: true, content: [{ type: 'text', text: 'Signed call required' }] });
  const signed = (meta as Record<string, unknown>)[META];
  if (!signed || typeof signed !== 'object' || Array.isArray(signed))
    return reply(input.id, { isError: true, content: [{ type: 'text', text: 'Signed call required' }] });
  const { url, token } = receiver();
  const { proof, ...context } = signed as Record<string, unknown>;
  try {
    const response = await fetch(`${url}/managed-tools/${name === TOOLS[0].name ? 'list' : 'run'}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trustedCall: { context, proof, arguments: args } }),
      signal: AbortSignal.timeout(65_000),
    });
    if (!response.ok || Number(response.headers.get('content-length') ?? '0') > 32768)
      throw Error('managed call denied');
    const text = await response.text();
    if (Buffer.byteLength(text) > 32768) throw Error('managed result too large');
    if (name === TOOLS[0].name) return reply(input.id, { content: [{ type: 'text', text }] });
    // Execute the production MCP ingress scanner and copied-state taint path.
    // A private receiver provides only the one taint route that this module
    // calls; no live agent API or approval endpoint is reachable.
    const mcpDist = process.env.RHYTHM_EVALUATION_MCP_DIST;
    const trustedDist = resolve(__dirname, '../../../mcp_server/dist');
    if (!mcpDist || realpathSync(mcpDist) !== realpathSync(trustedDist))
      throw Error('Production ingress unavailable');
    const security = require(resolve(mcpDist, 'security/security_context.js')) as {
      trustedSecurityContext(extra: unknown): unknown;
      runWithTrustedSecurityCall<T>(extra: unknown, args: Record<string, unknown>, action: () => Promise<T>): Promise<T>;
    };
    const boundary = require(resolve(mcpDist, 'security/external_content_boundary.js')) as {
      scanContextContentAndRecordExternalContentTaint(value: {
        agentUrl: string; context: unknown; source: 'managed-tool.run';
        label: string; rawContent: string;
      }): Promise<{ blocked: boolean; text: string }>;
    };
    const extra = { _meta: meta };
    const ingress = await security.runWithTrustedSecurityCall(extra, args as Record<string, unknown>,
      () => boundary.scanContextContentAndRecordExternalContentTaint({ agentUrl: url,
        context: security.trustedSecurityContext(extra), source: 'managed-tool.run',
        label: 'approved local tool output', rawContent: text }));
    return reply(input.id, { content: [{ type: 'text', text: ingress.text }],
      ...(ingress.blocked ? { isError: true } : {}) });
  } catch (error) {
    return reply(input.id, { isError: true,
      content: [{ type: 'text', text: MANAGED_TOOL_DENIAL_TEXT }] });
  }
}

async function main(): Promise<void> {
  receiver();
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (Buffer.byteLength(line) > 65536) throw Error('Oversized MCP frame');
    let id: unknown = null;
    try {
      const request = JSON.parse(line) as JsonRpc;
      id = request.id;
      const result = await handleManagedMcpRequest(request);
      if (result) process.stdout.write(JSON.stringify(result) + '\n');
    } catch {
      process.stdout.write(JSON.stringify(error(id, -32603, 'Private MCP call failed')) + '\n');
    }
  }
}

if (require.main === module) void main().catch(() => { process.exitCode = 1; });
