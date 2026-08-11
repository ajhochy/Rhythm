import { describe, expect, it } from 'vitest';
import { McpAppCapabilityBroker } from '../services/mcp_app_capability_broker';

const binding = {
  sessionId: 'session', callId: 'call', serverName: 'origin',
  resourceUri: 'ui://origin/view', mode: 'interactive' as const,
  contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

describe('issue #1353 MCP App capability broker', () => {
  it('issue-1353-c2: opaque capability is exact-binding and finite', async () => {
    const broker = new McpAppCapabilityBroker({now: () => 1_000, randomId: () => 'opaque-cap'});
    const cap = broker.issue({...binding, expiresAt: 31_000});
    expect(cap).toEqual({id:'opaque-cap', expiresAt:'1970-01-01T00:00:31.000Z'});
    expect(JSON.stringify(cap)).not.toMatch(/origin|ui:|sha256|session|call/);
    let forwards = 0;
    const result = await broker.consume({capabilityId:cap.id, binding, correlationId:'req-1', payload:{method:'next-gate'}}, async request => { forwards++; return request.payload; });
    expect(result).toEqual({method:'next-gate'});
    expect(forwards).toBe(1);
  });

  it('issue-1353-c3: replay, expiry, malformed and every mismatch forward zero', async () => {
    let now = 1_000;
    const broker = new McpAppCapabilityBroker({now: () => now, randomId: () => 'cap'});
    const cap = broker.issue({...binding, expiresAt: 2_000});
    let forwards = 0;
    const forward = async () => { forwards++; return 'bad'; };
    const hostile = [
      {capabilityId:cap.id, binding:{...binding, sessionId:'other'}, correlationId:'x', payload:{}},
      {capabilityId:cap.id, binding:{...binding, callId:'other'}, correlationId:'x', payload:{}},
      {capabilityId:cap.id, binding:{...binding, serverName:'other'}, correlationId:'x', payload:{}},
      {capabilityId:cap.id, binding:{...binding, resourceUri:'ui://other/view'}, correlationId:'x', payload:{}},
      {capabilityId:cap.id, binding:{...binding, mode:'readonly' as const}, correlationId:'x', payload:{}},
      {capabilityId:cap.id, binding:{...binding, contentHash:'sha256:bbbb'}, correlationId:'x', payload:{}},
      {capabilityId:cap.id, binding, correlationId:'', payload:{}},
    ];
    for (const request of hostile) await expect(broker.consume(request, forward)).rejects.toThrow('capability_denied');
    expect(forwards).toBe(0);
    now = 2_000;
    await expect(broker.consume({capabilityId:cap.id,binding,correlationId:'x',payload:{}},forward)).rejects.toThrow('capability_denied');
    expect(forwards).toBe(0);

    now = 1_000;
    const fresh = broker.issue({...binding, expiresAt:1_500});
    await broker.consume({capabilityId:fresh.id,binding,correlationId:'once',payload:{}}, async () => 'ok');
    await expect(broker.consume({capabilityId:fresh.id,binding,correlationId:'once',payload:{}},forward)).rejects.toThrow('capability_denied');
    expect(forwards).toBe(0);
  });
});
