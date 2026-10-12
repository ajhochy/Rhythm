import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentMemory } from '../repositories/agent_memory_repository';
import {
  WorkstreamArtifactAuthorityResolver,
  WorkstreamArtifactResolutionError,
  WorkstreamArtifactVerifier,
} from '../services/workstream_artifact_verifier';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function indexedMemory(id: string, sourceId: string, content: string): AgentMemory {
  return {
    id,
    kind: 'fact',
    content,
    source: 'obsidian-memory',
    sourceId,
    tagsJson: '[]',
    status: 'stable',
    staleAfter: null,
    verifiedJson: '[]',
    sourcesJson: '[]',
    generatedBy: null,
    generatedAt: null,
    trustTier: 'human',
    ownerUserId: 811,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  };
}

describe('workstream artifact verifier', () => {
  it('S3-C07: verifies only an exact local artifact hash', () => {
    const verifier = new WorkstreamArtifactVerifier();
    const bytes = Buffer.from('qualified local artifact bytes', 'utf8');

    expect(verifier.verifyLocalArtifact({
      canonicalId: 'artifact:local-1', observedVersion: 'v1', bytes, expectedHash: digest(bytes),
    })).toMatchObject({ verified: true, reason: null, observedHash: digest(bytes) });
    expect(verifier.verifyLocalArtifact({
      canonicalId: 'artifact:local-1', observedVersion: 'v1', bytes, expectedHash: '0'.repeat(64),
    })).toMatchObject({ verified: false, reason: 'artifact_hash_mismatch' });
  });

  it('S3-C07/R5: binds an exact JSONL row, tolerates complete unrelated appends, and rejects malformed evidence', () => {
    const verifier = new WorkstreamArtifactVerifier();
    const target = JSON.stringify({ id: 'row-target', disposition: 'verified' });
    const unrelated = JSON.stringify({ id: 'row-later', disposition: 'unrelated' });
    const verified = verifier.verifyJsonlRow({
      canonicalId: 'artifact:journal', observedVersion: 'v7',
      jsonl: `${target}\n${unrelated}\n`,
      rowId: 'row-target', expectedRowHash: digest(target),
    });
    expect(verified).toMatchObject({
      verified: true, reason: null, observedHash: digest(target), jsonlOffset: 0,
      jsonlRowId: 'row-target', jsonlRowHash: digest(target), evidenceState: 'preexisting',
    });

    expect(verifier.verifyJsonlRow({
      canonicalId: 'artifact:journal', observedVersion: 'v7',
      jsonl: `${target}\n${target}\n`, rowId: 'row-target', expectedRowHash: digest(target),
    })).toMatchObject({ verified: false, reason: 'jsonl_row_conflict' });
    expect(verifier.verifyJsonlRow({
      canonicalId: 'artifact:journal', observedVersion: 'v7',
      jsonl: `${JSON.stringify({ id: 'row-target', disposition: 'changed' })}\n`,
      rowId: 'row-target', expectedRowHash: digest(target),
    })).toMatchObject({ verified: false, reason: 'jsonl_row_hash_mismatch' });
    expect(verifier.verifyJsonlRow({
      canonicalId: 'artifact:journal', observedVersion: 'v7',
      jsonl: `${target}\n{malformed-unrelated`, rowId: 'row-target', expectedRowHash: digest(target),
    })).toMatchObject({ verified: false, reason: 'jsonl_row_unreadable_or_truncated' });
  });

  it('R5: resolves only an owner-indexed canonical memory source and rechecks its current bytes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-workstream-evidence-'));
    const previousSubdir = process.env.MEMORY_VAULT_SUBDIR;
    process.env.MEMORY_VAULT_SUBDIR = '';
    try {
      const id = '123e4567-e89b-42d3-a456-426614174000';
      const sourceId = 'fact/qualified.md';
      const content = 'retained qualified evidence';
      const raw = `---\nid: note-qualified\nkind: fact\nstatus: stable\n---\n${content}\n`;
      fs.mkdirSync(path.join(root, 'fact'), { recursive: true });
      fs.writeFileSync(path.join(root, sourceId), raw);
      const memory = indexedMemory(id, sourceId, content);
      const repository = {
        findByIdAsync: async (candidate: string) => candidate === id ? memory : null,
        findBySourceIdsAsync: async () => [memory],
      };
      const resolver = new WorkstreamArtifactAuthorityResolver({
        memory: repository as never,
        memoryRoot: () => root,
      });
      const expectedVersion = `sha256:${digest(raw)}`;
      const input = {
        ownerUserId: 811,
        projectId: 'project-coordinator',
        workstreamId: 'workstream-1',
        workstreamRevision: 3,
        reference: {
          sourceId: `memory:${id}`,
          expectedVersion,
          scope: 'project-coordinator',
          provenance: 'trusted_reference' as const,
        },
      };

      const resolved = await resolver.resolveReference(input);
      expect(resolved).toMatchObject({
        selector: `memory:${id}`,
        eligible: true,
        receipt: {
          kind: 'memory_vault',
          canonicalId: sourceId,
          observedVersion: expectedVersion,
          observedHash: digest(raw),
          verified: true,
          evidenceState: 'preexisting',
          sourceNamespace: 'memory-vault',
          indexMemoryId: id,
        },
        managedReference: {
          canonicalId: sourceId,
          observedVersion: expectedVersion,
          observedHash: digest(raw),
          ownerUserId: 811,
          projectId: 'project-coordinator',
          workstreamId: 'workstream-1',
          workstreamRevision: 3,
        },
      });
      expect(resolved).not.toHaveProperty('bytes');
      expect(resolved).not.toHaveProperty('path');

      fs.writeFileSync(path.join(root, sourceId), `${raw}changed`);
      await expect(resolver.resolveReference(input)).rejects.toMatchObject(
        new WorkstreamArtifactResolutionError('reference_authority_stale'),
      );
      await expect(resolver.resolveReference({
        ...input,
        reference: { ...input.reference, sourceId: 'dayflow:separately-owned' },
      })).rejects.toMatchObject(new WorkstreamArtifactResolutionError('dayflow_reference_unavailable'));
      await expect(resolver.resolveReference({
        ...input,
        reference: { ...input.reference, sourceId: '/arbitrary/filesystem/path' },
      })).rejects.toMatchObject(new WorkstreamArtifactResolutionError('reference_authority_unavailable'));
    } finally {
      if (previousSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
      else process.env.MEMORY_VAULT_SUBDIR = previousSubdir;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
