import { describe, expect, it } from 'vitest';

import { registerCoordinatorConversationTools } from '../coordinatorConversation.js';

type Tool = { name: string; description: string; schema: unknown; handler: (...args: never[]) => unknown };

function registered() {
  const tools = new Map<string, Tool>();
  registerCoordinatorConversationTools({
    tool: (name: string, description: string, schema: unknown, handler: Tool['handler']) => {
      tools.set(name, { name, description, schema, handler });
    },
  } as never, 'http://127.0.0.1:4001', 'test-token');
  return tools;
}

describe('chat-bounded-c1: Secretary exposes signed proposal/status tools without requiring opaque IDs or a setup form', () => {
  it('registers only the dedicated bounded workflow read, proposal and start entrypoints alongside existing chat tools', () => {
    const tools = registered();
    expect([...tools.keys()]).toEqual(expect.arrayContaining([
      'rhythm_get_coordinator_status',
      'rhythm_propose_bounded_coding_workflow',
      'rhythm_start_bounded_coding_workflow',
    ]));
    expect(tools.has('rhythm_start_coordinator_goal')).toBe(true);
    expect(tools.get('rhythm_propose_bounded_coding_workflow')?.description).toMatch(/estimate.*adjust|adjust.*estimate/i);
  });
});

describe('chat-bounded-c3: the approved workflow start is a dedicated signed native MCP call', () => {
  it('registers a distinct bounded start tool and does not broaden ordinary goal start', () => {
    const tools = registered();
    const bounded = tools.get('rhythm_start_bounded_coding_workflow');
    expect(bounded).toBeDefined();
    expect(bounded?.description).toMatch(/approved.*proposal|proposal.*approval/i);
    expect(tools.get('rhythm_start_coordinator_goal')?.description).not.toMatch(/finite authority|bounded workflow approval/i);
  });
});
