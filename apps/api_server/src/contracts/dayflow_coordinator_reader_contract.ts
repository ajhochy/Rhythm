import { createHash } from 'node:crypto';

import {
  parseDayflowWorkstreamReferenceV1,
  type DayflowWorkstreamReferenceV1,
} from './dayflow_workstream_reference_contract';

/**
 * Server-only qualification contracts for Dayflow activity.  These values are
 * deliberately metadata-only: a receipt cannot carry a journal path, title,
 * screenshot, summary, or any other observation body.
 */
export type DayflowReaderStatus = 'available' | 'not_configured' | 'unavailable';

export interface DayflowQualificationCandidate {
  namespace: string;
  sourceInstance: string;
  sourceId: string;
  exporterVersion: string;
  normalizerVersion: string;
  sourceRevision: string;
  sourceHash: string;
  canonicalId: string;
  canonicalVersion: string;
  configurationGeneration: string;
  observedStart: string;
  observedEnd: string;
  canonicalContentHash: string;
  /** Private vault/index source key. It is supplied only to the authenticated
   * qualification boundary and is never part of the public V1 reference. */
  canonicalSourceKey: string;
}

/** Returned only by the authenticated composition boundary, never by a client. */
export interface DayflowQualificationScope {
  ownerUserId: number;
  projectId: string;
  namespace: string;
  sourceInstance: string;
  consentGeneration: string;
  configurationGeneration: string;
}

export interface DayflowQualifiedReceipt {
  schemaVersion: 1;
  reference: DayflowWorkstreamReferenceV1;
  canonicalContentHash: string;
  /** Authority-attested private binding for the canonical vault note. */
  canonicalSourceKey: string;
  qualifiedAt: string;
}

/**
 * This interface is intentionally supplied by server composition.  The local
 * Dayflow config and loopback importer do not know the authenticated owner,
 * project, or consent generation and therefore may not manufacture receipts.
 */
export interface DayflowQualificationAuthority {
  qualify(candidate: DayflowQualificationCandidate): Promise<DayflowQualifiedReceipt | null>;
  current(input: {
    namespace: string;
    sourceInstance: string;
    configurationGeneration: string;
  }): Promise<DayflowQualificationScope | null>;
}

export interface DayflowQualifiedEvidenceCandidate {
  reference: DayflowWorkstreamReferenceV1;
  canonicalContentHash: string;
  contentHash: string;
  /** Private canonical vault source key; never projected into tool output. */
  canonicalSourceKey: string;
}

export interface DayflowQualifiedReferencePage {
  schemaVersion: 1;
  status: DayflowReaderStatus;
  references: DayflowWorkstreamReferenceV1[];
  nextCursor: string | null;
}

export interface DayflowQualifiedEvidencePage extends DayflowQualifiedReferencePage {
  candidates: DayflowQualifiedEvidenceCandidate[];
}

export interface DayflowActivityToolResponse {
  schemaVersion: 1;
  status: DayflowReaderStatus;
  text: string;
  blocked: boolean;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HASH = /^[0-9a-f]{64}$/;
const CANONICAL_SOURCE_KEY = /^(?:memory\/)?[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid Dayflow qualification receipt');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new Error('invalid Dayflow qualification receipt');
  }
  return record;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('invalid Dayflow qualification receipt');
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error('invalid Dayflow qualification receipt');
  return value;
}

function iso(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid Dayflow qualification receipt');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error('invalid Dayflow qualification receipt');
  }
  return value;
}

