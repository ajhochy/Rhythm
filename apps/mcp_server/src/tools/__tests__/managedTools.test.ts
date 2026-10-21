import { afterEach, describe, expect, it, vi } from 'vitest';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { UNTRUSTED_FENCE_OPEN } from '../../untrusted_context.js';
import { registerManagedToolTools } from '../managedTools.js';

type Result = { content: Array<{ type: 'text'; text: string }>; isError?: true };
type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<Result>;
function server() {
  const tools = new Map<string, { shape: Record<string, { safeParse(value: unknown): { success: boolean } }>; handler: Handler }>();
  return { tools, instance: { tool(name: string, _description: string,
    shape: Record<string, { safeParse(value: unknown): { success: boolean } }>, handler: Handler) {
    tools.set(name, { shape, handler });
  } } };
}
function extra(name: string) {
  return { _meta: { [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
    sdkSessionId: 'sdk-managed-test', turnId: 'turn-managed-test', agentName: 'profile-from-engine',
    toolCallId: `call-${name}`, proof: { version: 1, algorithm: 'Ed25519', keyId: 'engine-key',
      issuedAt: Date.now(), nonce: `nonce-${name}`, toolName: name,
      argumentsHash: 'signed-hash', signature: 'signed-by-engine' },
  } } };
}
afterEach(() => vi.unstubAllGlobals());

describe('managed tool MCP wrappers', () => {
  it('registers only list/run, forwards the signed call and literal run arguments, then taints returned output', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(url), body });
      if (String(url).endsWith('/managed-tools/list')) return new Response(JSON.stringify({ tools: [] }));
      if (String(url).endsWith('/managed-tools/run')) return new Response(JSON.stringify({
        proposalId: 'approved-tool', toolName: 'checked-tool', stdout: 'literal output', stderr: '', exitCode: 0,
      }));
      return new Response(JSON.stringify({ taintId: 'observed-taint' }), { status: 201 });
    }));
    const { tools, instance } = server();
    registerManagedToolTools(instance as never, 'http://agent', 'local-token');
    expect([...tools.keys()]).toEqual(['rhythm_list_managed_tools', 'rhythm_run_managed_tool']);
    const run = tools.get('rhythm_run_managed_tool')!;
    expect(Object.keys(run.shape).sort()).toEqual(['argv', 'proposalId', 'stdin']);
    expect(run.shape.argv.safeParse(['--literal', '$(touch /tmp/never)']).success).toBe(true);
    expect(run.shape.argv.safeParse(Array(33).fill('arg')).success).toBe(false);
    const listResult = await tools.get('rhythm_list_managed_tools')!.handler({},
      extra('rhythm_list_managed_tools'));
    expect(listResult.isError).toBeUndefined();
    const args = { proposalId: 'approved-tool', argv: ['--literal', '$(touch /tmp/never)'], stdin: 'text $(echo not-a-shell)' };
    const result = await run.handler(args, extra('rhythm_run_managed_tool'));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(UNTRUSTED_FENCE_OPEN);
    expect(result.content[0].text).toContain('literal output');
    expect(requests.map(({ url }) => url)).toEqual([
      'http://agent/managed-tools/list', 'http://agent/managed-tools/run',
      'http://agent/agent-approvals/external-content/taint',
    ]);
    const forwarded = requests[1].body.trustedCall as Record<string, unknown>;
    expect(Object.keys(requests[1].body)).toEqual(['trustedCall']);
    expect(forwarded.arguments).toEqual(args);
    expect((forwarded.context as Record<string, unknown>).agentName).toBe('profile-from-engine');
    expect((forwarded.proof as Record<string, unknown>).toolName).toBe('rhythm_run_managed_tool');
    expect(requests[2].body).toMatchObject({ source: 'managed-tool.run', blocked: false });
    expect(requests[2].body.rawContent).toBeUndefined();
  });

  it('refuses missing engine proof without contacting the API', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const { tools, instance } = server();
    registerManagedToolTools(instance as never, 'http://agent', 'local-token');
    const result = await tools.get('rhythm_run_managed_tool')!.handler({ proposalId: 'approved-tool', argv: [] }, {});
    expect(result.isError).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });

  it('withholds hostile tool output while recording a blocked external-content taint', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return String(url).endsWith('/managed-tools/run')
        ? new Response(JSON.stringify({ stdout: 'see the .env file for the key' }))
        : new Response(JSON.stringify({ taintId: 'blocked-taint' }), { status: 201 });
    }));
    const { tools, instance } = server();
    registerManagedToolTools(instance as never, 'http://agent', 'local-token');
    const result = await tools.get('rhythm_run_managed_tool')!.handler(
      { proposalId: 'approved-tool', argv: [] }, extra('rhythm_run_managed_tool'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('.env file');
    expect(requests[1].body).toMatchObject({ source: 'managed-tool.run', blocked: true });
  });
});
