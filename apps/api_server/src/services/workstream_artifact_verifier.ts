import { createHash } from 'node:crypto';
import { promises as fs, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { env } from '../config/env';
import { getDb } from '../database/db';
import path from 'node:path';

import { resolveMemoryDirPath } from '../config/env';
import {
  SELECTED_REFERENCE_SUMMARY_CRITERION,
  type WorkstreamReferenceInput,
} from '../contracts/agent_workstream_contract';
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
  /** Server-only final synchronous proof; never serialized or persisted. */
  isCurrent?: () => boolean;
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
    const observedSize = raw.byteLength;
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
    // Legacy verifier-only callers need no database; the optional chat proof fails closed without it.
    let localDb: ReturnType<typeof getDb> | null = null;
    try { if (env.dbClient === 'sqlite') localDb = getDb(); } catch { /* no local authority */ }
    return {
      selector: input.reference.sourceId,
      receipt,
      eligible,
      isCurrent: () => {
        try {
          // The compact SQLite proof is deliberately unavailable in hosted
          // Postgres. Capture the exact local connection as well as the source.
          if (env.dbClient !== 'sqlite' || !localDb || getDb() !== localDb) return false;
          const rows = localDb.prepare(`SELECT id, content, source, source_id, owner_user_id, status, stale_after
            FROM agent_memory WHERE source='obsidian-memory' AND source_id=?
              AND (owner_user_id=? OR owner_user_id IS NULL) LIMIT 2`)
            .all(memory.sourceId, input.ownerUserId) as Array<Record<string, unknown>>;
          if (rows.length !== 1) return false;
          const current = rows[0];
          if (current.id !== memory.id || current.source_id !== memory.sourceId ||
              current.content !== memory.content || current.status !== memory.status ||
              (current.stale_after ?? null) !== memory.staleAfter ||
              (current.owner_user_id ?? null) !== memory.ownerUserId || !activeMemory(memory)) return false;
          const currentRoot = realpathSync(path.resolve(this.memoryRoot()));
          const currentRootStat = lstatSync(currentRoot);
          if (currentRoot !== root || !currentRootStat.isDirectory() ||
              currentRootStat.dev !== rootStat.dev || currentRootStat.ino !== rootStat.ino) return false;
          const candidate = resolveWithinMemoryDir(rootPath, vaultKeyToMemoryDirRelative(rootPath, memory.sourceId!));
          const before = lstatSync(candidate);
          const currentPath = realpathSync(candidate);
          if (!before.isFile() || before.size !== observedSize || (before.mode & 0o444) === 0 || !containedBy(root, currentPath)) return false;
          const bytes = readFileSync(currentPath);
          const after = lstatSync(candidate);
          return after.isFile() && after.size === observedSize && before.dev === after.dev && before.ino === after.ino &&
            hash(bytes) === observedHash && observedVersion === input.reference.expectedVersion;
        } catch { return false; }
      },
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

// ── G2 selected_reference_summary_v1 deterministic checks (S5) ───────────────
// Pure parsers/checks only. They never resolve a source themselves; the caller
// passes the server resolver's fresh result. A parsed model proposal is input
// to these checks, never a receipt by itself.

/** The exact stored expectation bound at admission. */
export interface SelectedReferenceExpectation {
  sourceId: string;
  canonicalId: string;
  observedVersion: string;
  observedHash: string;
  sourceInstance: string;
}

export const SELECTED_REFERENCE_SUMMARY_MAX_CHARS = 4_000;
const PROPOSAL_TEXT_MAX = 16_384;

export function selectedReferenceCitation(sourceId: string, version: string): string {
  return `[source: ${sourceId}@${version}]`;
}

/** Fresh server resolution must equal the admitted expectation exactly. */
export function selectedReferenceCurrent(
  expectation: SelectedReferenceExpectation,
  resolved: QualifiedWorkstreamArtifact,
): boolean {
  const receipt = resolved.receipt;
  return resolved.eligible && resolved.managedReference !== null && receipt.kind === 'memory_vault' &&
    receipt.verified === true && receipt.reason === null && resolved.selector === expectation.sourceId &&
    receipt.canonicalId === expectation.canonicalId && receipt.observedVersion === expectation.observedVersion &&
    receipt.observedHash === expectation.observedHash && receipt.sourceNamespace === 'memory-vault' &&
    receipt.sourceInstance === expectation.sourceInstance;
}

/** One bounded JSON object: the whole text, or the span between the first '{' and last '}'. */
function jsonObjectIn(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > PROPOSAL_TEXT_MAX) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

export type SelectedReferenceSummaryCheck =
  | { ok: true; summarySha256: string }
  | { ok: false; reason: 'summary_unavailable' | 'summary_citation_mismatch' | 'summary_bounds' |
    'review_unavailable' | 'review_not_pass' | 'review_mismatch' };

/**
 * Structural/citation check of the manager's brief plus the independent
 * reviewer's strict verdict over that exact brief. The reviewer's judgement is
 * model review; the server proves only identity, citation and bounds.
 */
export function checkSelectedReferenceSummary(input: {
  expectation: SelectedReferenceExpectation;
  managerText: string;
  reviewerText: string;
}): SelectedReferenceSummaryCheck {
  const { expectation } = input;
  const summary = jsonObjectIn(input.managerText);
  if (!summary || !exactKeys(summary, ['kind', 'sourceId', 'version', 'summary']) ||
      summary.kind !== 'selected_reference_summary_v1' || typeof summary.summary !== 'string') {
    return { ok: false, reason: 'summary_unavailable' };
  }
  if (summary.summary.trim().length === 0 || summary.summary.length > SELECTED_REFERENCE_SUMMARY_MAX_CHARS) {
    return { ok: false, reason: 'summary_bounds' };
  }
  if (summary.sourceId !== expectation.sourceId || summary.version !== expectation.observedVersion ||
      !summary.summary.includes(selectedReferenceCitation(expectation.sourceId, expectation.observedVersion))) {
    return { ok: false, reason: 'summary_citation_mismatch' };
  }
  const summarySha256 = hash(summary.summary);
  const review = jsonObjectIn(input.reviewerText);
  if (!review || !exactKeys(review, ['kind', 'criterionId', 'verdict', 'sourceId', 'version', 'summarySha256']) ||
      review.kind !== 'selected_reference_review_v1') {
    return { ok: false, reason: 'review_unavailable' };
  }
  if (review.verdict !== 'pass') return { ok: false, reason: 'review_not_pass' };
  if (review.criterionId !== SELECTED_REFERENCE_SUMMARY_CRITERION || review.sourceId !== expectation.sourceId ||
      review.version !== expectation.observedVersion || review.summarySha256 !== summarySha256) {
    return { ok: false, reason: 'review_mismatch' };
  }
  return { ok: true, summarySha256 };
}
