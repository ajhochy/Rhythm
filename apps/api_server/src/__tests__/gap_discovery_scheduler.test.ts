/**
 * Tests for gap_discovery_scheduler.ts (#1112 — Discovery-004: gap-driven,
 * not timer-only, discovery).
 *
 * Two halves:
 *  - scheduleGapDrivenDiscovery: the debounce/coalesce shape, mirroring
 *    harvested_skill_evaluator.ts's #1109 scheduleIdleEvaluation tests
 *    exactly (fake timers, injectable runFn).
 *  - runGapDrivenDiscoveryPass: the pass itself — role gate, #746 cold-start
 *    gate, bounded backlog slicing (oldest-first), and the dedicated
 *    per-pass budget passed to runExternalDiscoveryGenerator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentCapabilityGapsRepository } from '../repositories/agent_capability_gaps_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import type { OrgAuditGap } from '../services/org_audit_service';
import type { ExternalCandidate } from '../services/generators/external_discovery_generator';
import {
  scheduleGapDrivenDiscovery,
  runGapDrivenDiscoveryPass,
  _resetGapDiscoverySchedulerForTests,
} from '../services/gap_discovery_scheduler';

// #746 cold-start mock — controls the engine-ready timestamp per test. A
// pass-through factory (mirrors issue_850_contract.test.ts's identical
// pattern): without this, gap_discovery_scheduler.ts's static import of
// isEngineColdStart and this file's own dynamic `import('../services/
// skill_extractor')` (used to call notifyEngineReady) can resolve to two
// different module instances under vite-node's dynamic-import caching,
// silently decoupling the two from the same `_engineReadyAt` state.
vi.mock('../services/skill_extractor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/skill_extractor')>();
  return { ...actual };
});

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const FULL_PROVENANCE = {
  source: 'npm',
  stars: 100,
  lastUpdated: '2026-06-01',
  maintainer: 'example-org',
  license: 'MIT',
  installCommand: 'npx -y @example/mcp-server',
};

async function seedGap(title: string, tags: string[] = []): Promise<void> {
  await new AgentCapabilityGapsRepository().insertIfAbsentAsync({
    intentTitle: title,
    intentTags: tags,
  });
}

beforeEach(() => {
  setDb(makeDb());
});

// ── scheduleGapDrivenDiscovery — debounce/coalesce shape (mirrors #1109) ────

describe('#1112 — scheduleGapDrivenDiscovery debounces a gap burst into one pass', () => {
  const REAL_DEBOUNCE_MS = process.env.RHYTHM_GAP_DISCOVERY_DEBOUNCE_MS;

  beforeEach(() => {
    _resetGapDiscoverySchedulerForTests();
    vi.useFakeTimers();
    process.env.RHYTHM_GAP_DISCOVERY_DEBOUNCE_MS = '1000';
  });

  afterEach(() => {
    _resetGapDiscoverySchedulerForTests();
    vi.useRealTimers();
    if (REAL_DEBOUNCE_MS === undefined) delete process.env.RHYTHM_GAP_DISCOVERY_DEBOUNCE_MS;
    else process.env.RHYTHM_GAP_DISCOVERY_DEBOUNCE_MS = REAL_DEBOUNCE_MS;
  });

  it('does not run the pass synchronously — it is scheduled, not immediate', () => {
    const runFn = vi.fn().mockResolvedValue(undefined);
    scheduleGapDrivenDiscovery(runFn);
    expect(runFn).not.toHaveBeenCalled();
  });

  it('runs the pass exactly once after the debounce window elapses', async () => {
    const runFn = vi.fn().mockResolvedValue(undefined);
    scheduleGapDrivenDiscovery(runFn);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of gap inserts into ONE pass, not one per gap', async () => {
    const runFn = vi.fn().mockResolvedValue(undefined);
    // Simulates several harvester sessions each recording a new gap in quick
    // succession — exactly the burst #1112 must collapse.
    scheduleGapDrivenDiscovery(runFn);
    scheduleGapDrivenDiscovery(runFn);
    scheduleGapDrivenDiscovery(runFn);
    scheduleGapDrivenDiscovery(runFn);

    await vi.advanceTimersByTimeAsync(1000);

    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('a pass AFTER a previous one completes schedules again (not permanently coalesced)', async () => {
    const runFn = vi.fn().mockResolvedValue(undefined);
    scheduleGapDrivenDiscovery(runFn);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runFn).toHaveBeenCalledTimes(1);

    scheduleGapDrivenDiscovery(runFn);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runFn).toHaveBeenCalledTimes(2);
  });

  it('never throws when the scheduled pass rejects', async () => {
    const runFn = vi.fn().mockRejectedValue(new Error('boom'));
    expect(() => scheduleGapDrivenDiscovery(runFn)).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('defaults to the real runGapDrivenDiscoveryPass when no runFn is injected (production call shape)', async () => {
    expect(() => scheduleGapDrivenDiscovery()).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
  });
});

// ── runGapDrivenDiscoveryPass — the pass itself ─────────────────────────────

describe('#1112 — runGapDrivenDiscoveryPass', () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.RHYTHM_GAP_DISCOVERY_MAX_GAPS_PER_PASS;
    delete process.env.RHYTHM_GAP_DISCOVERY_MAX_PROPOSALS_PER_PASS;
    delete process.env.RHYTHM_ROLE;
  });

  it('is a no-op when there are no open gaps — never calls discoverCandidates', async () => {
    const discoverCandidates = vi.fn().mockResolvedValue([]);
    const result = await runGapDrivenDiscoveryPass({ discoverCandidates });
    expect(discoverCandidates).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: false, gapsConsidered: 0, emitted: 0 });
  });

  it('considers only the oldest maxGapsPerPass() open gaps (bounded backlog drain)', async () => {
    process.env.RHYTHM_GAP_DISCOVERY_MAX_GAPS_PER_PASS = '2';
    await seedGap('gap one');
    await seedGap('gap two');
    await seedGap('gap three');
    await seedGap('gap four');

    let seenGaps: OrgAuditGap[] = [];
    const discoverCandidates = vi.fn(async (gaps: OrgAuditGap[]) => {
      seenGaps = gaps;
      return [] as ExternalCandidate[];
    });

    const result = await runGapDrivenDiscoveryPass({ discoverCandidates });

    expect(result.gapsConsidered).toBe(2);
    expect(seenGaps).toHaveLength(2);
    // listOpenAsync orders by created_at ASC -> the two OLDEST gaps.
    expect(seenGaps.map((g) => g.intentTitle)).toEqual(['gap one', 'gap two']);
  });

  it('passes a dedicated per-pass proposal budget to the discovery generator, independent of any shared cap', async () => {
    process.env.RHYTHM_GAP_DISCOVERY_MAX_PROPOSALS_PER_PASS = '1';
    await seedGap('gap alpha', ['alpha']);
    await seedGap('gap beta', ['beta']);

    const discoverCandidates = vi.fn(async (gaps: OrgAuditGap[]) =>
      gaps.map(
        (g): ExternalCandidate => ({
          kind: 'mcp',
          name: `server-for-${g.intentTitle}`,
          gapId: g.gapId,
          provenance: { ...FULL_PROVENANCE },
        }),
      ),
    );

    const proposalsRepo = new AgentOrgProposalsRepository();
    const result = await runGapDrivenDiscoveryPass({ discoverCandidates, proposalsRepo });

    // Two candidates were discoverable, but the per-pass budget caps emission at 1.
    expect(result.emitted).toBe(1);
    expect((await proposalsRepo.listProposedAsync())).toHaveLength(1);
  });

  it('never throws when discoverCandidates rejects — degrades to an errored result', async () => {
    await seedGap('gap that triggers a failing search');
    const discoverCandidates = vi.fn().mockRejectedValue(new Error('registry unreachable'));
    const result = await runGapDrivenDiscoveryPass({ discoverCandidates });
    expect(result.errored).toBe(true);
  });

  it('#746 cold-start guard: skips the pass entirely while the engine is within its cold-start window', async () => {
    const { notifyEngineReady, _resetEngineReadyForTests } = await import('../services/skill_extractor');
    _resetEngineReadyForTests();
    notifyEngineReady(Date.now()); // engine just became ready -> inside the 90s window
    await seedGap('gap during cold start');

    const discoverCandidates = vi.fn().mockResolvedValue([]);
    const result = await runGapDrivenDiscoveryPass({ discoverCandidates });

    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toMatch(/cold-start/i);
    expect(discoverCandidates).not.toHaveBeenCalled();

    _resetEngineReadyForTests();
  });

  it('role gate: skips entirely when agent execution is disabled for this deployment role', async () => {
    process.env.RHYTHM_ROLE = 'cloud';
    vi.resetModules();
    const fresh = await import('../services/gap_discovery_scheduler');

    const discoverCandidates = vi.fn().mockResolvedValue([]);
    const result = await fresh.runGapDrivenDiscoveryPass({ discoverCandidates });

    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toMatch(/role/i);
    expect(discoverCandidates).not.toHaveBeenCalled();

    delete process.env.RHYTHM_ROLE;
    vi.resetModules();
  });
});
