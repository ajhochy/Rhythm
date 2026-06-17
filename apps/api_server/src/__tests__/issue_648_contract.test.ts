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

  // The opencode engine does NOT register a `google` provider (the
  // opencode-gemini-auth plugin supplies auth but no model catalog), so a direct
  // `providerID: 'google'` route resolves to ProviderModelNotFoundError. Gemini
  // must route via OpenRouter. This guards the fix where reporting google as
  // authed made the resolver pick a dead direct-google route.
  it('no agent uses a direct providerID:google route (opencode has no google provider)', () => {
    for (const [agent, routes] of Object.entries(ROUTE_FALLBACKS_BY_AGENT)) {
      for (const r of routes) {
        if (r.providerID === 'google') {
          throw new Error(
            `Agent "${agent}" has a direct google route (${r.modelID}); opencode has no google provider, so route Gemini via OpenRouter instead.`,
          );
        }
      }
    }
  });
});
