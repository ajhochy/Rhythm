import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMemoryDirPath } from '../config/env';
import type { WorkstreamReferenceInput } from '../contracts/agent_workstream_contract';
import { AgentMemoryRepository, type AgentMemory } from '../repositories/agent_memory_repository';
import type { ManagedContextReference } from '../repositories/managed_workstream_context_repository';
import { parseNote, vaultKeyToMemoryDirRelative } from './memoryVaultSyncService';
import { resolveWithinMemoryDir } from './memoryVaultWriteService';

export interface WorkstreamArtifactReceipt {
  kind: 'local_artifact' | 'jsonl_row' | 'memory_vault';
  canonicalId: string;
  observedVersion: string;
  observedHash: string;
  verified: boolean;
  reason: string | null;
  /** JSONL records are preexisting evidence only; this coordinator never writes them. */
  evidenceState?: 'preexisting';
  jsonlOffset?: number;
  jsonlRowId?: string;
  jsonlRowHash?: string;
  sourceNamespace?: 'memory-vault';
  sourceInstance?: string;
  indexMemoryId?: string;
}

export interface QualifiedWorkstreamArtifact {
  selector: string;
  receipt: WorkstreamArtifactReceipt;
  eligible: boolean;
  managedReference: ManagedContextReference | null;
}

export class WorkstreamArtifactResolutionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const MEMORY_SELECTOR = /^memory:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function sameOwner(memory: AgentMemory, ownerUserId: number): boolean {
  return memory.ownerUserId === null || memory.ownerUserId === ownerUserId;
}

function activeMemory(memory: AgentMemory): boolean {
  if (memory.status === 'deprecated') return false;
  const today = new Date().toISOString().slice(0, 10);
  return memory.staleAfter === null || memory.staleAfter >= today;
}

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sameNormalizedContent(left: string, right: string): boolean {
  return left.replace(/\r\n/g, '\n').trim() === right.replace(/\r\n/g, '\n').trim();
}

/**
 * The server-owned authority resolver. Browser clients can name only an
 * indexed memory selector and their already-stored expected reference; they
 * never supply bytes, a filesystem path, a hash receipt, or a generic grant.
 */
export class WorkstreamArtifactAuthorityResolver {
  private readonly memory: AgentMemoryRepository;
  private readonly memoryRoot: () => string;

  constructor(options: {
    memory?: AgentMemoryRepository;
    memoryRoot?: () => string;
  } = {}) {
    this.memory = options.memory ?? new AgentMemoryRepository();
    this.memoryRoot = options.memoryRoot ?? resolveMemoryDirPath;
  }

  async resolveReference(input: {
    ownerUserId: number;
    projectId: string;
    workstreamId: string;
    workstreamRevision: number;
    reference: WorkstreamReferenceInput;
  }): Promise<QualifiedWorkstreamArtifact> {
    if (input.reference.scope !== input.projectId) {
      throw new WorkstreamArtifactResolutionError('reference_scope_mismatch');
    }
    if (input.reference.sourceId.startsWith('dayflow:')) {
      throw new WorkstreamArtifactResolutionError('dayflow_reference_unavailable');
    }
    const selector = MEMORY_SELECTOR.exec(input.reference.sourceId);
    if (!selector) throw new WorkstreamArtifactResolutionError('reference_authority_unavailable');
    const indexMemoryId = selector[1];
    const memory = await this.memory.findByIdAsync(indexMemoryId);
    if (!memory || !sameOwner(memory, input.ownerUserId) ||
        memory.source !== 'obsidian-memory' || !memory.sourceId || !activeMemory(memory)) {
      throw new WorkstreamArtifactResolutionError('reference_authority_unavailable');
    }
    // A duplicate index row for one canonical source is an ambiguity, not an
    // excuse to choose whichever row happened to be returned first.
    const sameSource = await this.memory.findBySourceIdsAsync(
      'obsidian-memory', [memory.sourceId], input.ownerUserId,
    );
    if (sameSource.length !== 1 || sameSource[0].id !== memory.id) {
      throw new WorkstreamArtifactResolutionError('reference_authority_ambiguous');
    }

    const rootPath = path.resolve(this.memoryRoot());
    let root: string;
    let rootStat: Awaited<ReturnType<typeof fs.lstat>>;
    let raw: Buffer;
    try {
      root = await fs.realpath(rootPath);
      rootStat = await fs.lstat(root);
      if (!rootStat.isDirectory()) throw new Error('memory_root_not_directory');
      const relative = vaultKeyToMemoryDirRelative(rootPath, memory.sourceId);
      const candidate = resolveWithinMemoryDir(rootPath, relative);
      const before = await fs.lstat(candidate);
      if (!before.isFile() || (before.mode & 0o444) === 0) throw new Error('memory_source_not_readable');
      const canonicalPath = await fs.realpath(candidate);
      if (!containedBy(root, canonicalPath)) throw new Error('memory_source_escaped');
      raw = await fs.readFile(canonicalPath);
      const after = await fs.lstat(candidate);
      if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
        throw new Error('memory_source_changed_during_read');
      }
    } catch {
      throw new WorkstreamArtifactResolutionError('reference_authority_unavailable');
    }

