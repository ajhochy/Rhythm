import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentCapabilityGapsRepository } from '../repositories/agent_capability_gaps_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { scheduleGapDrivenDiscovery, runGapDrivenDiscoveryPass, _resetGapDiscoverySchedulerForTests } from '../services/gap_discovery_scheduler';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  vi.useFakeTimers();
});
afterEach(() => { _resetGapDiscoverySchedulerForTests(); vi.useRealTimers(); setDb(null); db.close(); });

describe('retired automatic gap discovery', () => {
  it('new gaps never launch external work, even after old debounce windows', async () => {
    const gaps = new AgentCapabilityGapsRepository();
    await gaps.insertIfAbsentAsync({ intentTitle: 'Synthetic recurring capability failure', intentTags: ['fixture'] });
    const before = await gaps.listOpenAsync();
    // If the retired scheduler invokes this callback, observable state changes.
    const events: string[] = [];
    for (let i = 0; i < 5; i++) scheduleGapDrivenDiscovery(async () => { events.push('external-discovery-ran'); });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(await gaps.listOpenAsync()).toEqual(before);
  });

  it('the compatibility pass cannot discover candidates or enqueue an adoption proposal', async () => {
    const gaps = new AgentCapabilityGapsRepository();
    const proposals = new AgentOrgProposalsRepository();
    await gaps.insertIfAbsentAsync({ intentTitle: 'Synthetic missing capability', intentTags: [] });
    const before = await proposals.listProposedAsync();
    let searches = 0;
    const result = await runGapDrivenDiscoveryPass({ gapsRepo: gaps, proposalsRepo: proposals, discoverCandidates: async () => { searches++; return []; } });
    expect(result).toMatchObject({ skipped: true, emitted: 0, gapsConsidered: 0, errored: false });
    expect(result.skippedReason).toContain('retired');
    expect(searches).toBe(0);
    expect(await proposals.listProposedAsync()).toEqual(before);
    expect(await gaps.listOpenAsync()).toHaveLength(1);
  });
});
