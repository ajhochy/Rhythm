/**
 * Regression guard: an MCP tool a deny-all session explicitly allows must stay reachable.
 *
 * The engine reaches MCP tools through `mcp_dispatch`, and a trailing wildcard
 * deny denies the dispatcher too. The live coordinator coding manager was
 * allowed exactly `rhythm_delegate_async`, reported "no callable tools are
 * available in this session", and never dispatched its worker. The engine's
 * own session record confirmed it:
 *   mcpAllowlist={"servers":[],"tools":["rhythm_rhythm_delegate_async",…]}
 *   permission=[{"*","*","deny"},{"rhythm_rhythm_delegate_async","*","allow"},…]
 *
 * Exposing the tools eagerly (deferred:false) was tried live and rejected: the
 * strict function schema made the model send targetRuntime "hermes", empty ids
 * and a model override, and every delegation was refused.
 */
import { describe, expect, it } from 'vitest';
import {
  MANAGED_READ_ONLY_PERMISSION,
  reachableMcpDispatcher,
} from '../services/opencode_client_service';

const allowDispatch = { permission: 'mcp_dispatch', pattern: '*', action: 'allow' };
const managerPermission = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'rhythm_rhythm_delegate_async', pattern: '*', action: 'allow' },
  { permission: 'rhythm_rhythm_delegation_status', pattern: '*', action: 'allow' },
];
const managerAllowlist = { servers: [], tools: ['rhythm_rhythm_delegate_async', 'rhythm_rhythm_delegation_status'] };

describe('reachableMcpDispatcher', () => {
  it('allows the dispatcher last for the coding manager, so its granted tool is reachable', () => {
    expect(reachableMcpDispatcher(managerPermission, managerAllowlist)).toEqual([...managerPermission, allowDispatch]);
  });

  it('applies to managed read-only sessions, whose memory tool hit the same wall', () => {
    const result = reachableMcpDispatcher([...MANAGED_READ_ONLY_PERMISSION], { servers: [], tools: ['rhythm_rhythm_search_memory'] });
    expect((result as unknown[]).at(-1)).toEqual(allowDispatch);
  });

  it('leaves a session with no MCP grant alone, so its builtins stay directly exposed', () => {
    const worker = [{ permission: '*', pattern: '*', action: 'deny' }, { permission: 'edit', pattern: 'src/x.ts', action: 'ask' }];
    expect(reachableMcpDispatcher(worker, { servers: [], tools: [] })).toBe(worker);
    expect(reachableMcpDispatcher(worker, undefined)).toBe(worker);
  });

  it('respects an explicit dispatcher deny', () => {
    const explicit = [...managerPermission, { permission: 'mcp_dispatch', pattern: '*', action: 'deny' }];
    expect(reachableMcpDispatcher(explicit, managerAllowlist)).toBe(explicit);
  });

  it('leaves a permissive session alone', () => {
    const permissive = [{ permission: '*', pattern: '*', action: 'allow' }, { permission: 'bash', pattern: '*', action: 'ask' }];
    expect(reachableMcpDispatcher(permissive, managerAllowlist)).toBe(permissive);
  });

  it('never changes the MCP allowlist itself', () => {
    const allowlist = { ...managerAllowlist, deferred: true };
    reachableMcpDispatcher(managerPermission, allowlist);
    expect(allowlist).toEqual({ ...managerAllowlist, deferred: true });
  });
});
