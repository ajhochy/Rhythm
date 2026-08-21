/**
 * D1.3 (#1428) — the `tool-install` proposal kind's structural validator.
 *
 * Registered into `org_proposal_apply_service.ts`'s `validators` map so
 * `validateProposalChange` re-checks a `tool-install` proposal's
 * `change_json` at APPLY time (never trusting what was true at propose
 * time — see that module's doc comment). Checks, in order:
 *
 *   1. `toolName`/`packageSource`/`installMethod`/`agentConfigId` are all
 *      present, non-empty strings.
 *   2. `installMethod` is a member of the CLOSED production install-method
 *      registry — deliberately narrower than `tool_sandbox_vetter.ts`'s own
 *      registry, which additionally carries a `local-script` TEST-ONLY
 *      escape hatch for exercising the sandbox without a real package
 *      registry. `local-script` treats `packageSource` as literal,
 *      pre-vetted script content; a real proposal must never be able to
 *      smuggle arbitrary shell content through that door, so it is refused
 *      here even though the vetter itself would technically execute it.
 *   3. `evidenceBundle` is present and passes the shared C5/C6 shape
 *      validator ({@link validateEvidenceBundle}) — the same bundle every
 *      other proposal kind is held to.
 *   4. `toolName` is a safe executable identifier and `packageSource` is a
 *      safe package identifier (shared with {@link tool_sandbox_vetter.ts}
 *      via `tool_install_safety.ts`) — checked BEFORE anything ever reaches
 *      the sandbox runtime that would interpolate them into a shell
 *      command. Rejection reasons never echo the untrusted value itself.
 *   5. `testPrompts` — despite the name, kept for `change_json` backward
 *      compatibility — is an array of EXACTLY 2 or 3 entries, each a member
 *      of the closed, code-owned scenario registry in
 *      `tool_test_scenarios.ts`. This is the D1 track's no-raw-prompt
 *      invariant enforced structurally: there is no way to smuggle prompt
 *      TEXT through this field at all, only a reference to a fixed,
 *      non-sensitive scenario whose actual content is resolved solely at
 *      sandbox runtime. An unrecognised identifier is refused WITHOUT ever
 *      being echoed back — only its index appears in the rejection reason.
 *   6. `agentConfigId` names a profile that actually exists.
 *   7. `evidenceBundle.target` is bound to that SAME live profile — its
 *      `ref`/`hash` must equal what {@link toProfileTargetRef} /
 *      {@link buildProfileRevisionFingerprint} compute fresh from the real
 *      row right now, so a fabricated or stale target can never pass.
 *
 * Deliberately out of scope (see the D1.3 test file's header comment): the
 * sandbox-safety gate (a `tool_safety_reports` row with a passing verdict)
 * is D1.4 (#1429), which will extend this same validator once that report
 * exists.
 */

import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { ProposalValidationResult } from './org_proposal_apply_service';
import { validateEvidenceBundle } from './proposal_evidence_validator';
import { toProfileTargetRef, buildProfileRevisionFingerprint } from './org_proposal_experiment_service';
import { isSafePackageSource, isSafeToolName } from './tool_install_safety';
import {
  TOOL_INSTALL_MAX_TEST_SCENARIOS,
  TOOL_INSTALL_MIN_TEST_SCENARIOS,
  isToolTestScenarioId,
} from './tool_test_scenarios';

/**
 * The CLOSED set of install methods a PRODUCTION `tool-install` proposal may
 * name. Deliberately excludes `tool_sandbox_vetter.ts`'s `local-script`
 * escape hatch — see module doc comment.
 */
export const TOOL_INSTALL_ALLOWED_INSTALL_METHODS = ['npm install', 'pip install'] as const;

export type ToolInstallMethod = (typeof TOOL_INSTALL_ALLOWED_INSTALL_METHODS)[number];

