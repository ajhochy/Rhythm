import { beforeEach, describe, expect, it, vi } from 'vitest';

// A profile save must not wait for a slow engine config reload (one unresponsive MCP server
// holds it ~60s); saves during an in-flight reload coalesce into exactly one follow-up.
const reloads: Array<() => void> = [];
const reloadConfig = vi.fn(() => new Promise<boolean>((resolve) => { reloads.push(() => resolve(true)); }));
vi.mock('../services/opencode_engine', () => ({ opencodeClient: { reloadConfig } }));

beforeEach(() => { reloads.length = 0; reloadConfig.mockClear(); });

describe('reloadAgentProfilesBestEffort', () => {
  it('returns after the wait cap while the reload keeps running', async () => {
    const { reloadAgentProfilesBestEffort } = await import('../controllers/agent_configs_controller');
    const started = Date.now();
    await reloadAgentProfilesBestEffort(30);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
    reloads.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('coalesces saves during an in-flight reload into one follow-up pass', async () => {
    const { reloadAgentProfilesBestEffort } = await import('../controllers/agent_configs_controller');
    await reloadAgentProfilesBestEffort(5);
    await reloadAgentProfilesBestEffort(5);
    await reloadAgentProfilesBestEffort(5);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
    reloads.shift()!();
    await vi.waitFor(() => expect(reloadConfig).toHaveBeenCalledTimes(2));
    reloads.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    expect(reloadConfig).toHaveBeenCalledTimes(2);
  });
});
