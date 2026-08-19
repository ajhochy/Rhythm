/**
 * W6-c2 — the fail-closed evidence bundle validator.
 *
 * Rejection is TOTAL: there is no partially-valid bundle admitted with a
 * warning. Every failing element is reported by name, because an operator
 * reading "invalid bundle" learns nothing about what to fix.
 *
 * An unrecognised version is rejected, never best-effort parsed.
 */

import {
  EXPERIMENT_ADAPTERS,
  KNOWN_METRIC_NAMES,
  PROPOSAL_EVIDENCE_BUNDLE_VERSION,
  type ProposalEvidenceBundle,
} from '../models/proposal_evidence_bundle';
import { EXPLICIT_USER_VERDICT_METRIC_NAME } from '../models/feedback_metric_adapter';
import { GUARDRAIL_NAMES, isKnownGuardrailName } from '../models/guardrail_registry';

export type EvidenceValidation =
  | { valid: true; bundle: ProposalEvidenceBundle }
  | { valid: false; reasons: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function stringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

export function validateEvidenceBundle(input: unknown): EvidenceValidation {
  if (!isPlainObject(input)) {
    return { valid: false, reasons: ['the evidence bundle must be a JSON object'] };
  }

  const reasons: string[] = [];

  if (input.version !== PROPOSAL_EVIDENCE_BUNDLE_VERSION) {
    // Fail closed and stop: every element check below reads today's shape, and
    // applying it to an unrecognised version IS best-effort parsing.
    return {
      valid: false,
      reasons: [
        `unrecognised evidence bundle version '${String(input.version)}' ` +
          `(expected '${PROPOSAL_EVIDENCE_BUNDLE_VERSION}')`,
      ],
    };
  }

  const source = input.sourceEvidence;
  if (
    !isPlainObject(source) ||
    !stringArray(source.sessionIds) ||
    !stringArray(source.eventIds) ||
    source.sessionIds.length + source.eventIds.length === 0
  ) {
    reasons.push('sourceEvidence must carry at least one source session or event id');
  }

  const counter = input.counterEvidenceSearch;
  if (
    !isPlainObject(counter) ||
    !nonEmptyString(counter.query) ||
    !nonEmptyString(counter.searchedAt) ||
    typeof counter.contradictingCount !== 'number' ||
    !Number.isFinite(counter.contradictingCount)
  ) {
    reasons.push('counterEvidenceSearch must record the query, when it ran, and what it found');
  }

  const target = input.target;
  if (!isPlainObject(target) || !nonEmptyString(target.ref)) {
    reasons.push('target.ref must name what the change touches');
  }
  if (!isPlainObject(target) || !nonEmptyString(target.hash)) {
    reasons.push('target.hash must pin the exact bytes the evidence was gathered against');
  }

  if (!nonEmptyString(input.expectedOutcome)) {
    reasons.push('expectedOutcome must state what improvement is expected');
  }

  const metric = input.primaryMetric;
  if (
    !isPlainObject(metric) ||
    !nonEmptyString(metric.name) ||
    (metric.direction !== 'increase' && metric.direction !== 'decrease')
  ) {
    reasons.push('primaryMetric must name a metric and the direction that counts as better');
  } else if (!KNOWN_METRIC_NAMES.has(metric.name as string)) {
    reasons.push(
      `primaryMetric.name '${String(metric.name)}' is not a computable metric ` +
        `(known: ${[...KNOWN_METRIC_NAMES].sort().join(', ')})`,
    );
  } else if (metric.name === EXPLICIT_USER_VERDICT_METRIC_NAME) {
    // C3 — the feedback-backed metric predeclares its own coverage floor;
    // objective metrics never go silent so they need no such field.
    const coverage = metric.minResponseCoverage;
    if (typeof coverage !== 'number' || !Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
      reasons.push(
        `primaryMetric.minResponseCoverage must be a finite number in [0,1] when primaryMetric.name is ` +
          `'${EXPLICIT_USER_VERDICT_METRIC_NAME}'`,
      );
    }
  }

  if (!stringArray(input.guardrails) || input.guardrails.length === 0) {
    reasons.push('guardrails must list at least one guardrail');
  } else {
    const unknown = input.guardrails.filter((g) => !isKnownGuardrailName(g));
    if (unknown.length > 0) {
      reasons.push(
        `guardrails must be executable typed predicates from the closed registry ` +
          `(known: ${GUARDRAIL_NAMES.join(', ')}); unrecognised: ${unknown.join(', ')}`,
      );
    }
  }

  if (!nonEmptyString(input.experimentAdapter)) {
    reasons.push('experimentAdapter must name an adapter');
  } else if (!Object.hasOwn(EXPERIMENT_ADAPTERS, input.experimentAdapter as string)) {
    reasons.push(
      `experimentAdapter '${String(input.experimentAdapter)}' is not in the closed adapter registry ` +
        `(known: ${Object.keys(EXPERIMENT_ADAPTERS).sort().join(', ')})`,
    );
  }

  if (!nonEmptyString(input.rollbackRule)) {
    reasons.push('rollbackRule must state how the change is undone');
  }
  if (!nonEmptyString(input.generatorVersion)) {
    reasons.push('generatorVersion must record which generator produced this');
  }
  if (!nonEmptyString(input.confidenceCalibrationVersion)) {
    reasons.push('confidenceCalibrationVersion must record the calibration in force');
  }

  if (reasons.length > 0) return { valid: false, reasons };
  return { valid: true, bundle: input as unknown as ProposalEvidenceBundle };
}
