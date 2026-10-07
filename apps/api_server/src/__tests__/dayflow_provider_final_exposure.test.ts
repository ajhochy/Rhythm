/**
 * Final-exposure correction: the response is re-proved synchronously after
 * every await (public admit and the actual router) and each selected canonical
 * note/index row is re-proved from the real file and owner index.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dayflowCanonicalVersion } from '../contracts/dayflow_coordinator_reader_contract';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { DayflowCanonicalEvidenceResolver } from '../services/dayflow_qualified_evidence_service';
import { MemoryIndexService } from '../services/memory_index_service';
import { createObservationIfAbsentInVault, generateUlid } from '../services/memoryVaultWriteService';
import { buildHarness, candidate, OWNER, ROOT, type Harness } from './helpers/dayflow_provider_harness';

describe('provider admission final exposure', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { vi.restoreAllMocks(); await h.close(); });

  it('actual router: unchanged useful path keeps its text through the route finalizer (positive)', async () => {
    const result = await h.admit();
    expect(result.body.decision).toBe('allow');
    expect(result.body.overlay.text).toContain('Synthetic useful handoff detail.');
  });

  it('actual router: source revoked after admit() returned and before res.json omits the text', async () => {
    const admit = h.admission.admit.bind(h.admission);
    let usefulAtAdmit = false;
    vi.spyOn(h.admission, 'admit').mockImplementation(async (...args) => {
      const out = await admit(...args);
      usefulAtAdmit = out.ok && out.response.overlay?.text.includes('Synthetic useful handoff detail.') === true;
      h.reader.candidates = []; // the route's own await boundary
      return out;
    });
    const result = await h.admit();
    expect(usefulAtAdmit).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body.overlay).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain('Synthetic useful handoff detail.');
    expect(result.body.decision).toBe('project'); // retained exposure keeps the existing project policy
    expect(h.manifest()!.userExposure.candidates).toHaveLength(1); // never clears manifests
  });

  describe('real canonical notes', () => {
    const memoryRootOf = (root: string) => join(root, 'memory');

    async function realNote(root: string, n: number, content: string) {
      const repo = new AgentMemoryRepository();
      const sourceHash = String(n).repeat(64).slice(0, 64);
      const id = generateUlid(Date.parse('2026-10-05T00:00:00.000Z') + n);
      const receipt = await createObservationIfAbsentInVault({
        id, kind: 'context', content, source: 'dayflow', tags: ['dayflow', 'activity-observation'],
        sources: [{ id: `fixture_${n}`, resource: `dayflow://card/${n}`, origin: 'dayflow', revision: sourceHash, normalizer_version: 'v2.6.0' }],
        usageWindow: { from: '2026-10-05', to: '2026-10-05' }, sourceRevision: sourceHash, normalizerVersion: 'v2.6.0',
      }, { memoryDir: memoryRootOf(root), index: new MemoryIndexService(repo, OWNER) });
      const base = candidate(n);
      return {
        selected: {
          ...base,
          reference: { ...base.reference, canonicalId: id, canonicalVersion: dayflowCanonicalVersion(receipt.canonicalContentHash), sourceHash },
          canonicalSourceKey: receipt.path, canonicalContentHash: receipt.canonicalContentHash,
          contentHash: createHash('sha256').update(content).digest('hex'),
        },
        file: join(root, receipt.path),
      };
    }

    async function seed(contents: string[]) {
      const root = mkdtempSync(join(tmpdir(), 'c2-final-exposure-'));
      h.roots.push(root);
      const notes = [];
      for (const [index, content] of contents.entries()) notes.push(await realNote(root, index + 1, content));
      h.reader.candidates = notes.map((note) => note.selected);
      const resolver = new DayflowCanonicalEvidenceResolver({ memory: new AgentMemoryRepository(), memoryRoot: () => memoryRootOf(root) });
      vi.spyOn((h.evidence as any).canonical, 'resolve').mockImplementation((value: any) => resolver.resolve(value));
      return notes;
    }

    it('clean real notes are exposed (positive control for every case below)', async () => {
      await seed(['First real canonical note.']);
      const result = await h.admit();
      expect(result.body.decision).toBe('allow');
      expect(result.body.overlay.text).toContain('First real canonical note.');
    });

    it('omits text when the note bytes are edited during the history await (hash no longer matches)', async () => {
      const [note] = await seed(['Original canonical body.']);
      h.reader.onHistoryRead = () => { appendFileSync(note.file, '\nedited later\n'); };
      const result = await h.admit();
      expect(result.body.overlay).toBeNull();
      expect(JSON.stringify(result.body)).not.toContain('Original canonical body.');
    });

    it.each([
      ['the owner index row is reassigned to another owner', `UPDATE agent_memory SET owner_user_id=99 WHERE source='obsidian-memory'`],
      ['the owner index row is detached from any owner', `UPDATE agent_memory SET owner_user_id=NULL WHERE source='obsidian-memory'`],
      ['the owner index row is deprecated', `UPDATE agent_memory SET status='deprecated' WHERE source='obsidian-memory'`],
      ['the owner index row is deleted', `DELETE FROM agent_memory WHERE source='obsidian-memory'`],
    ])('omits text when %s during the history await (no repair, no write)', async (_name, sql) => {
      await seed(['Indexed canonical body.']);
      let afterMutation = '';
      const snapshot = () => JSON.stringify(h.db.prepare(`SELECT id, owner_user_id, status FROM agent_memory WHERE source='obsidian-memory' ORDER BY id`).all());
      h.reader.onHistoryRead = () => { h.db.prepare(sql).run(); afterMutation = snapshot(); };
      const result = await h.admit();
      expect(result.body.overlay).toBeNull();
      expect(JSON.stringify(result.body)).not.toContain('Indexed canonical body.');
      expect(snapshot()).toBe(afterMutation); // the final proof is read-only: no owner repair, no write
    });

    it('keeps valid current partials and rebuilds a bounded fenced body when one note vanishes', async () => {
      const [first, second] = await seed(['Vanishing canonical note.', 'Surviving canonical note.']);
      h.reader.onHistoryRead = () => { unlinkSync(first.file); };
      const result = await h.admit();
      expect(existsSync(first.file)).toBe(false);
      expect(result.body.decision).toBe('allow');
      expect(result.body.overlay.text).toContain('Surviving canonical note.');
      expect(result.body.overlay.text).not.toContain('Vanishing canonical note.');
      expect(result.body.overlay.text).toContain('<<<UNTRUSTED_EXTERNAL_CONTENT>>>');
      expect(Buffer.byteLength(result.body.overlay.text, 'utf8')).toBeLessThanOrEqual(3800);
      expect(second.selected.reference.canonicalId).toBeTruthy();
      // both references stay as durable exposure history; nothing is cleared
      expect(h.manifest()!.userExposure.candidates).toHaveLength(2);
    });

    it('a retained old canonical dependency that vanished is no longer advertised as reusable', async () => {
      const [note] = await seed(['Old retained canonical note.']);
      // production composition wires the real resolver as the evidence canonical
      (h.evidence as any).canonical = new DayflowCanonicalEvidenceResolver({
        memory: new AgentMemoryRepository(), memoryRoot: () => memoryRootOf(h.roots[h.roots.length - 1]),
      });
      expect((await h.admit()).body.decision).toBe('allow');
      unlinkSync(note.file);
      h.reader.candidates = [note.selected]; // source fingerprint unchanged
      const after = await h.admit({}, { agentName: 'another-agent' });
      expect(after.body.decision).toBe('project');
      expect(after.body.rawHistoryReusable).toBe(false);
      expect(after.body.overlay).toBeNull();
    });
  });
});
