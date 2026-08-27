/**
 * Unit tests for opencode_agent_writer.ts — manager routing preamble injection.
 *
 * Strategy: the preamble-injection logic lives in the exported
 * `injectManagerPreamble` helper. We test it directly rather than
 * calling `writeAgentProfileFile`, which is guarded by `shouldWriteAgentFile`
 * (returns false in test env and in postgres mode) and touches the real
 * filesystem. This gives deterministic, side-effect-free coverage of the
 * core correctness requirement.
 */

import { describe, it, expect } from 'vitest';
import {
  injectManagerPreamble,
  buildHubRoutingPreamble,
  buildTaskDelegatePermissions,
} from '../opencode_agent_writer';

const MARKER = '## Routing (mandatory)';
const HUB_MARKER = '## Routing (mandatory — hub)';

describe('injectManagerPreamble — manager profile (isManager: true)', () => {
  it('prepends the preamble before the original system prompt', () => {
    const original = 'You are Secretary.\n\nHelp the user manage their schedule.';
    const result = injectManagerPreamble(original, true, ['workflow-orchestrator'], 'secretary');

    // Body must start with the preamble heading.
    expect(result.startsWith(HUB_MARKER)).toBe(true);
    // Original system prompt must still be present after the preamble.
    expect(result).toContain(original);
    // Preamble must appear before the original content.
    expect(result.indexOf(HUB_MARKER)).toBeLessThan(result.indexOf('You are Secretary'));
  });

  it('is idempotent — re-writing does NOT duplicate the preamble', () => {
    const original = 'You are Secretary.\n\nHelp the user manage their schedule.';
    const once = injectManagerPreamble(original, true, ['workflow-orchestrator'], 'secretary');
    const twice = injectManagerPreamble(once, true, ['workflow-orchestrator'], 'secretary');

    // Count occurrences of the marker.
    const count = (twice.match(/## Routing \(mandatory — hub\)/g) ?? []).length;
    expect(count).toBe(1);
    // Content should be identical after the second injection.
    expect(twice).toBe(once);
  });

  it('works correctly when the body is empty', () => {
    const result = injectManagerPreamble('', true, ['workflow-orchestrator'], 'secretary');
    expect(result).toContain(HUB_MARKER);
    expect(result.startsWith(HUB_MARKER)).toBe(true);
  });

  it('separates preamble and existing body with a blank line', () => {
    const original = 'Some prompt.';
    const result = injectManagerPreamble(original, true, ['workflow-orchestrator'], 'secretary');
    // The preamble ends and then a blank line separates it from the body.
    expect(result).toContain(buildHubRoutingPreamble(['workflow-orchestrator'], 'secretary') + '\n\n' + original);
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
  const roster = ['theologian', 'librarian', 'worship-planning', 'worship-production', 'workflow-orchestrator'];
  const original = 'You are Secretary. Delegate to the approved specialist.';

  it('routes domain work via the `task` tool + subagent_type (NOT rhythm_delegate), ' +
      'lists the roster, keeps the coding hand-off, omits the old blanket line', () => {
    const result = injectManagerPreamble(original, true, roster);

    // #891: domain delegation must use the engine-native `task` tool (a real
    // subagent that nests under the caller), NOT the rhythm_delegate MCP tool
    // (which orphans a top-level session with no parent link).
    // #891 guard, narrowed. The defect is the SYNC `rhythm_delegate`, which never
    // sets parentSessionId and so leaves an orphaned top-level session. The
    // interactive path `rhythm_delegate_async` DOES set
    // `parentSessionId: callerSession.id` (agent_delegation_service.ts:309), so it
    // is parent-linked and must be recommended for interactive chat (#1322). The
    // old bare substring check also matched the async variant.
    expect(result).not.toMatch(/rhythm_delegate(?!_async)/);
    expect(result).toContain('rhythm_delegate_async');
    expect(result).toContain('`task` tool');
    expect(result).toContain('subagent_type');
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

  it('names the specialist explicitly via subagent_type and forbids the generic agent',
      () => {
    const result = injectManagerPreamble(original, true, roster);
    expect(result).toContain('subagent_type');
    // Same guardrail as the coding hand-off: never fall back to the generic agent.
    expect(result).toContain('"general"');
  });

  it('instructs handling only trivial admin work directly', () => {
    const result = injectManagerPreamble(original, true, roster);
    expect(result.toLowerCase()).toContain('trivial admin');
  });
});

describe('injectManagerPreamble — manager WITHOUT a roster gets no impossible mandate (#1484)', () => {
  it('a manager with an empty roster retains its non-development-only constraint', () => {
    const original = 'You are workflow-orchestrator.';
    const result = injectManagerPreamble(original, true, []);

    expect(result).toContain('Only handle non-development tasks yourself.');
    expect(result).toContain(original);
    expect(result).not.toContain('workflow-orchestrator by calling');
  });

  it('does not invent workflow-orchestrator permission when no roster argument is passed', () => {
    const original = 'You are workflow-orchestrator.';
    const result = injectManagerPreamble(original, true);

    expect(result).toContain('Only handle non-development tasks yourself.');
    expect(result).not.toContain('subagent_type="workflow-orchestrator"');
  });
});

describe('buildHubRoutingPreamble', () => {
  it('makes direct work the default and delegation an explicit exception', () => {
    const result = buildHubRoutingPreamble([
      'theologian',
      'Theological-Researcher',
      'workflow-orchestrator',
    ]);

    // Regression caught: the injected preamble used to override each profile's
    // direct-work prompt by declaring the manager a routing-only hub.
    expect(result).toContain(
      'Handle the request directly when it fits your own role, system prompt, granted ' +
        'skills, tools, and permissions.',
    );
    expect(result).toContain('Delegate only when');
    expect(result).toContain('outside your direct scope');
    expect(result).toContain(
      'a specialist capability is materially required and you lack it',
    );
    expect(result).toContain('AJ explicitly requests delegation');
    expect(result).toContain('an independently owned parallel slice justifies delegation');
    expect(result).toContain('Never delegate merely because');
    expect(result).not.toContain('Do not attempt domain or coding work yourself');
    expect(result).not.toContain('Only handle trivial admin yourself');
  });

  it('lists every roster id and routes domain work via the `task` tool (#891)', () => {
    const roster = ['theologian', 'AI-Trend-Researcher', 'fantasy-gm'];
    const result = buildHubRoutingPreamble(roster);

    // #891: engine-native `task`/subagent_type (nests), NOT rhythm_delegate (orphans).
    // #891 guard, narrowed. The defect is the SYNC `rhythm_delegate`, which never
    // sets parentSessionId and so leaves an orphaned top-level session. The
    // interactive path `rhythm_delegate_async` DOES set
    // `parentSessionId: callerSession.id` (agent_delegation_service.ts:309), so it
    // is parent-linked and must be recommended for interactive chat (#1322). The
    // old bare substring check also matched the async variant.
    expect(result).not.toMatch(/rhythm_delegate(?!_async)/);
    expect(result).toContain('rhythm_delegate_async');
    expect(result).toContain('`task` tool');
    expect(result).toContain('subagent_type');
    for (const id of roster) {
      expect(result).toContain(id);
    }
  });

  it('issue-0-c5: workflow-orchestrator routing targets coding-agent', () => {
    const result = injectManagerPreamble(
      'You are the workflow manager.',
      true,
      ['coding-agent', 'verification-gate'],
      'workflow-orchestrator',
    );

    expect(result).toContain('subagent_type="coding-agent"');
    expect(result).not.toContain('subagent_type="workflow-orchestrator"');
  });
});

describe('buildTaskDelegatePermissions', () => {
  it('issue-1014: fails closed while allowing every current profile delegate', () => {
    // Regression caught: the profile roster updates its prompt text but leaves
    // the engine task permission map on a stale, pre-edit allowlist.
    expect(buildTaskDelegatePermissions(['config-doctor', 'theologian'])).toEqual({
      '*': 'deny',
      // #1322 — the engine-native subagents are always granted: `task` is FOR
      // read-only fan-out inside a profile. Crossing a profile boundary is the
      // explicit roster below. Fail-closed is unchanged — `*` still denies.
      explore: 'allow',
      general: 'allow',
      'config-doctor': 'allow',
      theologian: 'allow',
    });
  });

  it('#1322: excludes the caller from its own roster (self-delegation is token burn)', () => {
    // 47 calls / 7.2% of all cross-profile task traffic was self-delegation.
    // A stale roster entry must not reintroduce it.
    const map = buildTaskDelegatePermissions(
      ['coding-agent', 'workflow-orchestrator'],
      'workflow-orchestrator',
    );
    expect(map['workflow-orchestrator']).toBeUndefined();
    expect(map['coding-agent']).toBe('allow');
    expect(map['*']).toBe('deny');
  });

  it('#1322: a non-manager gets the natives and NO cross-profile delegate', () => {
    // Previously a non-manager got no `task` key at all and inherited the engine
    // default `"*": "allow"` — unrestricted delegation to any profile.
    expect(buildTaskDelegatePermissions([], 'ui-ux-designer')).toEqual({
      '*': 'deny',
      explore: 'allow',
      general: 'allow',
    });
  });
});
