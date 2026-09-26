/**
 * Workstream A class 1 — the failure nobody was told about.
 *
 * On 2026-09-18 the pco-services MCP server died because its Python venv had
 * been deleted. The #892 preflight caught it correctly and failed each run in
 * ~22ms with an accurate, actionable message — which then went into a
 * run-history row and a log line, and nowhere a person looks. Five daily and
 * weekly schedules failed that way for three days before anyone noticed.
 *
 * The missing piece was never better detection. It was one notification.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('../services/agent_notifications', () => ({
  pushAgentNotification: mockPush,
  AGENT_NOTIFICATION_MAX_LENGTH: 200,
}));

import { notifyInfraFailureOnce } from '../services/agentSchedulerService';

const MCP_DOWN =
  '[required_mcp_unavailable] AgentRunner: required MCP unavailable: pco-services (failed — check the server configuration and restart it)';

describe('Workstream A — user-actionable scheduled failures reach the user', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notifies on the first run that fails with a user-actionable cause', () => {
    notifyInfraFailureOnce('pco-song-usage-sync', null, MCP_DOWN, 'required_mcp_unavailable');

    expect(mockPush).toHaveBeenCalledOnce();
    const [title, body] = mockPush.mock.calls[0];
    expect(title).toContain('pco-song-usage-sync');
    expect(body).toContain('pco-services');
  });

  it('stays quiet while the same cause repeats, so three days is one notice', () => {
    notifyInfraFailureOnce('pco-song-usage-sync', MCP_DOWN, MCP_DOWN, 'required_mcp_unavailable');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('notifies again when the cause changes', () => {
    notifyInfraFailureOnce(
      'ai-trend-research-daily',
      MCP_DOWN,
      '[authentication] AgentRunner: Anthropic account "personal" needs re-login',
      'authentication',
    );
    expect(mockPush).toHaveBeenCalledOnce();
  });

  it('stays quiet for causes the user cannot act on', () => {
    // A transient engine restart fixes itself on the next tick; waking someone
    // up for it is how a notification channel gets muted.
    notifyInfraFailureOnce('daily-dev-summary', null, '[restart_interruption] x', 'restart_interruption');
    notifyInfraFailureOnce('daily-dev-summary', null, '[engine_not_ready] x', 'engine_not_ready');
    notifyInfraFailureOnce('daily-dev-summary', null, '[model_quality] x', 'model_quality');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('never lets a notification failure break the scheduler tick', () => {
    mockPush.mockImplementation(() => {
      throw new Error('db is gone');
    });
    expect(() =>
      notifyInfraFailureOnce('worship-volunteer-care', null, MCP_DOWN, 'required_mcp_unavailable'),
    ).not.toThrow();
  });
});
