/**
 * Regression guard: an MCP tool a deny-all session explicitly allows must stay reachable.
 *
 * The engine defers MCP tools behind `mcp_dispatch` unless the allowlist says
 * `deferred: false`, and a trailing wildcard deny disables `mcp_dispatch`. The
 * live coordinator coding manager was allowed exactly `rhythm_delegate_async`,
 * reported "no callable tools are available in this session", and never
 * dispatched its worker. The engine's own session record confirmed the cause:
 *   mcpAllowlist={"servers":[],"tools":["rhythm_rhythm_delegate_async",…]}
 *   permission=[{"*","*","deny"},{"rhythm_rhythm_delegate_async","*","allow"},…]
 */
import { describe, expect, it } from 'vitest';
import {
  MANAGED_READ_ONLY_PERMISSION,
  reachableMcpAllowlist,
} from '../services/opencode_client_service';

const managerPermission = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'rhythm_rhythm_delegate_async', pattern: '*', action: 'allow' },
  { permission: 'rhythm_rhythm_delegation_status', pattern: '*', action: 'allow' },
];
const managerAllowlist = { servers: [], tools: ['rhythm_rhythm_delegate_async', 'rhythm_rhythm_delegation_status'] };

describe('reachableMcpAllowlist', () => {
  it('opts the coding manager out of deferral so its allowed tool is exposed directly', () => {
    expect(reachableMcpAllowlist(managerAllowlist, managerPermission)).toEqual({ ...managerAllowlist, deferred: false });
  });

  it('applies to managed read-only sessions, whose memory tool hit the same wall', () => {
    const allowlist = { servers: [], tools: ['rhythm_rhythm_search_memory'], deferred: true };
    expect(reachableMcpAllowlist(allowlist, [...MANAGED_READ_ONLY_PERMISSION])?.deferred).toBe(false);
  });

  it('drops a legacy selective deferral list, which would otherwise re-defer those servers', () => {
    const allowlist = { ...managerAllowlist, deferredServers: ['rhythm'] };
    expect(reachableMcpAllowlist(allowlist, managerPermission)).not.toHaveProperty('deferredServers');
  });

  it('leaves deferral alone when the dispatcher is usable', () => {
    const permissive = [{ permission: '*', pattern: '*', action: 'allow' }, { permission: 'bash', pattern: '*', action: 'ask' }];
    const allowlist = { ...managerAllowlist, deferred: true };
    expect(reachableMcpAllowlist(allowlist, permissive)).toBe(allowlist);
  });

  it('honours the last matching rule, as the engine does', () => {
    const reallowed = [...managerPermission, { permission: 'mcp_dispatch', pattern: '*', action: 'allow' }];
    expect(reachableMcpAllowlist(managerAllowlist, reallowed)).toBe(managerAllowlist);
    const redenied = [{ permission: 'mcp_dispatch', pattern: '*', action: 'allow' }, ...managerPermission];
    expect(reachableMcpAllowlist(managerAllowlist, redenied)?.deferred).toBe(false);
  });

  it('passes through when there is no allowlist or no session permission', () => {
    expect(reachableMcpAllowlist(undefined, managerPermission)).toBeUndefined();
    expect(reachableMcpAllowlist(managerAllowlist, undefined)).toBe(managerAllowlist);
  });
});
