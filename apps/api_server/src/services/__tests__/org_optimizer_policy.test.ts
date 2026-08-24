/**
 * W5 — org optimizer policy (contract docs/ai/contracts/issue-W5-shadow-reconciler.json).
 *
 *  - W5-c1: the mode parser is pure, defaults to `shadow`, accepts ONLY the
 *    four exact literals, and resolves every other input to `shadow` — never
 *    to `auto`. Absent, empty, whitespace, wrong-case, unknown, and hostile
 *    values are all covered.
 *  - W5-c2: change families can be disabled independently, and a disabled
 *    family is refused for generation/auto-apply regardless of the global mode
 *    (including `auto`). A human-approved apply/revert is a different path and
 *    is deliberately NOT expressible through this predicate.
 */

import { describe, expect, it } from 'vitest';

import {
  CHANGE_FAMILIES,
  DEFAULT_OPTIMIZER_MODE,
  changeFamilyForKind,
  isChangeFamilyEnabled,
  isGenerationAllowedForKind,
  parseOptimizerMode,
  parseOptimizerPolicy,
} from '../org_optimizer_policy';

describe('W5-c1: the optimizer mode parser resolves everything unrecognised to shadow', () => {
  it('defaults to shadow', () => {
    expect(DEFAULT_OPTIMIZER_MODE).toBe('shadow');
    expect(parseOptimizerMode(undefined)).toBe('shadow');
    expect(parseOptimizerMode(null)).toBe('shadow');
  });

  it('accepts exactly the four documented literals', () => {
    expect(parseOptimizerMode('off')).toBe('off');
    expect(parseOptimizerMode('shadow')).toBe('shadow');
    expect(parseOptimizerMode('human_only')).toBe('human_only');
    expect(parseOptimizerMode('auto')).toBe('auto');
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['leading/trailing whitespace around auto', ' auto '],
    ['trailing newline after auto', 'auto\n'],
    ['wrong case', 'AUTO'],
    ['mixed case', 'Shadow'],
    ['unknown word', 'yolo'],
    ['injection-ish compound', 'AUTO;off'],
    ['comma list containing auto', 'shadow,auto'],
    ['hyphenated variant', 'human-only'],
    ['number', 1],
    ['boolean', true],
    ['object', { mode: 'auto' }],
    ['array', ['auto']],
  ])('resolves %s to shadow, never auto', (_label, value) => {
    expect(parseOptimizerMode(value)).toBe('shadow');
  });

  it('is pure — the same input always yields the same result and nothing is captured', () => {
    const first = parseOptimizerPolicy({ mode: 'auto', disabledFamilies: 'scope' });
    const second = parseOptimizerPolicy({ mode: 'auto', disabledFamilies: 'scope' });
    expect(second.mode).toBe(first.mode);
    expect([...second.disabledFamilies]).toEqual([...first.disabledFamilies]);
  });

  it('an invalid mode inside a full policy still lands on shadow', () => {
    expect(parseOptimizerPolicy({ mode: 'AUTO' }).mode).toBe('shadow');
    expect(parseOptimizerPolicy({}).mode).toBe('shadow');
  });
});

describe('W5-c2: per-change-family kill switches are refused regardless of the global mode', () => {
  it('maps every real proposal kind to a known family', () => {
    for (const kind of [
      'prune-scope', 'tighten-scope', 'broaden-scope', 'refine-scope',
      'refine-skill', 'consolidate-skill', 'workflow-prompt-fix', 'publish-skill-to-org',
      'create-recipe', 'refine-recipe', 'refine-config', 'refine-task',
      'create-agent', 'grant-delegation', 'expand-delegation',
      'external-adoption', 'webhook-wiring',
    ]) {
      expect(CHANGE_FAMILIES).toContain(changeFamilyForKind(kind));
    }
  });

  it('an unknown kind resolves to a family that can be disabled, never to "always allowed"', () => {
    expect(CHANGE_FAMILIES).toContain(changeFamilyForKind('some-future-kind'));
  });

  it('each family can be disabled independently, leaving the others enabled', () => {
    const policy = parseOptimizerPolicy({ mode: 'auto', disabledFamilies: 'scope' });
    expect(isChangeFamilyEnabled(policy, 'scope')).toBe(false);
    for (const family of CHANGE_FAMILIES) {
      if (family === 'scope') continue;
      expect(isChangeFamilyEnabled(policy, family)).toBe(true);
    }
  });

  it('a disabled family is refused even under mode=auto', () => {
    for (const mode of ['off', 'shadow', 'human_only', 'auto']) {
      const policy = parseOptimizerPolicy({ mode, disabledFamilies: 'scope,recipe' });
      expect(isGenerationAllowedForKind(policy, 'prune-scope')).toBe(false);
      expect(isGenerationAllowedForKind(policy, 'refine-recipe')).toBe(false);
      expect(isGenerationAllowedForKind(policy, 'refine-skill')).toBe(true);
    }
  });

  it('an unrecognised family name in the disable list disables nothing and throws nothing', () => {
    const policy = parseOptimizerPolicy({ mode: 'auto', disabledFamilies: 'not-a-family' });
    for (const family of CHANGE_FAMILIES) {
      expect(isChangeFamilyEnabled(policy, family)).toBe(true);
    }
  });

  it('tolerates spacing and empty entries in the disable list', () => {
    const policy = parseOptimizerPolicy({ mode: 'auto', disabledFamilies: ' scope , , webhook ' });
    expect(isChangeFamilyEnabled(policy, 'scope')).toBe(false);
    expect(isChangeFamilyEnabled(policy, 'webhook')).toBe(false);
    expect(isChangeFamilyEnabled(policy, 'skill')).toBe(true);
  });
});
