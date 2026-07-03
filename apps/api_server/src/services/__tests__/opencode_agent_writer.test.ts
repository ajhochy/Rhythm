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
} from '../opencode_agent_writer';

const MARKER = '## Routing (mandatory)';
const HUB_MARKER = '## Routing (mandatory — hub)';

describe('MANAGER_ROUTING_PREAMBLE', () => {
  it('contains the mandatory routing marker heading', () => {
    expect(MANAGER_ROUTING_PREAMBLE).toContain(MARKER);
  });

  it('mentions subagent_type="workflow-orchestrator" explicitly', () => {
    expect(MANAGER_ROUTING_PREAMBLE).toContain('subagent_type="workflow-orchestrator"');
  });
});

describe('injectManagerPreamble — manager profile (isManager: true)', () => {
  it('prepends the preamble before the original system prompt', () => {
    const original = 'You are Secretary.\n\nHelp the user manage their schedule.';
    const result = injectManagerPreamble(original, true);

    // Body must start with the preamble heading.
    expect(result.startsWith(MARKER)).toBe(true);
    // Original system prompt must still be present after the preamble.
    expect(result).toContain(original);
    // Preamble must appear before the original content.
    expect(result.indexOf(MARKER)).toBeLessThan(result.indexOf('You are Secretary'));
  });

  it('is idempotent — re-writing does NOT duplicate the preamble', () => {
    const original = 'You are Secretary.\n\nHelp the user manage their schedule.';
    const once = injectManagerPreamble(original, true);
    const twice = injectManagerPreamble(once, true);

    // Count occurrences of the marker.
    const count = (twice.match(/## Routing \(mandatory\)/g) ?? []).length;
    expect(count).toBe(1);
    // Content should be identical after the second injection.
    expect(twice).toBe(once);
  });

  it('works correctly when the body is empty', () => {
    const result = injectManagerPreamble('', true);
    expect(result).toContain(MARKER);
    expect(result.startsWith(MARKER)).toBe(true);
  });

  it('separates preamble and existing body with a blank line', () => {
    const original = 'Some prompt.';
    const result = injectManagerPreamble(original, true);
    // The preamble ends and then a blank line separates it from the body.
    expect(result).toContain(MANAGER_ROUTING_PREAMBLE + '\n\n' + original);
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

describe('injectManagerPreamble — hub manager with a non-empty roster (#889)', () => {
  const roster = ['theologian', 'librarian', 'worship-planning', 'worship-production'];
  const original = 'You are Secretary. Delegate to the approved specialist.';

  it('contains rhythm_delegate, the roster ids, and the coding hand-off; omits the old blanket line', () => {
    const result = injectManagerPreamble(original, true, roster);

    expect(result).toContain('rhythm_delegate');
    for (const id of roster) {
      expect(result).toContain(id);
    }
    // Coding hand-off path is preserved.
    expect(result).toContain('workflow-orchestrator');
    expect(result).toContain('subagent_type="workflow-orchestrator"');
    // The blanket dev-only instruction must NOT appear for a hub manager.
    expect(result).not.toContain('Only handle non-development tasks yourself.');
    // Original system prompt is preserved.
    expect(result).toContain(original);
  });

  it('uses the distinct hub marker, not the plain dev-manager marker', () => {
    const result = injectManagerPreamble(original, true, roster);
    expect(result).toContain(HUB_MARKER);
  });

  it('is idempotent — re-injecting does not duplicate the hub preamble', () => {
    const once = injectManagerPreamble(original, true, roster);
    const twice = injectManagerPreamble(once, true, roster);

    const count = (twice.match(/## Routing \(mandatory — hub\)/g) ?? []).length;
    expect(count).toBe(1);
    expect(twice).toBe(once);
  });

  it('mentions the callerAgentConfigId / targetAgentConfigId / prompt call convention', () => {
    const result = injectManagerPreamble(original, true, roster);
    expect(result).toContain('callerAgentConfigId');
    expect(result).toContain('targetAgentConfigId');
    expect(result).toContain('prompt');
  });

  it('instructs handling only trivial admin work directly', () => {
    const result = injectManagerPreamble(original, true, roster);
    expect(result.toLowerCase()).toContain('trivial admin');
  });
});

describe('injectManagerPreamble — manager WITHOUT a roster stays on the plain preamble (#889)', () => {
  it('a manager with an empty roster gets the unchanged MANAGER_ROUTING_PREAMBLE', () => {
    const original = 'You are workflow-orchestrator.';
    const result = injectManagerPreamble(original, true, []);

    expect(result.startsWith(MARKER)).toBe(true);
    expect(result).not.toContain(HUB_MARKER);
    expect(result).toContain(MANAGER_ROUTING_PREAMBLE);
    expect(result).toContain('Only handle non-development tasks yourself.');
  });

  it('defaults to the plain preamble when no roster argument is passed at all', () => {
    const original = 'You are workflow-orchestrator.';
    const result = injectManagerPreamble(original, true);

    expect(result).toContain(MANAGER_ROUTING_PREAMBLE);
    expect(result).not.toContain(HUB_MARKER);
  });
});

describe('buildHubRoutingPreamble', () => {
  it('lists every roster id and names the rhythm_delegate tool', () => {
    const roster = ['theologian', 'AI-Trend-Researcher', 'fantasy-gm'];
    const result = buildHubRoutingPreamble(roster);

    expect(result).toContain('rhythm_delegate');
    for (const id of roster) {
      expect(result).toContain(id);
    }
  });
});
