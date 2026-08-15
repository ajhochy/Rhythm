/**
 * W5 — the default-dry-run operator script
 * (contract docs/ai/contracts/issue-W5-shadow-reconciler.json).
 *
 *  - W5-c7:  the default invocation is dry-run, prints stable JSON, and
 *            mutates nothing.
 *  - W5-c8:  `--apply` may only retire/supersede stale metadata. It must never
 *            write allowedMcpsJson, allowedSkillsJson or corePermissionsJson —
 *            asserted by comparing the target scope bytes before and after.
 *  - W5-c12: neither run may advance agent_org_proposals.revision. That column
 *            is the lifecycle CAS token, and an AFTER UPDATE trigger bumps it
 *            on ANY update of the table, so the retirement record lives in a
 *            sidecar.
 *
 * The logic under test lives in `src/services/org_proposal_reconciler.ts`;
 * `scripts/reconcile-org-proposals.ts` is a thin wrapper, because tsconfig's
 * rootDir excludes scripts/ from the build and from typechecking.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { getDb, setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { runReconcileCli } from '../org_proposal_reconciler';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

function scopeBytes(): string {
  return JSON.stringify(
    getDb()
      .prepare('SELECT id, allowed_mcps_json, allowed_skills_json, core_permissions_json FROM agent_configs ORDER BY id')
      .all(),
  );
}

function proposalRows(): string {
  return JSON.stringify(getDb().prepare('SELECT * FROM agent_org_proposals ORDER BY id').all());
}

/** One profile plus one ACTIVE legacy scope row — the audit's real shape. */
async function seedLegacyActiveRow(id = 'legacy-row'): Promise<void> {
  new AgentConfigsRepository().insert({
    id: 'secretary',
    label: 'Secretary',
    icon: 'x',
    allowedMcpsJson: JSON.stringify(['rhythm', 'later-addition']),
  });
  const repo = new AgentOrgProposalsRepository();
  const created = await repo.createAsync({
    id,
    kind: 'prune-scope',
    risk: 'high',
    status: 'proposed',
    title: id,
    dedupKey: `dedup-${id}`,
    targetRef: 'secretary',
    changeJson: JSON.stringify({ agentConfigId: 'secretary', field: 'allowedMcpsJson', remove: ['dead'] }),
    beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['rhythm', 'dead']) }),
  });
  getDb().prepare('UPDATE agent_org_proposals SET status = ? WHERE id = ?').run('active', created.id);
}

describe('W5-c7: the default invocation is dry-run, prints stable JSON, and changes nothing', () => {
  it('with no flags it reports and mutates nothing', async () => {
    await seedLegacyActiveRow();
    const before = proposalRows();
    const beforeScope = scopeBytes();

    const lines: string[] = [];
    const result = await runReconcileCli([], { now: NOW, write: (line) => lines.push(line) });

    expect(result.applied).toBe(false);
    expect(result.retired).toEqual([]);
    expect(proposalRows()).toBe(before);
    expect(scopeBytes()).toBe(beforeScope);

    const printed = JSON.parse(lines.join('\n')) as Record<string, unknown>;
    expect(printed.mode).toBe('dry-run');
    expect((printed.activeScope as { total: number }).total).toBe(1);
  });

  it('prints byte-identical JSON across two runs with the same clock', async () => {
    await seedLegacyActiveRow();
    const first: string[] = [];
    const second: string[] = [];
    await runReconcileCli([], { now: NOW, write: (line) => first.push(line) });
    await runReconcileCli([], { now: NOW, write: (line) => second.push(line) });
    expect(second.join('\n')).toBe(first.join('\n'));
  });

  it('reports stuck measurements alongside the scope rows', async () => {
    const repo = new AgentOrgProposalsRepository();
    const created = await repo.createAsync({
      id: 'stuck', kind: 'refine-skill', risk: 'high', status: 'proposed',
      title: 'stuck', dedupKey: 'dedup-stuck', changeJson: '{}',
    });
    await repo.updateStatusAsync(created.id, 'applied');
    await repo.updateStatusAsync(created.id, 'measuring');
    getDb()
      .prepare('UPDATE agent_org_proposals SET updated_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:00.000Z', 'stuck');

    const lines: string[] = [];
    await runReconcileCli([], { now: NOW, write: (line) => lines.push(line) });
    const printed = JSON.parse(lines.join('\n')) as {
      stuckMeasurements: { inconclusive: Array<{ proposalId: string }> };
    };
    expect(printed.stuckMeasurements.inconclusive.map((r) => r.proposalId)).toEqual(['stuck']);
  });
});