    const parsed = parseNote(raw.toString('utf8'));
    if (
      parsed.status !== memory.status ||
      (parsed.staleAfter ?? null) !== memory.staleAfter ||
      !sameNormalizedContent(parsed.content, memory.content)
    ) {
      throw new WorkstreamArtifactResolutionError('reference_authority_stale');
    }
    const observedHash = hash(raw);
    const observedVersion = `sha256:${observedHash}`;
    const sourceInstance = hash(JSON.stringify([
      'rhythm.memory-vault.source-instance.v1', root, rootStat.dev, rootStat.ino,
    ]));
    const receipt: WorkstreamArtifactReceipt = {
      kind: 'memory_vault',
      canonicalId: memory.sourceId,
      observedVersion,
      observedHash,
      verified: observedVersion === input.reference.expectedVersion,
      reason: observedVersion === input.reference.expectedVersion ? null : 'reference_version_stale',
      evidenceState: 'preexisting',
      sourceNamespace: 'memory-vault',
      sourceInstance,
      indexMemoryId: memory.id,
    };
    const eligible = receipt.verified && activeMemory(memory);
    return {
      selector: input.reference.sourceId,
      receipt,
      eligible,
      managedReference: eligible ? {
        schemaVersion: 1,
        dependencyId: hash(JSON.stringify([
          'rhythm.managed-workstream.memory-authority.v1',
          sourceInstance,
          memory.sourceId,
          observedVersion,
        ])),
        canonicalId: memory.sourceId,
        observedVersion,
        observedHash,
        sourceNamespace: 'memory-vault',
        sourceInstance,
        ownerUserId: input.ownerUserId,
        projectId: input.projectId,
        workstreamId: input.workstreamId,
        workstreamRevision: input.workstreamRevision,
        provenance: 'selected_source',
        lane: 'metadata-only',
      } : null,
    };
  }
}

/** Pure verifier retained for pre-qualified byte snapshots and focused tests. */
export class WorkstreamArtifactVerifier {
  verifyLocalArtifact(input: {
    canonicalId: string; observedVersion: string; bytes: Buffer; expectedHash: string;
  }): WorkstreamArtifactReceipt {
    const observedHash = hash(input.bytes);
    return {
      kind: 'local_artifact', canonicalId: input.canonicalId, observedVersion: input.observedVersion,
      observedHash, verified: observedHash === input.expectedHash,
      reason: observedHash === input.expectedHash ? null : 'artifact_hash_mismatch',
      evidenceState: 'preexisting',
    };
  }

  /**
   * Exact-row JSONL receipt. Every non-empty line must be complete JSON;
   * malformed/truncated unrelated data is unsafe because it prevents proving a
   * stable append boundary. Complete unrelated appends are tolerated.
   */
  verifyJsonlRow(input: {
    canonicalId: string; observedVersion: string; jsonl: string; rowId: string; expectedRowHash: string;
  }): WorkstreamArtifactReceipt {
    const lines = input.jsonl.split(/\n/);
    const matches: Array<{ raw: string; offset: number }> = [];
    let offset = 0;
    for (const lineWithDelimiter of lines) {
      const raw = lineWithDelimiter.endsWith('\r')
        ? lineWithDelimiter.slice(0, -1)
        : lineWithDelimiter;
      if (raw.length > 0) {
        let parsed: Record<string, unknown>;
        try {
          const candidate = JSON.parse(raw);
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('jsonl_row_not_record');
          parsed = candidate as Record<string, unknown>;
        } catch {
          return {
            kind: 'jsonl_row', canonicalId: input.canonicalId, observedVersion: input.observedVersion,
            observedHash: '', verified: false, reason: 'jsonl_row_unreadable_or_truncated',
            evidenceState: 'preexisting',
          };
        }
        if (parsed.id === input.rowId) matches.push({ raw, offset });
      }
      // split() omits the newline itself, except that the final empty segment
      // has no delimiter. Count exactly the original bytes for a stable offset.
      offset += Buffer.byteLength(lineWithDelimiter, 'utf8') + 1;
    }
    if (matches.length !== 1) {
      return {
        kind: 'jsonl_row', canonicalId: input.canonicalId, observedVersion: input.observedVersion,
        observedHash: '', verified: false,
        reason: matches.length === 0 ? 'jsonl_row_unreadable_or_missing' : 'jsonl_row_conflict',
        evidenceState: 'preexisting',
      };
    }
    const observedHash = hash(matches[0].raw);
    return {
      kind: 'jsonl_row', canonicalId: input.canonicalId, observedVersion: input.observedVersion,
      observedHash, verified: observedHash === input.expectedRowHash,
      reason: observedHash === input.expectedRowHash ? null : 'jsonl_row_hash_mismatch',
      evidenceState: 'preexisting',
      jsonlOffset: matches[0].offset,
      jsonlRowId: input.rowId,
      jsonlRowHash: observedHash,
    };
  }
}
