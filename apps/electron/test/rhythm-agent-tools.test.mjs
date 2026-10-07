import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_TOOL_DESCRIPTORS,
  AGENT_TOOLS_CATALOG_ROUTE,
  createAgentToolAdapterRegistry,
  findAgentTool,
  registerAgentToolAdapter,
} from '../src/rhythm-agent-tools.mjs';

test('AT-REG-01 registry is frozen static metadata mapped to the real existing routes', () => {
  assert.ok(Object.isFrozen(AGENT_TOOL_DESCRIPTORS));
  assert.deepEqual(AGENT_TOOL_DESCRIPTORS.map((tool) => [tool.id, tool.route]), [
    ['hermes', '/hermes'],
    ['bot-crossing', '/colony'],
    ['open-design', '/open-design'],
    // Frozen Dayflow owner packet: ToolWorkspace slug `dayflow` mounts the owner's named export DayflowTool.
    ['dayflow', '/tools/dayflow'],
  ]);
  assert.equal(AGENT_TOOLS_CATALOG_ROUTE, '/tools/agent-tools');
  for (const tool of AGENT_TOOL_DESCRIPTORS) {
    assert.ok(Object.isFrozen(tool) && Object.isFrozen(tool.capabilities) && Object.isFrozen(tool.permissions));
    for (const key of ['label', 'description', 'service', 'artifact', 'lifecycle']) assert.equal(typeof tool[key], 'string', `${tool.id}.${key}`);
    assert.ok(tool.capabilities.length > 0 && tool.permissions.length > 0);
  }
});

test('AT-REG-02 defaults keep existing tabs pinned and Dayflow unpinned; coordinator is never a tool', () => {
  assert.deepEqual(Object.fromEntries(AGENT_TOOL_DESCRIPTORS.map((tool) => [tool.id, tool.defaultPinned])), {
    hermes: true, 'bot-crossing': true, 'open-design': true, dayflow: false,
  });
  assert.equal(findAgentTool('coordinator'), null);
  assert.ok(!AGENT_TOOL_DESCRIPTORS.some((tool) => /coordinator/i.test(`${tool.id} ${tool.label}`)));
});

test('AT-REG-03 user-facing descriptions carry no service, lifecycle, or packaging details', () => {
  for (const tool of AGENT_TOOL_DESCRIPTORS) assert.doesNotMatch(tool.description, /service|lifecycle|host|artifact|package|build|launch|loopback/i, tool.id);
});

test('AT-REG-04 explicit adapters accept only one known tool ID and never execute registration input', () => {
  const registry = createAgentToolAdapterRegistry();
  let called = false;
  const adapter = Object.freeze({ open: () => { called = true; } });
  assert.equal(registerAgentToolAdapter(registry, 'open-design', adapter), adapter);
  assert.equal(registry.get('open-design'), adapter);
  assert.equal(called, false);
  assert.throws(() => registerAgentToolAdapter(registry, 'unknown', adapter), /known Agent Tool/);
  assert.throws(() => registerAgentToolAdapter(registry, 'coordinator', adapter), /known Agent Tool/);
  assert.throws(() => registerAgentToolAdapter(registry, 'open-design', adapter), /already registered/);
  assert.throws(() => registerAgentToolAdapter(new Map(), 'hermes', null), /invalid/);
  assert.throws(() => registerAgentToolAdapter({}, 'hermes', adapter), /registry is invalid/);
});
