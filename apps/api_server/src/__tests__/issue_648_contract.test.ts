/**
 * CONTRACT TESTS — issue #648
 * "Agents model catalog offers an invalid model id (openrouter/google/gemini-3-flash → ProviderModelNotFoundError)"
 *
 * Acceptance criteria (parsed from issue body):
 *   c1: ROUTE_FALLBACKS_BY_AGENT['gemini-cli'] does NOT contain the invalid OpenRouter
 *       model id `google/gemini-3-flash` (which triggers ProviderModelNotFoundError).
 *   c2: ROUTE_FALLBACKS_BY_AGENT['gemini-cli'] still contains at least one valid
 *       OpenRouter Gemini flash entry (catalog must not go empty; only the invalid
 *       id is replaced, not the slot).
 *   c3: No entry in ANY agent's fallback list uses the bare `google/gemini-3-flash`
 *       model id via the openrouter provider (regression guard for other agents).
 *
 * These tests MUST FAIL before the fix in agent_model_resolver.ts and PASS after.
 */

import { describe, it, expect } from 'vitest';
import { ROUTE_FALLBACKS_BY_AGENT } from '../services/agent_model_resolver';

describe('issue-648: ROUTE_FALLBACKS_BY_AGENT does not contain invalid Gemini model id', () => {
  it('issue-648-c1: gemini-cli fallbacks do not include openrouter/google/gemini-3-flash', () => {
    const routes = ROUTE_FALLBACKS_BY_AGENT['gemini-cli'] ?? [];
    const hasInvalid = routes.some(
      (r) => r.providerID === 'openrouter' && r.modelID === 'google/gemini-3-flash',
    );
    expect(hasInvalid).toBe(false);
  });

  it('issue-648-c2: gemini-cli fallbacks still have at least one valid openrouter gemini flash entry', () => {
    const routes = ROUTE_FALLBACKS_BY_AGENT['gemini-cli'] ?? [];
    const validFlash = routes.some(
      (r) =>
        r.providerID === 'openrouter' &&
        r.modelID.startsWith('google/') &&
        r.modelID.toLowerCase().includes('flash') &&
        r.modelID !== 'google/gemini-3-flash',
    );
    expect(validFlash).toBe(true);
  });

  it('issue-648-c3: no agent uses openrouter + google/gemini-3-flash (regression guard)', () => {
    for (const [agent, routes] of Object.entries(ROUTE_FALLBACKS_BY_AGENT)) {
      for (const r of routes) {
        if (r.providerID === 'openrouter' && r.modelID === 'google/gemini-3-flash') {
          throw new Error(
            `Agent "${agent}" still has the invalid openrouter model id "google/gemini-3-flash". Replace with a valid OpenRouter model id (e.g. google/gemini-3-flash-preview).`,
          );
        }
      }
    }
  });

  // Direct google routes are valid ONLY with model ids that exist in the
  // opencode-gemini-auth plugin's catalog (verify with `opencode models google`).
  // The historical `gemini-3-pro-preview` / `gemini-3-flash` ids do NOT exist and
  // caused ProviderModelNotFoundError — guard against their return.
  it('no agent uses a non-existent direct google model id (gemini-3-pro-preview / gemini-3-flash)', () => {
    const BAD = new Set(['gemini-3-pro-preview', 'gemini-3-flash']);
    for (const [agent, routes] of Object.entries(ROUTE_FALLBACKS_BY_AGENT)) {
      for (const r of routes) {
        if (r.providerID === 'google' && BAD.has(r.modelID)) {
          throw new Error(
            `Agent "${agent}" uses non-existent google model id "${r.modelID}". Use an id from \`opencode models google\` (e.g. gemini-2.5-pro, gemini-3.1-pro-preview).`,
          );
        }
      }
    }
  });

  it('gemini-cli still keeps an OpenRouter fallback after the direct google routes', () => {
    const routes = ROUTE_FALLBACKS_BY_AGENT['gemini-cli'] ?? [];
    expect(routes.some((r) => r.providerID === 'openrouter')).toBe(true);
  });
});