describe('W5-c8: --apply may only retire metadata, never permissions', () => {
  it('target scope bytes are byte-identical before and after an --apply run', async () => {
    await seedLegacyActiveRow();
    const beforeScope = scopeBytes();

    const result = await runReconcileCli(['--apply'], { now: NOW, write: () => {} });

    expect(result.applied).toBe(true);
    expect(result.retired).toEqual(['legacy-row']);
    expect(scopeBytes()).toBe(beforeScope);
  });

  it('an effective row is left alone — --apply only touches rows that need a human', async () => {
    // No proposals at all: nothing to retire, and nothing written.
    new AgentConfigsRepository().insert({ id: 'secretary', label: 'S', icon: 'x' });
    const before = proposalRows();
    const result = await runReconcileCli(['--apply'], { now: NOW, write: () => {} });
    expect(result.retired).toEqual([]);
    expect(proposalRows()).toBe(before);
  });

  it('the retirement is durable and inspectable', async () => {
    await seedLegacyActiveRow();
    await runReconcileCli(['--apply'], { now: NOW, write: () => {} });

    const rows = getDb()
      .prepare('SELECT proposal_id, classification FROM agent_org_proposal_retirements ORDER BY proposal_id')
      .all() as Array<{ proposal_id: string; classification: string }>;
    expect(rows).toEqual([{ proposal_id: 'legacy-row', classification: 'unsafe-legacy-rollback' }]);
  });

  it('is idempotent — a second --apply retires nothing new and rewrites nothing', async () => {
    await seedLegacyActiveRow();
    await runReconcileCli(['--apply'], { now: NOW, write: () => {} });
    const afterFirst = getDb().prepare('SELECT * FROM agent_org_proposal_retirements').all();

    const second = await runReconcileCli(['--apply'], { now: NOW, write: () => {} });
    expect(second.retired).toEqual([]);
    expect(getDb().prepare('SELECT * FROM agent_org_proposal_retirements').all()).toEqual(afterFirst);
  });
});

describe('W5-c12: neither mode advances the lifecycle CAS token', () => {
  it('agent_org_proposals rows, revision included, are byte-identical after --apply', async () => {
    // Bug this catches: recording the retirement on the proposal row itself.
    // The AFTER UPDATE auto-bump trigger would advance `revision` for a fact
    // that is not a domain change, invalidating any CAS token an approve/apply/
    // revert/measure operation is holding in flight.
    await seedLegacyActiveRow();
    const before = proposalRows();

    await runReconcileCli(['--apply'], { now: NOW, write: () => {} });

    expect(proposalRows()).toBe(before);
  });

  it('a row already marked reconciliation-required is never moved out of it', async () => {
    // That status is terminal for every automatic path.
    const repo = new AgentOrgProposalsRepository();
    const created = await repo.createAsync({
      id: 'terminal', kind: 'refine-skill', risk: 'high', status: 'proposed',
      title: 'terminal', dedupKey: 'dedup-terminal', changeJson: '{}',
    });
    getDb()
      .prepare('UPDATE agent_org_proposals SET status = ? WHERE id = ?')
      .run('reconciliation-required', created.id);
    const before = proposalRows();

    await runReconcileCli(['--apply'], { now: NOW, write: () => {} });

    expect(proposalRows()).toBe(before);
  });
});
