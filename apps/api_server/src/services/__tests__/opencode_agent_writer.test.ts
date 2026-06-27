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
import { MANAGER_ROUTING_PREAMBLE, injectManagerPreamble } from '../opencode_agent_writer';

const MARKER = '## Routing (mandatory)';

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
});
