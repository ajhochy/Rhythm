/**
 * W5 — the org optimizer's operating policy: ONE pure module that decides how
 * much the autonomous loop is allowed to do, and which change families it may
 * touch at all.
 *
 * Two rules govern everything here:
 *
 *   1. The safest mode wins on ANY doubt. `shadow` is the default and the sink
 *      for every value that is not exactly one of the four literals. A parser
 *      that "helpfully" trims or lower-cases its input turns a typo, a stray
 *      newline from a config file, or a hostile `AUTO;off` into full write
 *      authority over agent scope — so this one matches exactly and nothing
 *      else. Never resolve an unrecognised value to `auto`.
 *
 *   2. The kill switch is a REFUSAL, not a preference. A disabled change family
 *      is refused for generation and auto-apply under every mode, `auto`
 *      included. It deliberately does NOT gate a human-approved apply or
 *      revert: a human who approved an exact preimage is a different authority
 *      from the autonomous loop, and the plan preserves that path.
 *
 * Pure by construction — no env reads, no I/O, no module state. The run loop
 * reads the environment and hands the strings in.
 */

/**
 * off        — do not run at all.
 * shadow     — audit, generate and rank; mutate nothing (the default).
 * human_only — generate for the review queue; never auto-apply.
 * auto       — the full loop, including the low-risk auto-apply lane.
 */
export type OptimizerMode = 'off' | 'shadow' | 'human_only' | 'auto';

export const OPTIMIZER_MODES = ['off', 'shadow', 'human_only', 'auto'] as const;

/** The safest mode, and the sink for every unrecognised value. */
export const DEFAULT_OPTIMIZER_MODE: OptimizerMode = 'shadow';

export const CHANGE_FAMILIES = [
  'scope',
  'skill',
  'recipe',
  'config',
  'task',
  'agent',
  'external',
  'webhook',
  'other',
] as const;

export type ChangeFamily = (typeof CHANGE_FAMILIES)[number];

const KIND_FAMILIES: Record<string, ChangeFamily> = {
  'prune-scope': 'scope',
  'tighten-scope': 'scope',
  'broaden-scope': 'scope',
  'refine-scope': 'scope',
  'refine-skill': 'skill',
  'consolidate-skill': 'skill',
  'workflow-prompt-fix': 'skill',
  'publish-skill-to-org': 'skill',
  'create-recipe': 'recipe',
  'refine-recipe': 'recipe',
  'refine-config': 'config',
  'refine-task': 'task',
  'create-agent': 'agent',
  'grant-delegation': 'agent',
  'expand-delegation': 'agent',
  'external-adoption': 'external',
  'webhook-wiring': 'webhook',
};

export interface OptimizerPolicy {
  mode: OptimizerMode;
  /** Families an operator has switched off. Refused under every mode. */
  disabledFamilies: ReadonlySet<ChangeFamily>;
}

const MODE_SET = new Set<string>(OPTIMIZER_MODES);
const FAMILY_SET = new Set<string>(CHANGE_FAMILIES);

/**
 * Exact match against the four literals, or `shadow`. No trimming, no case
 * folding: ' auto ', 'AUTO' and 'auto\n' are all unrecognised input, and
 * unrecognised input never grants write authority.
 */
export function parseOptimizerMode(value: unknown): OptimizerMode {
  if (typeof value !== 'string' || !MODE_SET.has(value)) return DEFAULT_OPTIMIZER_MODE;
  return value as OptimizerMode;
}

/**
 * An unknown kind maps to `other` rather than to an "always allowed" escape
 * hatch — a future kind must be disable-able the day it is added, not the day
 * someone remembers to extend this table.
 */
export function changeFamilyForKind(kind: string): ChangeFamily {
  return KIND_FAMILIES[kind] ?? 'other';
}

/**
 * The disable list IS operator input rather than untrusted config, so spacing
 * and empty entries are tolerated; an unrecognised family name is ignored
 * rather than thrown, because a policy parser that throws takes the whole run
 * down and a run that does not start is not safer than one that runs in shadow.
 */
export function parseOptimizerPolicy(input: {
  mode?: unknown;
  disabledFamilies?: unknown;
}): OptimizerPolicy {
  const disabled = new Set<ChangeFamily>();
  const raw = input.disabledFamilies;
  const entries = typeof raw === 'string'
    ? raw.split(',')
    : Array.isArray(raw)
      ? raw.map((entry) => String(entry))
      : [];
  for (const entry of entries) {
    const name = entry.trim();
    if (FAMILY_SET.has(name)) disabled.add(name as ChangeFamily);
  }
  return { mode: parseOptimizerMode(input.mode), disabledFamilies: disabled };
}

export function isChangeFamilyEnabled(policy: OptimizerPolicy, family: ChangeFamily): boolean {
  return !policy.disabledFamilies.has(family);
}

/**
 * May the autonomous loop GENERATE (or auto-apply) this kind at all? Purely the
 * kill switch — the mode gate is a separate, coarser question the run loop asks
 * once per phase.
 */
export function isGenerationAllowedForKind(policy: OptimizerPolicy, kind: string): boolean {
  return isChangeFamilyEnabled(policy, changeFamilyForKind(kind));
}

/** Only `auto` may write to a target on the loop's own authority. */
export function mayAutoApply(policy: OptimizerPolicy): boolean {
  return policy.mode === 'auto';
}

/**
 * `shadow` mutates nothing. `human_only` and `auto` may run the acting
 * lifecycle phases (measurement of human-approved rows, the W1 recovery sweep);
 * `off` never gets this far.
 */
export function mayMutateLifecycle(policy: OptimizerPolicy): boolean {
  return policy.mode === 'human_only' || policy.mode === 'auto';
}
