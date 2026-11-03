import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayflowCanonicalVersion } from '../contracts/dayflow_coordinator_reader_contract';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { DayflowCanonicalEvidenceResolver } from '../services/dayflow_qualified_evidence_service';
import { MemoryIndexService } from '../services/memory_index_service';
import { createObservationIfAbsentInVault, generateUlid } from '../services/memoryVaultWriteService';
import { buildHarness, candidate, OWNER, PROJECT, type Harness } from './helpers/dayflow_provider_harness';

describe('SOL C2 actual final exposure', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { vi.restoreAllMocks(); await h.close(); });

  it('revalidates source after the public admit awaited decision, before returning body', async () => {
    const service = h.admission as any;
    const decide = service.decide.bind(service);
    let completedUsefulDecision = false;
    vi.spyOn(service, 'decide').mockImplementation(async (...args: any[]) => {
      const decision = await decide(...args);
      completedUsefulDecision = decision.overlay?.text.includes('Synthetic useful handoff detail.') === true;
      // Exact outer-await boundary: source changes after the real inner decision,
      // before public admit() resumes and exposes its returned DTO.
      h.reader.candidates = [];
      return decision;
    });
    const result = await h.admit();
    expect(completedUsefulDecision).toBe(true);
    expect(h.reader.candidates).toEqual([]);
    expect(h.manifest()!.userExposure.candidates).toHaveLength(1);
    expect(result.body.overlay).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain('Synthetic useful handoff detail.');
  });

  it('withholds a real canonical note deleted during history await with unchanged source fingerprint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sol-c2-canonical-delete-'));
    h.roots.push(root);
    const memoryDir = join(root, 'memory');
    const repo = new AgentMemoryRepository();
    const content = 'Synthetic canonical material with a decisive deleted-note fixture.';
    const sourceHash = 'a'.repeat(64);
    const canonicalId = generateUlid(Date.parse('2026-10-05T00:00:00.000Z'));
    const receipt = await createObservationIfAbsentInVault({
      id: canonicalId, kind: 'context', content, source: 'dayflow',
      tags: ['dayflow', 'activity-observation'],
      sources: [{ id: 'sol_dayflow_fixture', resource: 'dayflow://card/1', origin: 'dayflow', revision: sourceHash, normalizer_version: 'v2.6.0' }],
      usageWindow: { from: '2026-10-05', to: '2026-10-05' },
      sourceRevision: sourceHash, normalizerVersion: 'v2.6.0',
    }, { memoryDir, index: new MemoryIndexService(repo, OWNER) });
    const selected = { ...candidate(1), reference: { ...candidate(1).reference, canonicalId,
      canonicalVersion: dayflowCanonicalVersion(receipt.canonicalContentHash), sourceHash },
      canonicalSourceKey: receipt.path, canonicalContentHash: receipt.canonicalContentHash,
      contentHash: createHash('sha256').update(content).digest('hex') };
    h.reader.candidates = [selected];
    const canonical = new DayflowCanonicalEvidenceResolver({ memory: repo, memoryRoot: () => memoryDir });
    const input = { ownerUserId: OWNER, projectId: PROJECT, candidate: selected };
    await expect(canonical.resolve(input)).resolves.toEqual({ content });
    vi.spyOn((h.evidence as any).canonical, 'resolve').mockImplementation((value: any) => canonical.resolve(value));
    const positive = await h.admit();
    expect(positive.body.decision).toBe('allow');
    expect(positive.body.overlay.text).toContain(content);
    const note = join(root, receipt.path);
    expect(existsSync(note)).toBe(true);
    h.reader.plainReads = 0;
    let deletedAtHistoryAwait = false;
    h.reader.onHistoryRead = () => { unlinkSync(note); deletedAtHistoryAwait = true; };
    const result = await h.admit();
    expect(deletedAtHistoryAwait).toBe(true);
    expect(existsSync(note)).toBe(false);
    expect(h.reader.candidates).toEqual([selected]);
    await expect(canonical.resolve(input)).resolves.toBeNull();
    expect(h.manifest()!.userExposure.candidates).toHaveLength(1);
    expect(result.body.overlay).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain(content);
  });
});
