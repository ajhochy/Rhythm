/**
 * Unit tests for opencode_agent_writer.ts — manager routing preamble injection.
 *
 * Strategy: the preamble-injection logic lives in the exported
 * `injectManagerPreamble` helper and is also exercised via the exported
 * `MANAGER_ROUTING_PREAMBLE` constant. We test these directly rather than
 * calling `writeAgentProfileFile`, which is guarded by `shouldWriteAgentFile`
 * (returns false in test env and in postgres mode) and touches the real
 * filesystem. This gives deterministic, side-effect-free coverage of the
 * core correctness requirement.
 */

import { describe, it, expect } from 'vitest';
import {
  MANAGER_ROUTING_PREAMBLE,
  injectManagerPreamble,
  buildHubRoutingPreamble,
  buildTaskDelegatePermissions,
} from '../opencode_agent_writer';

const MARKER = '## Routing (mandatory)';

describe('MANAGER_ROUTING_PREAMBLE', () => {
  it('contains the mandatory routing marker heading', () => {
    expect(MANAGER_ROUTING_PREAMBLE).toContain(MARKER);
  });

  it('mentions subagent_type="workflow-orchestrator" explicitly', () => {
    expect(MANAGER_ROUTING_PREAMBLE).toContain('subagent_type="workflow-orchestrator"');
  });
});

describe('injectManagerPreamble — non-manager profile (isManager: false)', () => {
  it('does NOT inject the preamble', () => {
    const original = 'You are a research assistant.';
    const result = injectManagerPreamble(original, false);

    expect(result).toBe(original);
    expect(result).not.toContain(MARKER);
  });

  it('returns an empty body unchanged', () => {
    expect(injectManagerPreamble('', false)).toBe('');
  });

  it('does NOT inject even when a roster is passed (isManager gates everything)', () => {
    const original = 'You are a research assistant.';
    const result = injectManagerPreamble(original, false, ['theologian', 'librarian']);
    expect(result).toBe(original);
  });
});

describe('buildHubRoutingPreamble', () => {
  it('lists every roster id and routes domain work via the `task` tool (#891)', () => {
    const roster = ['theologian', 'AI-Trend-Researcher', 'fantasy-gm'];
    const result = buildHubRoutingPreamble(roster);

    // #891: engine-native `task`/subagent_type (nests), NOT rhythm_delegate (orphans).
    expect(result).not.toContain('rhythm_delegate');
    expect(result).toContain('`task` tool');
    expect(result).toContain('subagent_type');
    for (const id of roster) {
      expect(result).toContain(id);
    }
  });

});

describe('buildTaskDelegatePermissions', () => {
  it('issue-1014: fails closed while allowing every current profile delegate', () => {
    // Regression caught: the profile roster updates its prompt text but leaves
    // the engine task permission map on a stale, pre-edit allowlist.
    expect(buildTaskDelegatePermissions(['config-doctor', 'theologian'])).toEqual({
      '*': 'deny',
      'config-doctor': 'allow',
      theologian: 'allow',
    });
  });
});