export function isAllowedToolInstallMethod(v: unknown): v is ToolInstallMethod {
  return (TOOL_INSTALL_ALLOWED_INSTALL_METHODS as readonly unknown[]).includes(v);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseChangeJson(proposal: AgentOrgProposal): Record<string, unknown> | null {
  if (!proposal.changeJson) return null;
  try {
    const parsed: unknown = JSON.parse(proposal.changeJson);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Validate `testPrompts` as a closed set of 2 or 3 scenario IDENTIFIERS —
 * never prompt content. NEVER includes the raw entry value in a returned
 * reason — only its index — so an unrecognised (and possibly
 * secret-shaped) value is never echoed anywhere a human or log line could
 * read it.
 */
function validateTestPrompts(value: unknown): ProposalValidationResult {
  if (!Array.isArray(value)) {
    return {
      valid: false,
      reason: 'change_json.testPrompts must be an array of closed scenario identifiers',
    };
  }
  if (value.length < TOOL_INSTALL_MIN_TEST_SCENARIOS || value.length > TOOL_INSTALL_MAX_TEST_SCENARIOS) {
    return {
      valid: false,
      reason:
        `change_json.testPrompts must name between ${TOOL_INSTALL_MIN_TEST_SCENARIOS} and ` +
        `${TOOL_INSTALL_MAX_TEST_SCENARIOS} scenario identifiers (got ${value.length})`,
    };
  }
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry: unknown = value[i];
    if (!isToolTestScenarioId(entry)) {
      return {
        valid: false,
        reason: `change_json.testPrompts[${i}] is not a recognised scenario identifier`,
      };
    }
    if (seen.has(entry)) {
      return {
        valid: false,
        reason: `change_json.testPrompts[${i}] duplicates an already-selected scenario identifier`,
      };
    }
    seen.add(entry);
  }
  return { valid: true };
}

/**
 * D1.3 — re-validate a `tool-install` proposal's `change_json` at apply
 * time. See module doc comment for the full check order.
 */
export function validateToolInstallChange(proposal: AgentOrgProposal): ProposalValidationResult {
  const change = parseChangeJson(proposal);
  if (!change) {
    return {
      valid: false,
      reason:
        'change_json must be a JSON object naming toolName, packageSource, installMethod, agentConfigId, testPrompts, and evidenceBundle',
    };
  }

  const missing: string[] = [];
  if (!nonEmptyString(change.toolName)) missing.push('toolName');
  if (!nonEmptyString(change.packageSource)) missing.push('packageSource');
  if (!nonEmptyString(change.installMethod)) missing.push('installMethod');
  if (!nonEmptyString(change.agentConfigId)) missing.push('agentConfigId');
  if (missing.length > 0) {
    return {
      valid: false,
      reason: `change_json is missing required field(s): ${missing.join(', ')}`,
    };
  }

  if (!isSafeToolName(change.toolName)) {
    return {
      valid: false,
      reason: 'change_json.toolName is not a safe executable identifier',
    };
  }

  if (!isSafePackageSource(change.packageSource)) {
    return {
      valid: false,
      reason: 'change_json.packageSource is not a safe package identifier',
    };
  }

  if (!isAllowedToolInstallMethod(change.installMethod)) {
    return {
      valid: false,
      reason:
        `change_json.installMethod is not in the closed production install-method registry ` +
        `(allowed: ${TOOL_INSTALL_ALLOWED_INSTALL_METHODS.join(', ')})`,
    };
  }

  if (!isPlainRecord(change.evidenceBundle)) {
    return { valid: false, reason: 'change_json.evidenceBundle is required' };
  }
  const evidenceValidation = validateEvidenceBundle(change.evidenceBundle);
  if (!evidenceValidation.valid) {
    return {
      valid: false,
      reason: `change_json.evidenceBundle is invalid: ${evidenceValidation.reasons.join('; ')}`,
    };
  }

  const promptsValidation = validateTestPrompts(change.testPrompts);
  if (!promptsValidation.valid) return promptsValidation;

  const agentConfigId = change.agentConfigId as string;
  const configsRepo = new AgentConfigsRepository();
  const profile = configsRepo.getById(agentConfigId);
  if (!profile) {
    return {
      valid: false,
      reason: `change_json.agentConfigId '${agentConfigId}' does not reference a live agent profile`,
    };
  }

  const expectedRef = toProfileTargetRef(agentConfigId);
  const expectedHash = buildProfileRevisionFingerprint(profile);
  const target = evidenceValidation.bundle.target;
  if (target.ref !== expectedRef || target.hash !== expectedHash) {
    return {
      valid: false,
      reason:
        `change_json.evidenceBundle.target is fabricated — it does not match the real, live agent ` +
        `profile '${agentConfigId}'`,
    };
  }

  return { valid: true };
}
