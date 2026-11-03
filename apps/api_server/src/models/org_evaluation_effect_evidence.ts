import type { OrgEvaluationProposalKind } from './org_evaluation';

/** Observable worker or engine effects required before any kind can qualify. */
const EFFECT_EVIDENCE: Record<OrgEvaluationProposalKind, readonly string[]> = {
  'create-agent': ['profile-projected', 'agent-output'],
  'grant-delegation': ['delegation-graph-projected', 'delegated-child-executed', 'disallowed-delegate-denied'],
  'expand-delegation': ['delegation-graph-projected', 'delegated-child-executed', 'disallowed-delegate-denied'],
  'broaden-scope': ['scope-projected', 'allowed-capability-executed', 'ungranted-capability-denied'],
  'tighten-scope': ['scope-projected', 'removed-capability-denied', 'retained-capability-executed'],
  'prune-scope': ['scope-projected', 'removed-capability-denied', 'retained-capability-executed'],
  'create-recipe': ['recipe-persisted', 'recipe-selected'],
  'refine-recipe': ['recipe-persisted', 'recipe-selected'],
  'refine-skill': ['managed-skill-bytes-written', 'skill-loaded', 'agent-output'],
  'consolidate-skill': ['managed-skill-bytes-written', 'skill-loaded', 'retired-skill-unavailable'],
  'external-adoption': ['artifact-provenance-verified', 'adopted-capability-executed', 'ungranted-capability-denied'],
  'webhook-wiring': ['webhook-persisted', 'loopback-webhook-received', 'invalid-webhook-signature-denied'],
  'refine-config': ['profile-projected', 'agent-output'],
  'refine-scope': ['scope-projected', 'allowed-capability-executed', 'ungranted-capability-denied'],
  'workflow-prompt-fix': ['managed-skill-bytes-written', 'skill-loaded', 'agent-output'],
  'refine-task': ['schedule-persisted', 'scheduled-task-fired', 'agent-output'],
  'publish-skill-to-org': ['loopback-org-publish-received', 'org-skill-fetch', 'skill-loaded'],
  'tool-install': ['docker-safety-vetted', 'tool-installed', 'tool-invoked', 'forbidden-tool-effect-denied'],
};

export function requiredEffectEvidence(kind: OrgEvaluationProposalKind, changeJson?: string): readonly string[] {
  if (kind === 'publish-skill-to-org' && changeJson !== undefined) {
    try {
      const parsed: unknown = JSON.parse(changeJson);
      const action = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).action : null;
      if (action === 'unpublish') return ['loopback-org-unpublish-received', 'org-skill-unavailable', 'skill-unavailable'];
      if (action !== 'publish') return ['invalid-publication-action'];
    } catch { return ['invalid-publication-action']; }
  }
  return EFFECT_EVIDENCE[kind];
}

export function verifyObservedEffects(kind: OrgEvaluationProposalKind,
  observed: readonly string[], changeJson?: string): { verified: boolean; missing: string[] } {
  const seen = new Set(observed);
  const missing = requiredEffectEvidence(kind, changeJson).filter((event) => !seen.has(event));
  return { verified: missing.length === 0, missing };
}
