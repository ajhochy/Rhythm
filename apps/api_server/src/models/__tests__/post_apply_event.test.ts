/**
 * D2.1 (#1431) — the post-apply monitor/repair/revert lifecycle model.
 *
 * Regression this guards: a caller widening `changeType`/`guardrailStatus`/
 * `revertStatus` past their closed set (e.g. a typo'd status string) should
 * be rejected by the type predicates rather than silently accepted, and the
 * repair-attempts array parser must never let malformed JSON crash a caller.
 */
import { describe, expect, it } from 'vitest';

import {
  GUARDRAIL_STATUSES,
  MAX_REPAIR_ATTEMPTS,
  POST_APPLY_CHANGE_TYPES,
  POST_APPLY_REVERT_STATUSES,
  isPostApplyChangeType,
  parseRepairProposalIds,
} from '../post_apply_event';

describe('D2.1 PostApplyEvent model', () => {
  it('closes the changeType set to prompt|tool|scope', () => {
    expect(POST_APPLY_CHANGE_TYPES).toEqual(['prompt', 'tool', 'scope']);
    expect(isPostApplyChangeType('prompt')).toBe(true);
    expect(isPostApplyChangeType('tool')).toBe(true);
    expect(isPostApplyChangeType('scope')).toBe(true);
    // Bug this catches: a caller passing an unrelated/typo'd kind (e.g. the
    // proposal `kind` string 'refine-config') must not be accepted as a
    // valid PostApplyEvent.changeType.
    expect(isPostApplyChangeType('refine-config')).toBe(false);
    expect(isPostApplyChangeType('')).toBe(false);
  });

  it('closes the guardrailStatus set to monitoring|clear|tripped', () => {
    expect(GUARDRAIL_STATUSES).toEqual(['monitoring', 'clear', 'tripped']);
  });

  it('closes the revertStatus set to none|reverted|not_needed|revert_failed', () => {
    expect(POST_APPLY_REVERT_STATUSES).toEqual(['none', 'reverted', 'not_needed', 'revert_failed']);
  });

  it('caps repair attempts at 3', () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(3);
  });

  it('parseRepairProposalIds parses a JSON string[] and never throws on malformed input', () => {
    expect(parseRepairProposalIds('["p1","p2"]')).toEqual(['p1', 'p2']);
    // Bug this catches: malformed/foreign JSON crashing the monitor loop
    // instead of degrading to an empty attempt list.
    expect(parseRepairProposalIds('not json')).toEqual([]);
    expect(parseRepairProposalIds('{"not":"an array"}')).toEqual([]);
    expect(parseRepairProposalIds('[1,2,"p3"]')).toEqual(['p3']);
  });
});