export function parseDayflowQualifiedReceipt(value: unknown): DayflowQualifiedReceipt {
  const raw = exactRecord(value, ['schemaVersion', 'reference', 'canonicalContentHash', 'canonicalSourceKey', 'qualifiedAt']);
  if (raw.schemaVersion !== 1) throw new Error('invalid Dayflow qualification receipt');
  const reference = parseDayflowWorkstreamReferenceV1(raw.reference);
  const canonicalContentHash = hash(raw.canonicalContentHash);
  const canonicalSourceKey = parseDayflowCanonicalSourceKey(raw.canonicalSourceKey);
  const qualifiedAt = iso(raw.qualifiedAt);
  if (Date.parse(reference.expiresAt) <= Date.parse(qualifiedAt)) {
    throw new Error('invalid Dayflow qualification receipt');
  }
  return { schemaVersion: 1, reference, canonicalContentHash, canonicalSourceKey, qualifiedAt };
}

export function parseDayflowQualificationScope(value: unknown): DayflowQualificationScope {
  const raw = exactRecord(value, [
    'ownerUserId', 'projectId', 'namespace', 'sourceInstance', 'consentGeneration', 'configurationGeneration',
  ]);
  if (!Number.isSafeInteger(raw.ownerUserId) || (raw.ownerUserId as number) <= 0) {
    throw new Error('invalid Dayflow qualification scope');
  }
  return {
    ownerUserId: raw.ownerUserId as number,
    projectId: id(raw.projectId),
    namespace: id(raw.namespace),
    sourceInstance: id(raw.sourceInstance),
    consentGeneration: id(raw.consentGeneration),
    configurationGeneration: id(raw.configurationGeneration),
  };
}

/** The receipt must bind every source-controlled field before it is persisted. */
export function receiptMatchesCandidate(
  receipt: DayflowQualifiedReceipt,
  candidate: DayflowQualificationCandidate,
): boolean {
  const reference = receipt.reference;
  return reference.eligibility === 'active' &&
    reference.namespace === candidate.namespace &&
    reference.sourceInstance === candidate.sourceInstance &&
    reference.sourceId === candidate.sourceId &&
    reference.exporterVersion === candidate.exporterVersion &&
    reference.normalizerVersion === candidate.normalizerVersion &&
    reference.sourceRevision === candidate.sourceRevision &&
    reference.sourceHash === candidate.sourceHash &&
    reference.canonicalId === candidate.canonicalId &&
    reference.canonicalVersion === candidate.canonicalVersion &&
    reference.configurationGeneration === candidate.configurationGeneration &&
    reference.observedStart === candidate.observedStart &&
    reference.observedEnd === candidate.observedEnd &&
    receipt.canonicalContentHash === candidate.canonicalContentHash &&
    receipt.canonicalSourceKey === candidate.canonicalSourceKey;
}

/** The opaque V1 canonical version always commits to the raw note hash. */
export function dayflowCanonicalVersion(canonicalContentHash: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalContentHash)).digest('hex')}`;
}

/** Stable identity comparison for retained receiving-context dependencies.
 * The private canonical source key is intentionally included: a public V1
 * reference alone cannot prove which owner-scoped vault note was admitted. */
export function sameDayflowQualifiedEvidenceCandidate(
  left: DayflowQualifiedEvidenceCandidate,
  right: DayflowQualifiedEvidenceCandidate,
): boolean {
  return left.canonicalContentHash === right.canonicalContentHash &&
    left.contentHash === right.contentHash &&
    left.canonicalSourceKey === right.canonicalSourceKey &&
    JSON.stringify(left.reference) === JSON.stringify(right.reference);
}

export function parseDayflowCanonicalSourceKey(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_SOURCE_KEY.test(value) || value.includes('..') || value.includes('//')) {
    throw new Error('invalid Dayflow qualification receipt');
  }
  return value;
}

/** Opaque server cursor binding; it never contains scope or receipt metadata. */
export function dayflowReaderBinding(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

export function unavailableDayflowActivity(): DayflowActivityToolResponse {
  return { schemaVersion: 1, status: 'unavailable', text: '', blocked: false };
}

export function notConfiguredDayflowActivity(): DayflowActivityToolResponse {
  return { schemaVersion: 1, status: 'not_configured', text: '', blocked: false };
}
