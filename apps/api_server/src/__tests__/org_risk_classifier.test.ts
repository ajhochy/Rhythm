/**
 * CONTRACT TEST for issue #820 (org-optimizer-04) — must fail before
 * implementation, then pass once org_risk_classifier.ts exists. See
 * docs/ai/contracts/issue-820.json for the criterion mapping.
 *
 * Covers:
 *  - issue-820-c1: LOW (auto) kinds classify to 'low'.
 *  - issue-820-c2: HIGH (gate) kinds classify to 'high'.
 *  - issue-820-c3: unknown/unlisted kind -> 'high' (fail-closed default).
 *  - issue-820-c4: requiresSecurityNote(kind) true only for webhook-wiring
 *    and external-adoption.
 *  - issue-820-c5: pure function — no DB, no IO, deterministic (same input,
 *    same output, across repeated calls and module re-imports).
 *  - issue-820-c6: documented hard rules enforced via a change-shape
 *    predicate — allowed_delegates_json write, agent_configs INSERT,
 *    allowlist addition, webhook-endpoint create, and external adoption are
 *    all HIGH; allowlist removal is LOW.
 */

import { describe, expect, it } from 'vitest';

describe('issue-820-c1: LOW (auto) kinds classify to low', () => {
  it('classifies refine-skill, consolidate-skill, tighten-scope, prune-scope, refine-recipe as low', async () => {
    // Bug this catches: a reversible/narrowing kind is miscategorized as
    // high, needlessly routing safe hygiene changes into the human queue.
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    const lowKinds = [
      'refine-skill',
      'consolidate-skill',
      'tighten-scope',
      'prune-scope',
      'refine-recipe',
    ];
    for (const kind of lowKinds) {
      expect(classifyProposalRisk({ kind })).toBe('low');
    }
  });
});

describe('issue-820-c2: HIGH (gate) kinds classify to high', () => {
  it('classifies create-agent, grant-delegation, expand-delegation, broaden-scope, create-recipe, webhook-wiring, external-adoption as high', async () => {
    // Bug this catches: a privilege-granting/expanding kind is
    // miscategorized as low, letting it slip onto the unattended auto-apply
    // path — the exact regression the predicate exists to prevent.
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    const highKinds = [
      'create-agent',
      'grant-delegation',
      'expand-delegation',
      'broaden-scope',
      'create-recipe',
      'webhook-wiring',
      'external-adoption',
    ];
    for (const kind of highKinds) {
      expect(classifyProposalRisk({ kind })).toBe('high');
    }
  });
});

describe('issue-820-c3: unknown/unlisted kind defaults to high (fail-closed)', () => {
  it('returns high for a kind not in either documented list', async () => {
    // Bug this catches: an unrecognized kind (typo, new kind added upstream
    // without updating the predicate) defaults to 'low', silently granting
    // auto-apply to something the predicate was never taught to gate.
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(classifyProposalRisk({ kind: 'totally-unknown-kind' })).toBe('high');
    expect(classifyProposalRisk({ kind: '' })).toBe('high');
  });
});

describe('issue-820-c4: requiresSecurityNote true only for webhook-wiring and external-adoption', () => {
  it('returns true for webhook-wiring and external-adoption, false for every other documented kind', async () => {
    // Bug this catches: the security-note gate is wired to the wrong kind
    // set, either exempting a genuinely risky kind from the note requirement
    // or forcing an unrelated kind through a UI block it doesn't need.
    const { requiresSecurityNote } = await import('../services/org_risk_classifier');
    expect(requiresSecurityNote('webhook-wiring')).toBe(true);
    expect(requiresSecurityNote('external-adoption')).toBe(true);

    const others = [
      'refine-skill',
      'consolidate-skill',
      'tighten-scope',
      'prune-scope',
      'refine-recipe',
      'create-agent',
      'grant-delegation',
      'expand-delegation',
      'broaden-scope',
      'create-recipe',
      'unknown-kind',
    ];
    for (const kind of others) {
      expect(requiresSecurityNote(kind)).toBe(false);
    }
  });
});

describe('issue-820-c5: pure function — no DB, no IO, deterministic', () => {
  it('returns the same result across repeated calls and does not touch the DB module', async () => {
    // Bug this catches: the predicate accidentally imports/queries the DB
    // (e.g. to look up a live agent_configs row) making it impure and
    // untestable without a DB fixture, contrary to the acceptance criterion.
    const mod = await import('../services/org_risk_classifier');
    const first = mod.classifyProposalRisk({ kind: 'tighten-scope' });
    const second = mod.classifyProposalRisk({ kind: 'tighten-scope' });
    const third = mod.classifyProposalRisk({ kind: 'tighten-scope' });
    expect(first).toBe('low');
    expect(first).toBe(second);
    expect(second).toBe(third);

    // Static source inspection: the module must not import the DB layer.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'org_risk_classifier.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"].*database\/db['"]/);
    expect(source).not.toMatch(/getDb\s*\(/);
  });
});

describe('issue-820-c6: documented hard rules enforced via change-shape predicate', () => {
  it('classifies a delegation-graph write as high regardless of stated kind', async () => {
    // Bug this catches: a proposal mislabels its own kind (e.g. calls itself
    // 'tighten-scope' but actually writes allowed_delegates_json) and the
    // predicate trusts the label instead of the change shape, letting a
    // delegation grant slip onto the auto-apply path.
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(
      classifyProposalRisk({
        kind: 'tighten-scope',
        changeJson: JSON.stringify({ allowed_delegates_json: ['specialist-x'] }),
      }),
    ).toBe('high');
  });

  it('classifies an agent_configs INSERT as high regardless of stated kind', async () => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(
      classifyProposalRisk({
        kind: 'refine-skill',
        changeJson: JSON.stringify({ insertAgentConfig: { name: 'new-agent' } }),
      }),
    ).toBe('high');
  });

  it('classifies an allowlist addition as high even under a low-risk kind label', async () => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(
      classifyProposalRisk({
        kind: 'tighten-scope',
        changeJson: JSON.stringify({ add: ['new_mcp_server'] }),
      }),
    ).toBe('high');
  });

  it('classifies an allowlist removal as low under tighten-scope/prune-scope', async () => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(
      classifyProposalRisk({
        kind: 'tighten-scope',
        changeJson: JSON.stringify({ remove: ['dead_mcp_server'] }),
      }),
    ).toBe('low');
  });

  it('classifies a webhook-endpoint create as high regardless of stated kind', async () => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(
      classifyProposalRisk({
        kind: 'refine-recipe',
        changeJson: JSON.stringify({ createWebhookEndpoint: { eventTypes: ['x'] } }),
      }),
    ).toBe('high');
  });

  it('classifies external=1 as high regardless of stated kind', async () => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(classifyProposalRisk({ kind: 'refine-skill', external: 1 })).toBe('high');
  });
});
